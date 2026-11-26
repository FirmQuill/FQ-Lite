import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createLiteServer} from '../serve.mjs';
const executable=process.env.ERP_LITE_BROWSER_EXE;
test('Lite owner prepares and finalizes manual payroll offline, exports and reopens encrypted data',{skip:!executable,timeout:90000},async()=>{
 const server=createLiteServer();await new Promise((res,rej)=>server.once('error',rej).listen(0,'127.0.0.1',res));
 const url='http://127.0.0.1:'+server.address().port,pass='Synthetic offline payroll password';
 let browser;
 try{
  const {chromium}=createRequire(import.meta.url)(process.env.ERP_LITE_PLAYWRIGHT||'playwright');
  browser=await chromium.launch({executablePath:executable,headless:true});const context=await browser.newContext(),p=await context.newPage();
  p.setDefaultTimeout(8000);
  const modal=p.locator('dialog#dialog[open]'),click=(action,key)=>p.locator(`[data-act="${action}"]${key?`[data-key="${key}"]`:''}`).first().click();
  const fill=(name,value)=>modal.locator(`[name="${name}"]`).fill(value);
  const choose=(name,value)=>modal.locator(`[name="${name}"]`).selectOption(value);
  const submit=async()=>{await modal.locator('button[type=submit]').click();await modal.waitFor({state:'hidden'});};
  await p.goto(url);await p.getByRole('button',{name:'I agree to the Terms of Service',exact:true}).click();
  await p.locator('#gate-form [name=name]').fill('Synthetic Offline Payroll');
  await p.locator('#gate-form [name=password]').fill(pass);await p.locator('#gate-form [name=confirm]').fill(pass);await p.locator('#gate-form button').click();
  await p.locator('#company').waitFor();await p.evaluate(()=>navigator.serviceWorker.ready);
  await click('nav','Jobs & time');await click('employee');await fill('name','Synthetic Worker');await choose('state','WA');await fill('locality','Pierce');await fill('rate','25');await submit();
  await context.setOffline(true);
  await click('nav','Payroll');await click('manual-rule');await fill('key','example');await fill('name','Synthetic Rule');await fill('effective','2027-01-01');await fill('rate','5');await submit();
  await click('manual-draft');await fill('start','2027-01-01');await fill('end','2027-01-14');await fill('payDate','2027-01-15');await fill('regular','100.00');await submit();
  await click('manual-finalize');assert.match(await modal.innerText(),/Net \$95\.00/);await modal.locator('[name=reviewed]').check();await submit();
  const stub=p.waitForEvent('download');await click('manual-stub');const downloaded=await stub;assert.match(await readFile(await downloaded.path(),'ascii'),/^%PDF-1.4/);
  const exported=p.waitForEvent('download');await click('manual-export');assert.match(await readFile(await (await exported).path(),'utf8'),/"95.00"/);
  await click('nav','Company setup');const backupEvent=p.waitForEvent('download');await click('backup');const backup=await readFile(await (await backupEvent).path(),'utf8');assert.doesNotMatch(backup,/Synthetic Worker|Synthetic Rule/);
  await p.reload();await p.locator('#gate-form [name=password]').fill(pass);await p.locator('#gate-form button').click();await p.locator('#company').waitFor();await click('nav','Payroll');assert.match(await p.locator('.workspace').innerText(),/\$95\.00/);
 }finally{await browser?.close();await new Promise(res=>server.close(res));}
});
