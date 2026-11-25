import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { catalogConfig, cursorId, runBatch, publicUrl } from '../src/catalog.mjs';

const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  if (!['--directory', '--env-file', '--pass', '--stage'].includes(process.argv[i]) || !process.argv[i + 1]) throw new Error('invalid_audit_options');
  options[process.argv[i]] = process.argv[i + 1];
}
const directory = resolve(options['--directory'] ?? 'reports/website-audit-2026-11-24');
const pass = options['--pass'] ?? 'baseline', stage = options['--stage'] ?? 'raw';
assert.match(pass, /^[a-z0-9-]+$/);
assert.ok(['prepare', 'raw'].includes(stage));
await fs.mkdir(join(directory, 'cache'), { recursive: true });
const save = async (name, data) => {
  const file = join(directory, name); await fs.mkdir(resolve(file, '..'), { recursive: true });
  await fs.writeFile(file + '.tmp', JSON.stringify(data, null, 2) + '\n');
  for (let attempt=0; ; attempt++) {
    try { await fs.rename(file + '.tmp', file); break; }
    catch(error) { if(error.code!=='EPERM'||attempt===4) throw error; await new Promise(done=>setTimeout(done,100*2**attempt)); }
  }
};
const snapshotFile = join(directory, 'catalog-snapshot.json');
let snapshot;
if (existsSync(snapshotFile)) snapshot = JSON.parse(await fs.readFile(snapshotFile, 'utf8'));
else {
  if (options['--env-file']) process.loadEnvFile(resolve(options['--env-file']));
  const config = catalogConfig(process.env), rows = [];
  let after = '0';
  while (true) {
    const url = new URL('/rest/v1/Clothing', config.url);
    for (const [key, value] of Object.entries({ select: 'item_id,item_name,item_price,item_web_listing', order: 'item_id.asc', item_id: `gt.${after}`, limit: '1000' })) url.searchParams.set(key, value);
    const response = await fetch(url, { method: 'GET', redirect: 'manual', headers: config.headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`catalog_read_http_${response.status}`);
    const page = await response.json(); assert.ok(Array.isArray(page));
    for (const row of page) { assert.ok(BigInt(cursorId(row.item_id)) > BigInt(after)); after = cursorId(row.item_id); rows.push(row); }
    if (page.length < 1000) break;
  }
  assert.ok(rows.length); assert.equal(new Set(rows.map(row => String(row.item_id))).size, rows.length);
  snapshot = { captured_at: new Date().toISOString(), database_writes: 0, rows };
  await save('catalog-snapshot.json', snapshot);
}
const websites = new Set(snapshot.rows.map(row => new URL(row.item_web_listing).hostname));
console.log(JSON.stringify({ event: 'snapshot', items: snapshot.rows.length, websites: websites.size, stage, pass }));
if (stage === 'prepare') process.exit(0);

// Extraction never receives real database credentials or a write-capable network boundary.
const env = { SUPABASE_URL: 'https://offline-catalog.supabase.co', SUPABASE_KEY: 'local-snapshot-only', DRY_RUN: 'true' };
const inFlight = new Map(), lastStart = new Map();
let requests = 0, cacheHits = 0;
async function cachedFetch(input, init = {}) {
  assert.equal(init.method ?? 'GET', 'GET');
  const url = publicUrl(String(input)), requestHeaders = new Headers(init.headers);
  assert.equal(requestHeaders.has('apikey'), false); assert.equal(requestHeaders.has('authorization'), false);
  const key = createHash('sha256').update(url.href).digest('hex');
  const metaFile = join(directory, 'cache', key + '.json'), bodyFile = join(directory, 'cache', key + '.html.gz');
  const responseFor = async () => {
    const meta = JSON.parse(await fs.readFile(metaFile, 'utf8'));
    const bytes = gunzipSync(await fs.readFile(bodyFile));
    return new Response([204, 205, 304].includes(meta.status) ? null : bytes, { status: meta.status, headers: meta.headers });
  };
  if (existsSync(metaFile) && existsSync(bodyFile)) { cacheHits++; return responseFor(); }
  if (!inFlight.has(key)) inFlight.set(key, (async () => {
    const start = Math.max(Date.now(), (lastStart.get(url.hostname) ?? 0) + 600); lastStart.set(url.hostname, start);
    if (start > Date.now()) await new Promise(done => setTimeout(done, start - Date.now()));
    requests++;
    const response = await fetch(url, { ...init, method: 'GET', redirect: 'manual' });
    const reader = response.body?.getReader(), chunks = []; let size = 0;
    try {
      if (reader) while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 16 * 1024 * 1024) throw new Error('page_too_large'); chunks.push(value); }
    } finally { await reader?.cancel().catch(() => {}); }
    const bytes = Buffer.concat(chunks), headers = {};
    for (const key of ['content-type', 'location', 'retry-after']) if (response.headers.has(key)) headers[key] = response.headers.get(key);
    headers['content-length'] = String(bytes.length);
    await fs.writeFile(bodyFile, gzipSync(bytes));
    await fs.writeFile(metaFile, JSON.stringify({ url: url.href, status: response.status, checked_at: new Date().toISOString(), bytes: bytes.length, headers }, null, 2));
  })());
  try { await inFlight.get(key); } finally { inFlight.delete(key); }
  return responseFor();
}
const source = createHash('sha256');
for (const file of (await fs.readdir(new URL('../src/', import.meta.url))).filter(file => file.endsWith('.mjs')).sort()) source.update(await fs.readFile(new URL('../src/' + file, import.meta.url)));
const codeHash = source.digest('hex'), reports = [], checked = new Set(); let position = 0, checkpoint = Promise.resolve();
await fs.mkdir(join(directory, pass), { recursive: true });
await Promise.all(Array.from({ length: 2 }, async () => {
  while (position < snapshot.rows.length) {
    const offset = position; position += 50;
    const number = offset / 50, name = `${pass}/batch-${String(number + 1).padStart(4, '0')}.json`;
    const rows = snapshot.rows.slice(offset, offset + 50); let report;
    if (existsSync(join(directory, name))) { report = JSON.parse(await fs.readFile(join(directory, name), 'utf8')); assert.equal(report.code_hash, codeHash); }
    else {
      report = await runBatch(env, { limit: 50, dryRun: true }, (url, init) => {
        assert.equal(init.method ?? 'GET', 'GET');
        if (new URL(url).hostname === 'offline-catalog.supabase.co') return Response.json(rows);
        return cachedFetch(url, init);
      });
      report.code_hash = codeHash; await save(name, report);
    }
    assert.equal(report.summary.updated, 0); assert.equal(report.mode, 'dry_run');
    assert.deepEqual(report.results.map(row => row.item_id), rows.map(row => String(row.item_id)));
    for (const row of report.results) { assert.ok(!checked.has(row.item_id)); checked.add(row.item_id); }
    reports[number] = report;
    checkpoint = checkpoint.then(async () => {
      const results = reports.filter(Boolean).flatMap(report => report.results);
      const counts = results.reduce((n, row) => { n[row.status] = (n[row.status] ?? 0) + 1; return n; }, {});
      await save(pass + '/progress.json', { checked: results.length, total: snapshot.rows.length, counts, real_requests: requests, cache_hits: cacheHits });
      console.log(JSON.stringify({ event: 'progress', checked: results.length, total: snapshot.rows.length, counts, real_requests: requests, cache_hits: cacheHits }));
    }); await checkpoint;
  }
}));
assert.equal(checked.size, snapshot.rows.length);
const results = reports.flatMap(report => report.results);
await save(pass + '/results.json', { mode: 'dry_run', complete: true, code_hash: codeHash, database_writes: 0, price_updates_enabled: false, finished_at: new Date().toISOString(), results });
console.log(JSON.stringify({ event: 'complete', checked: results.length, verified: results.filter(row => row.verified).length, websites: websites.size, real_requests: requests, cache_hits: cacheHits }));
