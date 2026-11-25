import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { assessReplacement } from '../src/replacement-match.mjs';

const directory = resolve(process.argv[2] ?? 'reports/website-audit-2026-11-24');
const report = JSON.parse(await fs.readFile(join(directory, 'replacement-candidates.json'), 'utf8'));
const latest = ['catalog-results.json','final-guarded/results.json','final-raw/results.json'].find(file=>existsSync(join(directory,file)));
const baseline = JSON.parse(await fs.readFile(join(directory, latest), 'utf8')).results;
const original = new Map(baseline.map(row => [row.item_id,row]));
const priority = ['verified_exact_listing','product_match_variant_review','live_candidate_identity_review','access_blocked','not_verified','not_checked'];
for (const row of report.results) {
  row.original_check = original.get(row.item_id);
  for (const candidate of row.candidates) {
    const file = join(directory,'candidate-checks',createHash('sha256').update(candidate.url).digest('hex')+'.json');
    const check = existsSync(file) ? JSON.parse(await fs.readFile(file,'utf8')) : null;
    candidate.live_check = check;
    candidate.assessment = assessReplacement(row,candidate,check?.observation);
    delete candidate.snippet; delete candidate.reference;
  }
  row.candidates.sort((a,b)=>priority.indexOf(a.assessment.status)-priority.indexOf(b.assessment.status)||b.score-a.score);
  const canonical = row.original_check?.verified && row.original_check.listing_access_verified && row.original_check.fetched_url && row.original_check.fetched_url !== row.url &&
    assessReplacement(row,{url:row.original_check.fetched_url},row.original_check).exact_match;
  row.replacement_status = canonical ? 'verified_canonical_replacement' : row.original_check?.verified && row.original_check.listing_access_verified ? 'original_listing_now_verified' : row.candidates[0]?.assessment.status ?? 'no_suitable_candidate_found';
  row.replacement_url = canonical ? row.original_check.fetched_url : row.replacement_status === 'verified_exact_listing' ? row.candidates[0].live_check.observation.fetched_url ?? row.candidates[0].url : null;
  row.best_candidate_url = row.candidates[0]?.url ?? null;
  assert.ok(row.replacement_status !== 'verified_exact_listing' || row.candidates[0].assessment.exact_match);
}
const statuses = report.results.reduce((counts,row)=>{counts[row.replacement_status]=(counts[row.replacement_status]??0)+1;return counts},{});
const summary = { database_writes:0, price_updates_enabled:false, total:report.total, searched:report.searched, statuses,
  exact_replacements: report.results.filter(row=>['verified_exact_listing','verified_canonical_replacement'].includes(row.replacement_status)).length,
  warning:'Only verified_exact_listing and verified_canonical_replacement populate replacement_url. Other candidates require review; matching titles and search snippets are not proof. Out-of-stock prices are included and availability remains explicit.' };
await fs.writeFile(join(directory,'replacement-links.json'),JSON.stringify({...summary,results:report.results},null,2));
await fs.writeFile(join(directory,'replacement-summary.json'),JSON.stringify(summary,null,2));
const exactRows=report.results.filter(row=>row.replacement_url);
await fs.writeFile(join(directory,'verified-replacements.json'),JSON.stringify({...summary,total:exactRows.length,results:exactRows},null,2));
const escape = text=>String(text??'').replaceAll('|','\\|').replace(/[\r\n]+/g,' ');
const link=(label,url)=>`[${escape(label)}](<${url.replaceAll('>','%3E')}>)`;
let md=`# Replacement-link review\n\n${report.total} prior/new broken or changed listings researched. No database rows changed.\n\n`;
md+='| Outcome | Items |\n|---|---:|\n'+Object.entries(statuses).map(([k,v])=>`| ${k} | ${v} |`).join('\n');
md+='\n\nOnly **verified_exact_listing** and **verified_canonical_replacement** are exact replacement proposals. Product/variant review candidates and access-blocked links are suggestions, not verified replacements. Out-of-stock status is preserved.\n\n';
for(const status of ['verified_canonical_replacement','original_listing_now_verified',...priority,'no_suitable_candidate_found']){
  const group=report.results.filter(row=>row.replacement_status===status);if(!group.length)continue;
  md+=`## ${status} (${group.length})\n\n| Item ID | Item/original URL | Best candidate | Price | Availability | Unverified selections |\n|---|---|---|---:|---|---|\n`;
  for(const row of group){const candidate=row.candidates[0],assessment=candidate?.assessment;
    const original=['verified_canonical_replacement','original_listing_now_verified'].includes(row.replacement_status);
    const target=original?link(row.replacement_status==='verified_canonical_replacement'?'Verified canonical URL':'Original URL verified',row.replacement_url??row.original_check.fetched_url??row.url):candidate?link(candidate.title,candidate.live_check?.observation.fetched_url??candidate.url):'No suitable candidate found';
    md+=`| ${row.item_id} | ${link(row.item_name,row.url)} | ${target} | ${escape(original?row.original_check.extracted_price:assessment?.price)} | ${escape(original?row.original_check.availability:assessment?.availability)} | ${escape(original?'':assessment?.unverified_selectors?.join(', '))} |\n`;}
  md+='\n';
}
await fs.writeFile(join(directory,'replacement-links.md'),md);
await fs.writeFile(join(directory,'verified-replacements.md'),'# Verified replacement proposals\n\nNo database changes. Every entry passed product identity and saved selection checks. Availability is included; a verified out-of-stock link is not a purchase-availability guarantee.\n\n| Item ID | Original item | Replacement | Price | Availability |\n|---|---|---|---:|---|\n'+exactRows.map(row=>{
  const canonical=row.replacement_status==='verified_canonical_replacement',obs=canonical?row.original_check:row.candidates[0].live_check.observation;
  return `| ${row.item_id} | ${link(row.item_name,row.url)} | ${link('Replacement',row.replacement_url)} | ${escape(obs.extracted_price)} | ${escape(obs.availability)} |`;
}).join('\n')+'\n');
console.log(JSON.stringify(summary,null,2));
