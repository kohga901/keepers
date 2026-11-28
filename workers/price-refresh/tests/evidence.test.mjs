import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evidenceNetwork } from '../scripts/evidence.mjs';

test('local evidence boundary rejects writes, database URLs and case-insensitive credentials before networking', async () => {
  const directory=await fs.mkdtemp(join(tmpdir(),'keepers-evidence-'));
  try {
    const network=await evidenceNetwork(directory);
    for(const init of [{method:'PATCH'},{headers:new Headers({authorization:'secret'})},{headers:[['APIKEY','secret']]}]) {
      await assert.rejects(network.fetcher('https://merchant.com/product',init));
    }
    await assert.rejects(network.fetcher('https://project.supabase.co/rest/v1/Clothing'));
    await network.render('https://merchant.com/product',async()=>({url:'https://merchant.com/product',status:200,html:'<p>Saved</p>'}));
    assert.equal((await network.render('https://merchant.com/product',()=>assert.fail('cache not used'))).html,'<p>Saved</p>');
    assert.equal(network.stats.requests,0);
  } finally { await fs.rm(directory,{recursive:true,force:true}); }
});
