import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { observeProduct, publicUrl, listingUrl, extractRenderedProduct } from '../src/catalog.mjs';
import { failureObservation } from '../src/recovery.mjs';
import { evidenceNetwork } from './evidence.mjs';
const directory = resolve(process.argv[2] ?? 'reports/website-audit-2026-11-24');
const report = JSON.parse(await fs.readFile(join(directory, 'replacement-candidates.json'), 'utf8'));
const urls = [...new Set(report.results.flatMap(row => row.candidates.map(candidate => candidate.url)))];
await fs.mkdir(join(directory, 'candidate-checks'), { recursive: true });
const network = await evidenceNetwork(directory), full = await evidenceNetwork(directory,{renderedFolder:'rendered-full'});
const shopifyFile=join(directory,'shopify-checks.json');
const shopify=existsSync(shopifyFile)?new Map(JSON.parse(await fs.readFile(shopifyFile,'utf8')).results.map(row=>[row.url,row.observation])):new Map();
let position = 0, completed = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (position < urls.length) {
    const url = urls[position++]; publicUrl(url);
    const raw = await observeProduct(url, network.fetcher), evidence=[{method:'http',observation:raw}];
    for(const [method,cache] of [['browser',network],['browser_full',full]]) {
      const record=await cache.read(listingUrl(url).href,true);if(!record)continue;
      let observation;try{observation=await extractRenderedProduct(url,record);}catch(error){observation=failureObservation(error);}
      evidence.push({method,checked_at:record.checked_at,observation});
    }
    if(shopify.get(url))evidence.push({method:'shopify_public_json',observation:shopify.get(url)});
    const verified=evidence.filter(row=>row.observation.verified), missing=evidence.find(row=>row.observation.reason==='variant_not_listed');
    const conflict=new Set(verified.map(row=>row.observation.extracted_price)).size>1;
    const observation=missing?missing.observation:conflict?{verified:false,reason:'conflicting_verified_prices'}:verified.at(-1)?.observation??evidence.at(-1).observation;
    assert.ok(!observation.verified||(!conflict&&!missing&&observation.currency==='USD'));
    const file = createHash('sha256').update(url).digest('hex') + '.json';
    await fs.writeFile(join(directory, 'candidate-checks', file), JSON.stringify({ url, checked_at: new Date().toISOString(), observation, evidence }, null, 2));
    completed++;
    if (completed % 25 === 0) console.log(JSON.stringify({ completed, total: urls.length, ...network.stats }));
  }
}));
assert.equal(completed, urls.length);
console.log(JSON.stringify({ complete: true, completed, total: urls.length, database_writes: 0, ...network.stats }));
