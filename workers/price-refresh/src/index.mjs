import { runBatch, cursorId } from './catalog.mjs';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function authorized(request, env) {
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32) return false;
  const supplied = request.headers.get('Authorization') ?? '';
  const digest = value => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const [expected, received] = await Promise.all([digest(`Bearer ${env.ADMIN_TOKEN}`), digest(supplied)]);
  const a = new Uint8Array(expected), b = new Uint8Array(received);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

async function saveReport(env, report) {
  await env.PRICE_REFRESH.put(`report:${report.id}`, JSON.stringify(report), { expirationTtl: 7 * 86400 });
  await env.PRICE_REFRESH.put('latest', report.id);
}

export function createWorker(fetcher = fetch) {
  return {
    async fetch(request, env) {
      if (!await authorized(request, env)) return json({ error: 'unauthorized' }, 401);
      const url = new URL(request.url);
      try {
        if (request.method === 'POST' && url.pathname === '/dry-run') {
          if (Number(request.headers.get('content-length')) > 1024) return json({ error: 'request_too_large' }, 413);
          const text = await request.text();
          if (text.length > 1024) return json({ error: 'request_too_large' }, 413);
          let body;
          try { body = text ? JSON.parse(text) : {}; } catch { return json({ error: 'invalid_json' }, 400); }
          if (!body || typeof body !== 'object' || Array.isArray(body) ||
              Object.keys(body).some(key => !['after_id', 'limit'].includes(key))) return json({ error: 'invalid_options' }, 400);
          const afterId = cursorId(body.after_id ?? '0');
          const maximum = env.FREE_TIER === 'true' ? 1 : 50;
          const limit = body.limit ?? (maximum === 1 ? 1 : Number(env.BATCH_SIZE ?? 50));
          if (!Number.isInteger(limit) || limit < 1 || limit > maximum) return json({ error: 'invalid_batch_size' }, 400);
          const report = await runBatch(env, { afterId, limit, dryRun: true }, fetcher);
          await saveReport(env, report);
          return json(report);
        }
        if (request.method === 'GET' && /^\/reports\/(latest|[\da-f-]{36})$/.test(url.pathname)) {
          let id = url.pathname.split('/').pop();
          if (id === 'latest') id = await env.PRICE_REFRESH.get('latest');
          const report = id && await env.PRICE_REFRESH.get(`report:${id}`, 'json');
          return report ? json(report) : json({ error: 'report_not_found' }, 404);
        }
        return json({ error: 'not_found' }, 404);
      } catch (error) {
        const invalid = ['invalid_after_id', 'invalid_batch_size'].includes(error.message);
        return json({ error: invalid ? error.message : 'price_refresh_failed' }, invalid ? 400 : 502);
      }
    },
    async scheduled(_controller, env) {
      const dryRun = env.DRY_RUN !== 'false';
      const key = dryRun ? 'cursor:dry-run' : 'cursor:live';
      const afterId = await env.PRICE_REFRESH.get(key) ?? '0';
      const freeTier = env.FREE_TIER === 'true';
      const report = await runBatch(env, { afterId, limit: freeTier ? 1 : Number(env.BATCH_SIZE ?? 50), dryRun,
        beforeProcess: freeTier ? nextId => env.PRICE_REFRESH.put(key, nextId) : undefined }, fetcher);
      if (freeTier) report.cursor_reserved_before_extraction = true;
      await saveReport(env, report);
      // KV is a cursor, never a lock; duplicate scans are safe and live writes compare old values.
      if (!freeTier) await env.PRICE_REFRESH.put(key, report.next_after_id);
      console.log(JSON.stringify({ event: 'price_refresh', report_id: report.id, mode: report.mode,
        summary: report.summary, next_after_id: report.next_after_id, warning: report.warning }));
    },
  };
}

export default createWorker();
