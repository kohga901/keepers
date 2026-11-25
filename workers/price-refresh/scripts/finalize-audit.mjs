import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { listingUrl, extractRenderedProduct } from '../src/catalog.mjs';
import { priceCents } from '../src/extract.mjs';
import { recoveryFor, failureObservation } from '../src/recovery.mjs';
import { evidenceNetwork } from './evidence.mjs';

const directory=resolve(process.argv[2]??'reports/website-audit-2026-11-24');
const read=async file=>JSON.parse(await fs.readFile(join(directory,file),'utf8'));
const save=async(file,value)=>fs.writeFile(join(directory,file),JSON.stringify(value,null,2)+'\n');
const pass=process.argv[3]??'final-review';assert.match(pass,/^[a-z0-9-]+$/);
const snapshot=await read('catalog-snapshot.json'), raw=await read(pass+'/results.json');
const baseline=new Map((await read('baseline/results.json')).results.map(row=>[row.item_id,row]));
const shopify=new Map((await read('shopify-checks.json')).results.map(row=>[row.item_id,row]));
const ordinary=await evidenceNetwork(directory), full=await evidenceNetwork(directory,{renderedFolder:'rendered-full'});
const priorBrowser=new Map();
for(const file of ['browser-results.json','full-browser-results.json']) if(existsSync(join(directory,file))) {
  for(const row of (await read(file)).results) priorBrowser.set(row.item_id,row);
}
const code=createHash('sha256');
for(const file of (await fs.readdir(new URL('../src/',import.meta.url))).filter(file=>file.endsWith('.mjs')).sort()) code.update(await fs.readFile(new URL('../src/'+file,import.meta.url)));
const codeHash=code.digest('hex');
assert.equal(raw.code_hash,codeHash,'Run the selected raw pass with the current extractor before consolidating.');
assert.equal(raw.results.length,snapshot.rows.length);
const cents=value=>priceCents(String(value??'').replace(/^(?:\$|USD\s*)/,'').replaceAll(',',''));
const results=[];
for(const row of raw.results) {
  const methods=[{method:'http',checked_at:row.checked_at,observation:row}];
  for(const [method,network] of [['browser',ordinary],['browser_full',full]]) {
    const record=await network.read(listingUrl(row.url).href,true); if(!record)continue;
    let observation;
    try { observation=await extractRenderedProduct(row.url,record); observation.browser_recovery={attempted:true,outcome:observation.verified?'recovered':observation.reason}; }
    catch(error) { observation={...failureObservation(error),browser_recovery:{attempted:true,outcome:error.message,...(error.destination?{destination:error.destination}:{})}}; }
    methods.push({method,checked_at:record.checked_at,observation});
  }
  const publicData=shopify.get(row.item_id);
  if(publicData?.observation) methods.push({method:'shopify_public_json',checked_at:publicData.checked_at,observation:publicData.observation});
  const verified=methods.filter(method=>method.observation.verified);
  const prices=new Set(verified.map(method=>cents(method.observation.extracted_price)));
  const missingVariant=methods.find(method=>method.observation.reason==='variant_not_listed');
  let selected;
  if(missingVariant) selected={...missingVariant.observation,extracted_price:null,quarantined:verified.length>0};
  else if(prices.size>1) selected={verified:false,reason:'conflicting_verified_prices',extracted_price:null,quarantined:true};
  else if(verified.length) {
    selected={...verified.at(-1).observation};
    const stock=[...new Set(verified.map(method=>method.observation.availability))];
    if(stock.length>1) { selected.availability='MixedEvidence'; selected.observed_availability=stock; }
  } else {
    selected=methods.at(-1).observation;
    const previous=priorBrowser.get(row.item_id);
    if(previous?.browser_recovery && !methods.some(method=>method.method.startsWith('browser'))) selected={...selected,browser_recovery:previous.browser_recovery};
  }
  const result={item_id:row.item_id,item_name:row.item_name,url:row.url,stored_price:row.stored_price,...selected,
    status:selected.verified?(cents(selected.extracted_price)===cents(row.stored_price)?'unchanged':'would_update'):selected.request_failed?'error':'skipped',
    evidence:methods.map(({method,checked_at,observation})=>({method,checked_at,verified:observation.verified,reason:observation.reason,
      price:observation.extracted_price??null,currency:observation.currency??null,availability:observation.availability??null,
      final_url:observation.fetched_url??null,source:observation.source??null,evidence_urls:observation.evidence_urls??[],
      redirects:observation.redirects??[],browser_recovery:observation.browser_recovery??null}))};
  result.listing_access_verified=methods.some(method=>method.observation.verified&&method.observation.source!=='shopify_ajax');
  result.listing_repair_required=!result.listing_access_verified&&methods.some(method=>recoveryFor(method.observation).action==='repair_listing');
  if(result.verified) {delete result.recovery;delete result.request_failed;assert.equal(result.currency,'USD');assert.ok(cents(result.extracted_price)>0);assert.equal(prices.size,1);assert.ok(!missingVariant);}
  else result.recovery=recoveryFor(result);
  results.push(result);
}
assert.deepEqual(results.map(row=>row.item_id),snapshot.rows.map(row=>String(row.item_id)));
assert.equal(new Set(results.map(row=>row.item_id)).size,snapshot.rows.length);
const count=(rows,key)=>rows.reduce((n,row)=>{const value=typeof key==='function'?key(row):row[key];n[value]=(n[value]??0)+1;return n},{});
const verified=results.filter(row=>row.verified),unresolved=results.filter(row=>!row.verified);
const websites=[...new Set(results.map(row=>new URL(row.url).hostname))].sort().map(host=>{
  const rows=results.filter(row=>new URL(row.url).hostname===host);
  return {host,items:rows.length,verified:rows.filter(row=>row.verified).length,statuses:count(rows,'status'),
    methods:count(rows.flatMap(row=>row.evidence), 'method'),unresolved_reasons:count(rows.filter(row=>!row.verified),'reason')};
});
const summary={mode:'dry_run',complete:true,generated_at:new Date().toISOString(),snapshot_at:snapshot.captured_at,code_hash:codeHash,
  database_writes:0,price_updates_enabled:false,items:results.length,websites:websites.length,verified:verified.length,statuses:count(results,'status'),
  proposed_changes:results.filter(row=>row.status==='would_update').length,unresolved:unresolved.length,
  out_of_stock:verified.filter(row=>row.availability==='OutOfStock').length,availability:count(verified,'availability'),
  unresolved_reasons:count(unresolved,'reason'),recovery_actions:count(unresolved,row=>row.recovery.action),
  baseline_verified:[...baseline.values()].filter(row=>row.verified).length,
  newly_verified:verified.filter(row=>!baseline.get(row.item_id)?.verified).length,
  baseline_prices_quarantined:unresolved.filter(row=>baseline.get(row.item_id)?.verified).length,
  conflicting_prices:unresolved.filter(row=>row.reason==='conflicting_verified_prices').length,
  missing_published_variants:unresolved.filter(row=>row.reason==='variant_not_listed').length,
  note:'Point-in-time USD prices from saved public evidence. Out-of-stock prices included. Conflicting prices and missing published variants are excluded. No database writes or deployments.'};
await save('catalog-results.json',{...summary,results});await save('summary.json',summary);
await save('proposed-prices.json',{...summary,results:results.filter(row=>row.status==='would_update')});
await save('unresolved.json',{database_writes:0,total:unresolved.length,results:unresolved});
await save('website-coverage.json',{database_writes:0,total:websites.length,websites});
await fs.writeFile(join(directory,'website-coverage.md'),'# Website coverage\n\nEvery hostname in the catalog snapshot is included. Counts are catalog rows, not unique pages.\n\n| Website | Items | Verified | Unresolved reasons |\n|---|---:|---:|---|\n'+websites.map(row=>`| ${row.host} | ${row.items} | ${row.verified} | ${Object.entries(row.unresolved_reasons).map(([k,v])=>`${k}: ${v}`).join('; ')} |`).join('\n')+'\n');
console.log(JSON.stringify(summary,null,2));
