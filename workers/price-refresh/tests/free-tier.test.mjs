import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { FREE_TIER_LIMITS, freeTierFetcher } from '../src/free-tier.mjs';
import { runBatch } from '../src/catalog.mjs';
import { createWorker } from '../src/index.mjs';

const env={FREE_TIER:'true',DRY_RUN:'true',BATCH_SIZE:'50',SUPABASE_URL:'https://project.supabase.co',SUPABASE_KEY:'fake-secret',ADMIN_TOKEN:'test-admin-token-at-least-thirty-two-characters'};
const url='https://merchant.com/products/shirt';
const row={item_id:1,item_name:'Shirt',item_price:'$40.00',item_web_listing:url};
const html='<script type="application/ld+json">'+JSON.stringify({'@type':'Product',url,offers:{price:'25.00',priceCurrency:'USD',availability:'InStock'}})+'</script>';
const page=()=>new Response(html,{headers:{'Content-Type':'text/html'}});
const request=(body='{}')=>new Request('https://worker.workers.dev/dry-run',{method:'POST',headers:{Authorization:'Bearer '+env.ADMIN_TOKEN},body});
function kv(){const data=new Map();return{data,get:async(key,type)=>type==='json'?JSON.parse(data.get(key)??'null'):data.get(key)??null,put:async(key,value)=>{data.set(key,value)}};}

