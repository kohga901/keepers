import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { publicUrl } from '../src/catalog.mjs';

export async function evidenceNetwork(directory, { renderedFolder = 'rendered' } = {}) {
  assert.match(renderedFolder, /^[a-z-]+$/);
  for (const name of ['cache', renderedFolder]) await fs.mkdir(join(directory, name), { recursive: true });
  const inFlight = new Map(), lastStart = new Map();
  const stats = { requests: 0, cache_hits: 0, browser_loads: 0, browser_cache_hits: 0 };
  const files = (url, rendered = false) => {
    const key = createHash('sha256').update(url).digest('hex'), base = join(directory, rendered ? renderedFolder : 'cache', key);
    return { meta: base + '.json', body: base + '.html.gz' };
  };
  const read = async (url, rendered = false) => {
    const file = files(url, rendered);
    if (!existsSync(file.meta) || !existsSync(file.body)) return null;
    return { ...JSON.parse(await fs.readFile(file.meta, 'utf8')), html: gunzipSync(await fs.readFile(file.body)).toString() };
  };
  const write = async (url, record, rendered = false) => {
    const file = files(url, rendered), { html, ...meta } = record;
    assert.ok(Buffer.byteLength(html) <= 16 * 1024 * 1024);
    await fs.writeFile(file.body, gzipSync(Buffer.from(html)));
    await fs.writeFile(file.meta, JSON.stringify({ ...meta, requested_url: url, checked_at: new Date().toISOString(), bytes: Buffer.byteLength(html) }, null, 2));
  };
  const responseFor = record => new Response([204, 205, 304].includes(record.status) ? null : record.html, { status: record.status, headers: record.headers });
  async function fetcher(input, init = {}) {
    assert.equal(init.method ?? 'GET', 'GET');
    const url = publicUrl(String(input)), headers = new Headers(init.headers);
    assert.equal(headers.has('apikey'), false); assert.equal(headers.has('authorization'), false);
    const cached = await read(url.href);
    if (cached) { stats.cache_hits++; return responseFor(cached); }
    if (!inFlight.has(url.href)) inFlight.set(url.href, (async () => {
      const start = Math.max(Date.now(), (lastStart.get(url.hostname) ?? 0) + 600); lastStart.set(url.hostname, start);
      if (start > Date.now()) await new Promise(done => setTimeout(done, start - Date.now()));
      stats.requests++;
      const response = await fetch(url, { ...init, method: 'GET', redirect: 'manual', signal: init.signal ?? AbortSignal.timeout(15000) });
      const reader = response.body?.getReader(), chunks = []; let size = 0;
      try {
        if (reader) while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 16 * 1024 * 1024) throw new Error('page_too_large'); chunks.push(value); }
      } finally { await reader?.cancel().catch(() => {}); }
      const html = Buffer.concat(chunks).toString('utf8'), headers = {};
      for (const key of ['content-type', 'location', 'retry-after']) if (response.headers.has(key)) headers[key] = response.headers.get(key);
      headers['content-length'] = String(Buffer.byteLength(html));
      await write(url.href, { url: url.href, status: response.status, headers, html });
    })());
    try { await inFlight.get(url.href); } finally { inFlight.delete(url.href); }
    return responseFor(await read(url.href));
  }
  async function render(url, renderer) {
    publicUrl(url);
    const cached = await read(url, true);
    if (cached) { stats.browser_cache_hits++; return cached; }
    stats.browser_loads++;
    const record = await renderer(url); await write(url, record, true); return record;
  }
  return { fetcher, render, read, stats };
}
