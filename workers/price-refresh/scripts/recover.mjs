import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { runBatch, publicUrl } from '../src/catalog.mjs';
import { recoveryFor } from '../src/recovery.mjs';
import { boundedRenderer, createCloudflareRenderer } from '../src/browser.mjs';

const options = {};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (key === '--retry') { options[key] = true; continue; }
  if (!['--input', '--output', '--env-file', '--local-browser', '--browser-limit', '--limit', '--actions'].includes(key) || !process.argv[i + 1]) {
    console.error('Usage: npm run recover -- --input REPORT.json [--retry] [--actions browser,verify_variant] [--limit N] [--browser-limit 0..200] [--local-browser CHROME_PATH | --env-file .dev.vars] [--output REPORT.json]');
    process.exit(1);
  }
  options[key] = process.argv[++i];
}
let local;
try {
  if (!options['--input']) throw new Error('input_required');
  if (options['--env-file']) process.loadEnvFile(resolve(options['--env-file']));
  const input = JSON.parse(await readFile(resolve(options['--input']), 'utf8'));
  const failures = (Array.isArray(input) ? input : input.results).filter(row => ['skipped', 'error'].includes(row.status));
  assert.equal(new Set(failures.map(row => String(row.item_id))).size, failures.length);
  const browserLimit = Number(options['--browser-limit'] ?? 0), limit = Number(options['--limit'] ?? failures.length);
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(browserLimit) || browserLimit < 0 || browserLimit > 200) throw new Error('invalid_limit');
  if (browserLimit && !options['--retry']) throw new Error('browser_requires_retry');
  let renderer = null;
  if (browserLimit) {
    if (options['--local-browser']) {
      const { localBrowser } = await import('./local-browser.mjs');
      local = await localBrowser(options['--local-browser']);
      renderer = boundedRenderer(local.render, browserLimit);
    } else {
      // The Worker caps each batch at five; this CLI uses one shared, explicit run budget.
      const cloud = createCloudflareRenderer({ ...process.env, BROWSER_FALLBACK_LIMIT: '5' });
      renderer = boundedRenderer(async url => {
        const single = createCloudflareRenderer({ ...process.env, BROWSER_FALLBACK_LIMIT: '1' });
        return single(url);
      }, browserLimit);
      assert.ok(cloud);
    }
  }
  const results = failures.map(row => ({ ...row, recovery: recoveryFor(row), rechecked: false }));
  const allowed = options['--actions'] ? new Set(options['--actions'].split(',')) : null;
  const priority = ['browser', 'verify_variant', 'select_offer', 'review_price', 'refresh_offer', 'usd_listing', 'retry', 'merchant_access', 'repair_listing', 'fix_url', 'adapter'];
  if (allowed && [...allowed].some(action => !priority.includes(action))) throw new Error('invalid_actions');
  const selected = results.filter(row => !allowed || allowed.has(row.recovery.action))
    .sort((a, b) => priority.indexOf(a.recovery.action) - priority.indexOf(b.recovery.action)).slice(0, limit);
  const started = new Date().toISOString(), output = resolve(options['--output'] ?? `reports/recovery-${started.replaceAll(':', '-')}.json`);
  await mkdir(dirname(output), { recursive: true });
  const env = { SUPABASE_URL: 'https://recovery-snapshot.supabase.co', SUPABASE_KEY: 'snapshot-only-no-real-key', DRY_RUN: 'true' };
  let checked = 0;
  const save = async (complete = false) => {
    const unresolved = results.filter(row => !row.rechecked || !row.verified);
    const report = { mode: 'dry_run', complete, price_updates_enabled: false, database_writes: 0, input: resolve(options['--input']), started_at: started,
      updated_at: new Date().toISOString(), finished_at: complete ? new Date().toISOString() : null, original_failures: failures.length, rechecked: checked,
      selected_for_recheck: options['--retry'] ? selected.length : 0,
      recovered: results.filter(row => row.rechecked && row.verified).length,
      proposed_changes: results.filter(row => row.rechecked && row.status === 'would_update').length,
      remaining: unresolved.length, actions: unresolved.reduce((n, row) => { n[row.recovery.action] = (n[row.recovery.action] ?? 0) + 1; return n; }, {}),
      ...(renderer ? { browser: renderer.stats } : {}), results };
    assert.equal(report.recovered + report.remaining, failures.length);
    assert.ok(results.every(row => !['updated', 'conflict'].includes(row.status)));
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    return report;
  };
  await save();
  if (options['--retry']) for (let index = 0; index < selected.length; index += 50) {
    const chunk = selected.slice(index, index + 50);
    const rows = chunk.map(row => ({ item_id: row.item_id, item_name: row.item_name, item_price: row.stored_price, item_web_listing: row.url }));
    const guardedFetch = async (url, init = {}) => {
      // No real Supabase credential is loaded or used. The original report supplies the rows.
      if (new URL(url).hostname === 'recovery-snapshot.supabase.co') {
        assert.equal(init.method, 'GET'); return Response.json(rows);
      }
      assert.equal(init.method ?? 'GET', 'GET'); publicUrl(String(url));
      return fetch(url, init);
    };
    const batch = await runBatch(env, { dryRun: true, limit: 50 }, guardedFetch, renderer);
    for (let j = 0; j < chunk.length; j++) {
      const old = chunk[j], fresh = batch.results[j];
      assert.equal(fresh.item_id, String(old.item_id)); assert.equal(fresh.url, old.url);
      Object.assign(old, fresh, { previous_reason: old.reason, rechecked: true });
      if (old.verified) delete old.recovery;
      checked++;
    }
    const progress = await save();
    console.log(JSON.stringify({ checked, recovered: progress.recovered, remaining: progress.remaining, browser: renderer?.stats }));
  }
  const report = await save(true);
  console.log(JSON.stringify({ ...report, results: undefined, report: output }, null, 2));
} catch (error) {
  const safe = /^(input_required|invalid_limit|invalid_actions|browser_requires_retry|invalid_browser_limit|missing_browser_credentials)$/;
  console.error(safe.test(error.message) ? error.message : 'Recovery failed. Check input, browser configuration and network access. Reports contain completed batches only.');
  process.exitCode = 1;
} finally { await local?.close(); }