test('free profile bounds announced and streamed bodies without accepting partial product data',async()=>{
  let cancelled=false;
  const big=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(html));c.enqueue(new Uint8Array(FREE_TIER_LIMITS.html_bytes));},cancel(){cancelled=true}});
  const n=async target=>new URL(target).hostname==='project.supabase.co'?Response.json([row]):new Response(big,{headers:{'Content-Type':'text/html'}});
  const result=await runBatch(env,{limit:1},n);
  assert.equal(result.results[0].verified,false);assert.equal(result.results[0].reason,'free_tier_page_limit');
  assert.equal(result.results[0].recovery.action,'resource_limit');assert.equal(result.summary.updated,0);assert.equal(cancelled,true);
  const announced=freeTierFetcher(async()=>new Response('small',{headers:{'Content-Length':String(FREE_TIER_LIMITS.html_bytes+1)}}));
  await assert.rejects(announced(url),/free_tier_page_limit/);
  const json=freeTierFetcher(async()=>new Response(' '.repeat(FREE_TIER_LIMITS.json_bytes+1),{headers:{'Content-Type':'application/json'}}));
  await assert.rejects((await json(url)).text(),/free_tier_page_limit/);
});
test('free request cap includes failed attempts and never issues the extra fetch',async()=>{
  let calls=0;const n=freeTierFetcher(async()=>{calls++;return new Response('',{status:403})});
  for(let i=0;i<FREE_TIER_LIMITS.fetches;i++)await n(url);
  await assert.rejects(n(url),/free_tier_request_limit/);assert.equal(calls,FREE_TIER_LIMITS.fetches);
});
test('free HTTP runs enforce one row and disable browser recovery regardless of stale configuration',async()=>{
  let calls=0;
  const config={...env,BROWSER_FALLBACK_LIMIT:'5',PRICE_REFRESH:kv()};
  const worker=createWorker(async target=>{calls++;return new URL(target).hostname==='project.supabase.co'?Response.json([row]):page()});
  assert.equal((await worker.fetch(request('{"limit":2}'),config)).status,400);assert.equal(calls,0);
  const response=await worker.fetch(request(),config);assert.equal(response.status,200);
  const report=await response.json();assert.equal(report.mode,'dry_run');assert.equal(report.summary.would_update,1);
  assert.equal(report.free_tier.fetches_used,2);assert.equal(config.PRICE_REFRESH.data.has('cursor:dry-run'),false);
  await assert.rejects(runBatch(env,{limit:2},()=>assert.fail('must not fetch')),/invalid_batch_size/);
  const blocked=await runBatch(config,{limit:1},async target=>new URL(target).hostname==='project.supabase.co'?Response.json([row]):new Response('',{status:403}),()=>assert.fail('browser disabled'));
  assert.equal(blocked.summary.updated,0);assert.equal(blocked.browser,undefined);
});
test('free scheduler reserves the cursor before extraction and leaves the next item reachable after failure',async()=>{
  const store=kv(),config={...env,PRICE_REFRESH:store};let failSave=true;
  const put=store.put;store.put=async(key,value)=>{if(failSave&&key.startsWith('report:'))throw new Error('report save failed');return put(key,value)};
  const worker=createWorker(async(target,init)=>{
    assert.equal(init.method,'GET');
    if(new URL(target).hostname==='project.supabase.co'){
      const after=new URL(target).searchParams.get('item_id');assert.equal(after,failSave?'gt.0':'gt.1');
      return Response.json([{...row,item_id:failSave?1:2}]);
    }
    assert.equal(await store.get('cursor:dry-run'),failSave?'1':'2','cursor must precede merchant work');return page();
  });
  await assert.rejects(worker.scheduled({},config),/report save failed/);
  assert.equal(await store.get('cursor:dry-run'),'1');assert.equal(await store.get('latest'),null);
  assert.equal(store.data.has('cursor:live'),false);
  failSave=false;await worker.scheduled({},config);const report=await store.get('report:'+await store.get('latest'),'json');
  assert.equal(report.summary.would_update,1);assert.equal(report.cursor_reserved_before_extraction,true);assert.equal(report.results[0].item_id,'2');
  const broken=createWorker(async()=>new Response('',{status:503}));
  await assert.rejects(broken.scheduled({},config),/supabase_http_503/);assert.equal(await store.get('cursor:dry-run'),'2');
});
test('free profile retains explicit live opt-in and conditional price-only updates',async()=>{
  const calls=[];
  const report=await runBatch({...env,DRY_RUN:'false'},{limit:1,dryRun:false},async(target,init)=>{
    calls.push(init.method);const parsed=new URL(target);
    if(parsed.hostname!=='project.supabase.co')return page();
    if(init.method==='PATCH'){
      assert.equal(parsed.searchParams.get('item_price'),'eq.$40.00');
      assert.equal(parsed.searchParams.get('item_web_listing'),'eq.'+url);
      assert.deepEqual(JSON.parse(init.body),{item_price:'$25.00'});return Response.json([{item_id:1}]);
    }
    return Response.json([row]);
  });
  assert.equal(report.summary.updated,1);assert.deepEqual(calls,['GET','GET','PATCH']);assert.equal(report.free_tier.fetches_used,3);
});
test('bounded HTML can recover an exact small Shopify variant, including its out-of-stock price',async()=>{
  const selected='39405164298343',productUrl='https://merchant.com/products/shirt?variant='+selected;
  const calls=[];
  const report=await runBatch({...env,DRY_RUN:'false'},{limit:1},async(target,init)=>{
    calls.push(init.method);const parsed=new URL(target);
    if(parsed.hostname==='project.supabase.co')return Response.json([{...row,item_web_listing:productUrl}]);
    assert.equal(init.headers.apikey,undefined);
    if(parsed.pathname==='/cart.js')return Response.json({currency:'USD'});
    if(parsed.pathname==='/products/shirt.js')return Response.json({id:123456,handle:'shirt',price_min:1200,price_max:1200,variants:[{id:Number(selected),price:1200,available:false}]});
    return new Response('large',{headers:{'Content-Type':'text/html','Content-Length':String(FREE_TIER_LIMITS.html_bytes+1)}});
  });
  assert.equal(report.results[0].verified,true);assert.equal(report.results[0].extracted_price,'$12.00');assert.equal(report.results[0].availability,'OutOfStock');
  assert.equal(report.summary.updated,0);assert.ok(calls.every(method=>method==='GET'));
});
test('deployed defaults fit Free scheduling and KV allowance while leaving price writes disabled',async()=>{
  const text=await fs.readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8');
  const config=JSON.parse(text.replace(/^\s*\/\/.*$/gm,''));
  assert.equal(config.vars.FREE_TIER,'true');assert.equal(config.vars.DRY_RUN,'true');assert.equal(config.vars.BATCH_SIZE,'1');
  assert.deepEqual(config.triggers.crons,['*/5 * * * *']);assert.ok(24*60/5*3<1000);
});
