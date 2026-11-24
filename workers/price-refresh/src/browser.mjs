// The caller validates product URLs before rendering and validates final URLs before extraction.
export function boundedRenderer(render, limit) {
  if (!Number.isInteger(limit) || limit < 0 || limit > 200) throw new Error('invalid_browser_limit');
  const blocked = new Set(), stats = { limit, attempted: 0, blocked_hosts: 0 };
  let pending = Promise.resolve();
  const renderer = url => {
    // A rendered HTML/API envelope is much larger than a streamed fetch. Keep one in memory.
    const result = pending.then(async () => {
      const host = new URL(url).hostname;
      if (blocked.has(host)) throw new Error('browser_host_paused');
      if (stats.attempted >= limit) throw new Error('browser_budget_exhausted');
      stats.attempted++;
      return render(url);
    });
    // Let the caller classify/block the host before starting the next queued browser request.
    pending = result.then(() => new Promise(resolve => setTimeout(resolve, 0)), () => {});
    return result;
  };
  renderer.block = url => { blocked.add(new URL(url).hostname); stats.blocked_hosts = blocked.size; };
  renderer.stats = stats;
  return renderer;
}

export function createCloudflareRenderer(env, fetcher = fetch) {
  const limit = Number(env.BROWSER_FALLBACK_LIMIT ?? 0);
  if (!Number.isInteger(limit) || limit < 0 || limit > 5) throw new Error('invalid_browser_limit');
  if (!limit) return null;
  if (!/^[a-f\d]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID ?? '') || !env.CLOUDFLARE_BROWSER_TOKEN?.trim()) throw new Error('missing_browser_credentials');
  return boundedRenderer(async url => {
    const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/browser-run/content`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(55_000),
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_BROWSER_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, gotoOptions: { waitUntil: 'networkidle2', timeout: 30_000 },
        rejectResourceTypes: ['image', 'font', 'media'], actionTimeout: 10_000 }),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`browser_http_${response.status}`); }
    // Bound the API envelope as well as the HTML (it can contain escaped markup).
    const reader = response.body?.getReader(), decoder = new TextDecoder();
    let text = '', bytes = 0;
    try {
      if (!reader) throw new Error('browser_invalid_response');
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > 24 * 1024 * 1024) throw new Error('browser_page_too_large');
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally { await reader?.cancel().catch(() => {}); }
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('browser_invalid_response'); }
    if (data.success !== true || typeof data.result !== 'string' || typeof data.meta?.finalUrl !== 'string' ||
        !Number.isInteger(data.meta.status)) throw new Error('browser_invalid_response');
    return { html: data.result, url: data.meta.finalUrl, status: data.meta.status };
  }, limit);
}
