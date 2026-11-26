import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,readFile,appendFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

test('changed runtime bytes invalidate the offline cache and stale inventory fails the check',async()=>{
 const root=new URL('../',import.meta.url),work=await mkdtemp(join(tmpdir(),'firmquill-offline-inventory-'));
 try{
  const source=await readFile(new URL('build-service-worker.mjs',root),'utf8'),files=JSON.parse(source.match(/const files=(\[[^;]+\]);/)[1]);
  for(const name of [...files,'sw.js','build-service-worker.mjs'])await copyFile(new URL(name,root),join(work,name));
  const run=(...args)=>execFileSync(process.execPath,[join(work,'build-service-worker.mjs'),...args],{encoding:'utf8',stdio:'pipe'});
  run('--check');const before=await readFile(join(work,'sw.js'),'utf8');
  await appendFile(join(work,'desk-views.mjs'),'\n// Changed offline runtime fixture\n');
  assert.throws(()=>run('--check'),/Service-worker inventory is stale/);run();
  const after=await readFile(join(work,'sw.js'),'utf8');assert.notEqual(after.match(/const cacheName=.*;/)[0],before.match(/const cacheName=.*;/)[0]);
  run('--check');
 }finally{await rm(work,{recursive:true,force:true});}
});
