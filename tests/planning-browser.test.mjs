import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createLiteServer} from '../serve.mjs';
const executable=process.env.ERP_LITE_BROWSER_EXE;
test('Lite opens encrypted books offline, catches up a due draft once, and opens it as a quote', {skip:!executable,timeout:45000},async()=>{
 const server=createLiteServer();
 await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;let browser;
 try{
  const {chromium}=createRequire(import.meta.url)(process.env.ERP_LITE_PLAYWRIGHT||'playwright');
  browser=await chromium.launch({executablePath:executable,headless:true});
  const context=await browser.newContext(),p=await context.newPage();
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  const password='Synthetic planning vault for NUnit';
  await p.goto(url);
  const seeded=await p.evaluate(async password=>{
    const {newVault,apply,validateState}=await import('./core.mjs');
    const {planningCommand,localPlanningDay}=await import('./planning-core.mjs');
    const {createVault}=await import('./vault.mjs');
    const t=localPlanningDay();
    let s=newVault('Synthetic recurring business'),id=s.companies[0].id;
    s=apply(s,id,{type:'contact',name:'Customer one',kind:'Customer',date:t});s=apply(s,id,{type:'item',name:'Service one',kind:'Service',date:t});
    const c=s.companies[0];const {state}=planningCommand(s,id,{type:'schedule-create',kind:'invoice',name:'Unique monthly services',party:c.parties[0].id,item:c.items[0].id,quantity:1,unitCents:2450,frequency:'monthly',start:t},'2020-01-01');
    const v=await createVault(password,state,validateState);v.lock();return t;
  },password);
  await p.getByRole('button',{name:'I agree to the Terms of Service',exact:true}).click();
  await p.evaluate(()=>navigator.serviceWorker.ready);
  await p.waitForFunction(()=>navigator.serviceWorker.controller!==null);
  await context.setOffline(true);
  async function unlock(){await p.reload();await p.locator('#gate-form [name=password]').fill(password);await p.locator('#gate-form button').click();await p.locator('[data-key=Planning]').click();await p.getByRole('heading',{name:'Draft inbox'}).waitFor();}
  await unlock();assert.equal(await p.locator('[data-act=plan-copy]').count(),1);assert.match(await p.locator('.workspace').innerText(),/\$24\.50/);
  await unlock();assert.equal(await p.locator('[data-act=plan-copy]').count(),1);
  await p.locator('[data-act=plan-copy]').click();await p.locator('dialog[open] [name=quantity]').fill('2');await p.locator('dialog[open] button[type=submit]').click();
  await p.getByText('converted',{exact:true}).waitFor();await p.locator('[data-key=Sales]').click();
  assert.match(await p.locator('.workspace').innerText(),/\$49\.00/);
  const snapshot=await p.evaluate(async password=>{const {openVault}=await import('./vault.mjs'),{validateState}=await import('./core.mjs');const vault=await openVault(password,validateState);const c=vault.state.companies[0];return {journals:c.entries.length,date:c.planning.drafts[0].due,document:c.docs[0].kind,label:c.docs[0].label};},password);
  assert.deepEqual(snapshot,{journals:0,date:seeded,document:'quote',label:'Unique monthly services'});assert.deepEqual(errors,[]);
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
