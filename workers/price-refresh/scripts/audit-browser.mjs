import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { observeProduct } from '../src/catalog.mjs';
import { recoveryFor, browserCandidate } from '../src/recovery.mjs';
import { localBrowser } from './local-browser.mjs';
import { evidenceNetwork } from './evidence.mjs';

const directory = resolve(process.argv[2] ?? 'reports/website-audit-2026-11-24');
const input = process.argv[3] ?? 'baseline/results.json';
const chrome = process.argv[4] ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const fullResources = process.argv[5] === 'full', customPrefix = process.argv[6] ?? '';
assert.match(customPrefix, /^[a-z-]*$/);
const prefix = customPrefix + (fullResources ? 'full-' : '');
const report = JSON.parse(await fs.readFile(join(directory, input), 'utf8'));
const rows = report.results.filter(row => !row.verified && browserCandidate(row.reason));
const groups = new Map();
for (const row of rows) { const host = new URL(row.url).hostname; if (!groups.has(host)) groups.set(host, []); groups.get(host).push(row); }
assert.ok(rows.every(row => /^(?:\d{1,19}|candidate-\d+)$/.test(row.item_id)));
const queue = []; for (let i = 0; i < Math.max(0, ...[...groups.values()].map(group => group.length)); i++) for (const group of groups.values()) if (group[i]) queue.push(group[i]);
await fs.mkdir(join(directory, prefix + 'browser-items'), { recursive: true });
const network = await evidenceNetwork(directory, { renderedFolder: fullResources ? 'rendered-full' : 'rendered' }), blocked = new Set(), results = [];
let browserPromise, position = 0, checkpoint = Promise.resolve();
const render = async url => {
  if (blocked.has(new URL(url).hostname)) throw new Error('browser_host_paused');
  return network.render(url, async target => { browserPromise ??= localBrowser(chrome, { loadResources: fullResources, waitForProduct: fullResources }); return (await browserPromise).render(target); });
};
render.block = url => blocked.add(new URL(url).hostname);
try {
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (position < queue.length) {
      const index = position++, row = queue[index];
      const observation = await observeProduct(row.url, network.fetcher, render);
      const result = { ...row, ...observation, audit_original_reason: row.reason,
        status: observation.verified ? observation.extracted_price === row.stored_price ? 'unchanged' : 'would_update' : observation.request_failed ? 'error' : 'skipped' };
      if (result.verified) { delete result.recovery; delete result.request_failed; } else result.recovery = recoveryFor(result);
      results[index] = result;
      await fs.writeFile(join(directory, prefix + 'browser-items', row.item_id + '.json'), JSON.stringify(result, null, 2));
      if (results.filter(Boolean).length % 10 === 0) {
        checkpoint = checkpoint.then(async () => {
          const progress = { checked: results.filter(Boolean).length, total: queue.length, recovered: results.filter(row => row?.verified).length, blocked_hosts: blocked.size, ...network.stats };
          await fs.writeFile(join(directory, prefix + 'browser-progress.json'), JSON.stringify(progress, null, 2));
          console.log(JSON.stringify(progress));
        }); await checkpoint;
      }
    }
  }));
  assert.equal(results.length, queue.length); assert.ok(results.every(row => !['updated', 'conflict'].includes(row.status)));
  await fs.writeFile(join(directory, prefix + 'browser-results.json'), JSON.stringify({ complete: true, database_writes: 0, price_updates_enabled: false, websites_probed: groups.size, ...network.stats, results }, null, 2));
  console.log(JSON.stringify({ complete: true, checked: queue.length, recovered: results.filter(row => row.verified).length, websites_probed: groups.size, blocked_hosts: blocked.size, ...network.stats }));
} finally { await (await browserPromise)?.close(); }
