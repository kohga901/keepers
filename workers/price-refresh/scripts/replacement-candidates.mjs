import fs from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { searchHits, rankReplacement } from '../src/replacement-match.mjs';
import { publicUrl } from '../src/catalog.mjs';
import { recoveryFor } from '../src/recovery.mjs';
import { existsSync } from 'node:fs';

const directory = resolve(process.argv[2] ?? 'reports/website-audit-2026-11-24');
const previous = JSON.parse(await fs.readFile(resolve('reports/recovery-2026-11-24/broken-changed-listings.json'), 'utf8')).results;
const current = JSON.parse(await fs.readFile(join(directory, 'baseline/results.json'), 'utf8')).results.filter(row => row.recovery?.action === 'repair_listing');
const browser = existsSync(join(directory,'browser-results.json')) ? JSON.parse(await fs.readFile(join(directory,'browser-results.json'),'utf8')).results.filter(row=>!row.verified&&recoveryFor(row).action==='repair_listing') : [];
const latest=[];
for(const file of ['full-browser-results.json','catalog-results.json']) if(existsSync(join(directory,file))) latest.push(...JSON.parse(await fs.readFile(join(directory,file),'utf8')).results.filter(row=>row.listing_repair_required||(!row.verified&&recoveryFor(row).action==='repair_listing')));
const rows = [...new Map([...previous, ...current, ...browser, ...latest].map(row => [row.item_id, row])).values()];
const perItem = new Map(rows.map(row => [row.item_id, { ...row, search_attempted: false, candidates: [] }]));
for (const name of (await fs.readdir(join(directory, 'search'))).filter(name => /^(batch|follow-up|browser|supplemental)-\d+\.json$/.test(name))) {
  const batch = JSON.parse(await fs.readFile(join(directory, 'search', name), 'utf8')), hits = searchHits(batch.response);
  for (const job of batch.jobs) {
    const row = perItem.get(job.id); if (!row) continue;
    row.search_attempted = true;
    for (const hit of hits) { const ranked = rankReplacement(row, hit); if (ranked) row.candidates.push({ ...ranked, search_query: job.q, search_batch: name }); }
  }
}
const results = [...perItem.values()];
for (const row of results) {
  const destination = row.redirects?.at(-1)?.to ?? row.redirect_destination ?? row.browser_recovery?.destination;
  if (destination) try {
    const target = publicUrl(destination);
    if (!/\/(?:blocked|verify|px)(?:[/?]|$)|siteclosed\.|captcha|\/PX-Show/i.test(target.href) && (/\/(products?|p|ip|listing|itm)\//i.test(target.pathname) || /\.(html|aspx)$/i.test(target.pathname) || target.pathname === '/browse/product.do')) row.candidates.push({
      url: target.href, title: 'Merchant redirect destination', score: 100, evidence_type: 'merchant_redirect', name_coverage: 0,
      redirect_evidence: row.redirects ?? [], search_query: null, search_batch: null });
  } catch { /* Unsafe redirect targets cannot be replacement candidates. */ }
  const unique = new Map(); for (const candidate of row.candidates.sort((a,b)=>b.score-a.score)) if (!unique.has(candidate.url)) unique.set(candidate.url,candidate);
  row.candidates = [...unique.values()].slice(0, 4);
  row.search_status = !row.search_attempted ? 'not_searched' : row.candidates.length ? 'candidates_need_verification' : 'no_candidate_found';
}
assert.equal(new Set(results.map(row=>row.item_id)).size, rows.length);
await fs.writeFile(join(directory, 'replacement-candidates.json'), JSON.stringify({ database_writes: 0, total: rows.length,
  searched: results.filter(row=>row.search_attempted).length, with_candidates: results.filter(row=>row.candidates.length).length, results }, null, 2));
console.log(JSON.stringify({ total: rows.length, searched: results.filter(row=>row.search_attempted).length, with_candidates: results.filter(row=>row.candidates.length).length,
  urls_to_verify: new Set(results.flatMap(row=>row.candidates.map(candidate=>candidate.url))).size }));
