import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {createLiteServer} from '../serve.mjs';
const executable=process.env.ERP_LITE_BROWSER_EXE;
test('real browser reviews close workbook, exports, locks period and preserves cutoff',{skip:!executable,timeout:40000},async()=>{
 const server=createLiteServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+server.address().port;
 const {chromium}=createRequire(import.meta.url)(process.env.ERP_LITE_PLAYWRIGHT||'playwright');
 const browser=await chromium.launch({headless:true,executablePath:executable});
 const pw='Fictional month end close test 26';
 try{
  const p=await browser.newPage({viewport:{width:1280,height:900}});
  await p.goto(url);
  await p.getByRole('button',{name:'I agree to the Terms of Service',exact:true}).click();
  await p.locator('[data-act=sample]').click();
  let d=p.locator('dialog[open]');
  await d.locator('[name=password]').fill(pw);
  await d.locator('[name=confirm]').fill(pw);
  await d.locator('[type=submit]').click();
  const enter=()=>p.locator('[data-act=nav][data-key="Month-end close"]').click();
  await p.locator('nav [data-act=nav][data-key=Accounting]').click();
  await p.getByRole('button',{name:'Post journal',exact:true}).click();
  const journal=p.getByRole('dialog',{name:'Post journal',exact:true});await journal.waitFor();
  await journal.getByRole('button',{name:'Cancel',exact:true}).click();
  await enter();
  const f=p.locator('#close-filter');await f.locator('[name=from]').fill('2026-01-01');await f.locator('[name=through]').fill('2026-12-31');
  const through=new Date().toISOString().slice(0,10)<'2026-12-31'?new Date().toISOString().slice(0,10):'2026-12-31';
  await f.locator('[name=through]').fill(through);await f.getByRole('button',{name:'Apply dates'}).click();
  await p.getByRole('heading',{name:'Trial balance'}).waitFor();
  let dl=p.waitForEvent('download');await p.getByRole('button',{name:'Download packet data',exact:true}).click();
  const packet=JSON.parse(await readFile(await (await dl).path(),'utf8'));assert.equal(packet.period.through,through);assert.equal(packet.periodLocked,false);assert.equal(packet.report.trialDifference,0);
  dl=p.waitForEvent('download');await p.getByRole('button',{name:'Download close packet',exact:true}).click();
  assert.match(await readFile(await (await dl).path(),'utf8'),/Operating cash reconciliation/);
  const shots=process.env.ERP_LITE_CLOSE_QA;
  if(shots){await mkdir(shots,{recursive:true});await p.screenshot({path:join(shots,'lite-close-review.png')});}
  await p.getByRole('button',{name:'Review and close through '+through}).click();
  d=p.locator('dialog[open]');await d.locator('[type=checkbox]').check();await d.getByRole('button',{name:'Close period',exact:true}).click();
  await p.getByText('Books are closed through '+through+'.',{exact:true}).waitFor();
  if(shots)await p.screenshot({path:join(shots,'lite-close-confirmed.png')});
  await p.reload();await p.locator('#gate-form [name=password]').fill(pw);await p.locator('#gate-form button').click();
  await enter();await p.getByText('Books are closed through '+through+'.',{exact:true}).waitFor();
  await p.evaluate(()=>navigator.serviceWorker.ready);await p.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await p.context().setOffline(true);await p.reload();await p.locator('#gate-form [name=password]').fill(pw);await p.locator('#gate-form button').click();await enter();await p.getByRole('heading',{name:'Close review'}).waitFor();
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
