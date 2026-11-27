import {closePrintable,closeSnapshot,closeView,priorPeriod} from './close-workspace.mjs';
import {cashMovement,openingClearedCashIds} from './core.mjs';
import {catchUpPlanning,planningCommand} from './planning-core.mjs';
import {renderPlanning,planningAction} from './planning-views.mjs';
import {emptyManualPayroll,manualPayrollCommand} from './manual-payroll.mjs';
import {manualPayrollContent,manualPayrollAction} from './manual-payroll-ui.mjs';
import {newVault,apply,validateState,recommended,modules,accounts,manualAccounts,outstanding,availableDocumentLines,sum,cents,dollars,check,statements} from './core.mjs';
import {hasVault,createVault,openVault,restoreVault,MAX_BACKUP_BYTES} from './vault.mjs';
import {sampleVault} from './sample.mjs';
import {previewBankCsv,exportBankCsv,reconcileBankStatement,statementFingerprint,bankImportReview} from './interop.mjs';
import {states,ficaPreview,incomeTaxPreview,payrollGate} from './payroll-rules.mjs';
import {projectsView,legalView,trackedView,deskAction} from './desk-views.mjs';
import {esc,btn,money,table,panel,pretty,code,choices,input,options,select,dateField,mapping,acts,brand,home,contacts,commerceView,jobs,warehouse,assetsView,accounting,banks,reportView,payrollView,history,ref,title,line,documentEditor,handleDocumentLine,parseDocumentLines,documentLineSelection,parseSelectedDocumentLines,commercialLineTable} from './views.mjs';

const app=document.querySelector('#app'),dialog=document.querySelector('dialog'),notice=document.querySelector('#notice');
let session=null,companyId='',page='Overview',menu=false,existing=false,busy=false,epoch=0,lockTimer,lastActivity=0;
const timeout=5*60000;
const localDate=()=>{const now=new Date();return [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');};
let closeWindow=priorPeriod(localDate());
let filter={from:'2000-01-01',through:localDate(),group:''};
const nav=['Overview','Directory',...modules,'Planning','Month-end close','History','Company setup'];
const icons=['⌂','☷','↗','↙','◷','▤','◇','▦','≡','▣','▥','◎','◴','⚙'];
function toast(s){notice.textContent=s;clearTimeout(toast.timer);toast.timer=setTimeout(()=>notice.textContent='',4100);}
function showError(err){const out=dialog.open?dialog.querySelector('.error'):app.querySelector('.error');if(out){out.textContent=err.message||String(err);out.scrollIntoView({block:'nearest'});}else toast(err.message);}
function closeModal(){dialog.close();dialog.replaceChildren();dialog.removeAttribute("aria-labelledby");dialog.onsubmit=null;dialog.onchange=null;}
dialog.addEventListener('cancel',ev=>{ev.preventDefault();if(!busy)closeModal();});
dialog.addEventListener('click',e=>{if(e.target.closest('[data-act="cancel"]')&&!busy)closeModal();});
function lock(silent=false){
  ++epoch;clearTimeout(lockTimer);session?.lock();session=null;companyId='';page='Overview';filter.group='';busy=false;menu=false;closeModal();notice.textContent='';gate();
  if(!silent)toast('Vault locked.');
}
function touch(){
  if(!session)return;
  if(Date.now()-lastActivity>=timeout){lock();return;}
  lastActivity=Date.now();clearTimeout(lockTimer);lockTimer=setTimeout(()=>lock(),timeout);
}
for(const event of ['pointerdown','keydown','wheel'])document.addEventListener(event,touch,{capture:true,passive:true});
document.addEventListener('visibilitychange',()=>{if(session&&Date.now()-lastActivity>=timeout)lock();});
window.addEventListener('pagehide',()=>lock(true));
function setupFields(){return `<fieldset><legend>What does this company do?</legend>${choices('activities',acts)}</fieldset><div class="callout small"><b>Featured workflows</b><p id="suggested">Accounting · Reports</p></div>`;}
function previewSettings(form){
  const f=new FormData(form),out=form.querySelector('#suggested');if(out)out.textContent=recommended(f.getAll('activities')).join(' · ');
}
function gate(){
  app.innerHTML=`<div class="gate"><div class="gateart">${brand}<section><p class="eyebrow">ERP Lite</p><h2>Company books</h2><div class="bookart" aria-hidden="true"></div></section><p class="foot small">Local vault &nbsp; / &nbsp; US edition</p></div><div class="gatepanel"><p class="eyebrow">FirmQuill &nbsp; / &nbsp; Lite preview</p><h1>${existing?'Unlock your vault':'Create your workspace'}</h1><p class="quiet">${existing?'Enter your password to open the books stored in this browser.':'Keep your company books in an encrypted vault on this device.'}</p><form id="gate-form">${existing?'':input('name','Company name','text','','maxlength="160"')+setupFields()}${input('password','Vault password (12+ characters)','password','','autocomplete="'+(existing?'current-password':'new-password')+'" minlength="12"')}${existing?'':input('confirm','Confirm password','password','','autocomplete="new-password" minlength="12"')}<div class="error" role="alert"></div><button class="primary">${existing?'Unlock vault':'Create encrypted vault'}</button></form><div class="row">${btn('restore','Restore backup','','link')}${existing?'':btn('sample','Use sample companies','','link')}</div><p class="quiet small locknote">Automatic lock after five minutes of inactivity.</p></div></div>`;
}
async function start(s){session=s;existing=true;companyId=s.state.companies[0].id;lastActivity=Date.now();page='Overview';notice.textContent='';closeModal();touch();const token=epoch;try{const next=catchUpPlanning(s.state,localDate());if(next.generated){validateState(next.state);await s.save(next.state);}}catch(err){if(token===epoch&&session===s)toast('Recurring drafts could not refresh: '+err.message);}if(token===epoch&&session===s)render();}
function setup(c){return panel('Company profile',`<p><b>${esc(c.name)}</b></p><p class="quiet">${acts.filter(([v])=>c.activities.includes(v)).map(([,n])=>n).join(' · ')||'No activities selected'}</p><div class="rule"></div><p>Featured on overview</p><p>${esc(c.featured.join(' · ')||'None')}</p>`,btn('settings','Edit profile'))+
  panel('Workspaces',`<p>Each company keeps its own contacts, stock, document numbers and journals.</p>`,btn('company','Add company'))+
  panel('Vault recovery',`<p>An encrypted backup includes every company and its attachments. Keep your password somewhere recoverable.</p>`,btn('backup','Download backup')+btn('restore','Restore backup'));}
const view={'Overview':home,'Directory':contacts,'Sales':c=>commerceView(c,true),'Purchasing':c=>commerceView(c,false),'Projects':projectsView,'Contracts & legal':legalView,'Assets & pallets':trackedView,'Jobs & time':jobs,'Warehouse':c=>warehouse(c,false),'Assembly':c=>warehouse(c,true),'Fixed assets':assetsView,'Accounting':accounting,'Banking':banks,'Reports':reportView,'Payroll':c=>manualPayrollContent({data:c.manualPayroll,employees:c.employees})+payrollView(c),'Planning':c=>renderPlanning(c,localDate()),'Month-end close':c=>closeView(c,closeWindow,localDate()),'History':history,'Company setup':setup};
function render(){
  if(!session){gate();return;}
  const s=session.state,c=s.companies.find(x=>x.id===companyId),ord=['Overview','Directory',...c.featured,...modules.filter(m=>!c.featured.includes(m)),'Planning','Month-end close','History','Company setup'];
  const navButton=m=>`<button type="button" data-act="nav" data-key="${esc(m)}" class="${m===page?'active':''}" ${m===page?'aria-current="page"':''}><span aria-hidden="true" class="navicon">${icons[nav.indexOf(m)]||'◇'}</span>${esc(m)}</button>`;
  app.innerHTML=`<div class="shell${menu?' menu':''}"><aside>${brand}<nav aria-label="Workspace"><p class="navlabel">Workspace</p>${ord.slice(0,2).map(navButton).join('')}${c.featured.length?'<p class="navlabel">Featured</p>':''}${c.featured.map(navButton).join('')}<p class="navlabel">All tools</p>${ord.slice(2+c.featured.length).map(navButton).join('')}</nav><div class="sidebarfoot small">ERP Lite · Local preview</div></aside><div class="maincol"><header class="toolbar"><div class="toolgroup">${btn('menu','Menu','','mobilemenu')}<label for="company">Company</label><select id="company" aria-label="Active company" class="picker">${options(mapping(s.companies))}</select></div><div class="toolgroup"><span class="quiet small" id="offline-status">${offlineStatus}</span>${btn('lock','Lock vault')}</div></header><div class="workspace"><div class="pagehead"><div><p class="eyebrow">${esc(c.name)}</p><h1>${page==='Overview'?'Workspace overview':esc(page)}</h1></div>${page==='Overview'?btn('quote','New quote','','primary'):''}</div><div class="error" role="alert"></div>${view[page](c,s,filter)}</div></div></div>`;
  app.querySelector('#company').value=companyId;if(page==='Reports')app.querySelector('[name="group"]').value=filter.group;
}
async function save(type,a){
  const current=session,token=epoch;check(current,'Unlock the vault first.');
  const next=apply(current.state,companyId,{...a,type,date:a.date||localDate(),requestId:crypto.randomUUID()});validateState(next);await current.save(next);
  if(token!==epoch||session!==current)return;
  if(type==='company'){companyId=next.companies.at(-1).id;page='Overview';filter.group='';}
  if(type==='group')filter.group=next.groups.at(-1).id;
  closeModal();render();toast('Saved to the encrypted vault.');
}
async function savePlanning(action){
  const current=session,token=epoch;check(current,'Unlock the vault first.');
  const {state,generated}=planningCommand(current.state,companyId,action,localDate());validateState(state);await current.save(state);
  if(token!==epoch||session!==current)return;closeModal();render();toast(generated?generated+' recurring draft(s) created.':'Saved to the encrypted vault.');
}
function formModal(heading,fields,submit,handler){
  closeModal();dialog.setAttribute("aria-labelledby","fq-main-dialog-title");dialog.innerHTML=`<form><h2 id="fq-main-dialog-title">${esc(heading)}</h2><div class="fields">${fields}</div><div class="error" role="alert"></div><div class="dialogfoot">${btn('cancel',submit?'Cancel':'Close')}${submit?`<button class="primary" type="submit">${esc(submit)}</button>`:''}</div></form>`;
  dialog.showModal();dialog.onsubmit=async ev=>{
    ev.preventDefault();if(busy||!handler)return;busy=true;const token=epoch,form=ev.target,submitter=ev.submitter;if(submitter)submitter.disabled=true;
    const f=new FormData(form);try{await handler(Object.fromEntries(f),f,form);}catch(err){if(epoch===token)showError(err);}finally{if(epoch===token){busy=false;if(submitter)submitter.disabled=false;}}
  };
  dialog.onclick=ev=>handleDocumentLine(ev,dialog);
  dialog.onchange=ev=>previewSettings(ev.target.form||dialog.querySelector('form'));
}
function download(contents,filename,mime){
  const url=URL.createObjectURL(new Blob([contents],{type:mime})),link=document.createElement('a');
  link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function docFields(c,sale){
  const people=c.parties.filter(p=>p.kind===(sale?'Customer':'Vendor'));
  check(people.length&&c.items.length,'Add the contact and an item or service in Directory first.');
  return select('party',sale?'Customer':'Vendor',mapping(people))+documentEditor(c)+
   `<label>Job<select name="job">${options([['','No job'],...mapping(c.jobs)])}</select></label>`;
}
function action(type,key){
  if(type==='lock'){lock();return;}
  if(type==='restore'){
    const current=session,token=epoch;
    const fields=input('file','Encrypted backup','file','','accept=".json,.firmquill,.fieldledger"')+input('password','Backup password','password','','autocomplete="off"')+
      (current?'<label class="checkfield"><input type="checkbox" required>Replace every company in this vault. I have saved a current backup.</label>':'');
    if(existing&&!current)throw Error('Unlock the existing vault before replacing its contents.');
    formModal('Restore encrypted backup',fields,'Restore vault',async v=>{check(v.file.size<=MAX_BACKUP_BYTES,'Backup exceeds the size limit.');const data=await v.file.text();if(token!==epoch)return;const restored=await restoreVault(data,v.password,validateState,current||undefined);if(token!==epoch){restored.lock();return;}current?.lock();await start(restored);toast('Backup restored.');});return;
  }
  if(type==='sample'){
    formModal('Create a sample vault',`<p class="quiet">Explore Northline Studio and Alder Supply with synthetic transactions. Choose a password to keep your edits.</p>`+input('password','New password (12+ characters)','password','','minlength="12" autocomplete="new-password"')+input('confirm','Confirm password','password','','autocomplete="new-password"'),'Create sample vault',async v=>{check(v.password===v.confirm,'Passwords differ.');await start(await createVault(v.password,sampleVault(),validateState));});return;
  }
  if(!session)return;
  const s=session.state,c=s.companies.find(x=>x.id===companyId),now=localDate();
  if(type==='nav'){page=key;menu=false;render();window.scrollTo(0,0);return;}
  if(type==='menu'){menu=!menu;render();return;}
  if(type==='backup'){download(session.backup(),'firmquill-'+now+'.firmquill','application/json');toast('Encrypted backup downloaded.');return;}
  const form=(label,fields,convert=(v)=>v,button='Save')=>formModal(label,fields,button,(v,f)=>save(type,convert(v,f)));
  const amount=(k='amount',label='Amount (USD)',v='')=>input(k,label,'text',v,'inputmode="decimal"');
  const count=(k,label,v=1)=>input(k,label,'number',v,'min="1" step="1"');
  const memo=input('label','Description','text','','maxlength="160"'),dates=dateField(now);
  const list=(name,label,rows)=>{check(rows.length,'Create a '+label.toLowerCase()+' record first.');return select(name,label,mapping(rows));};
  const products=c.items.filter(i=>i.kind==='Product');
  if(planningAction(type,key,c,now,formModal,savePlanning)||deskAction(type,key,c,now,formModal,save))return;
  if(page==='Payroll'&&manualPayrollAction(type,key,{result:{data:c.manualPayroll??emptyManualPayroll(),employees:c.employees},now,formModal,download,command:async payload=>{
    const current=session,token=epoch;
    const next=structuredClone(current.state),company=next.companies.find(x=>x.id===c.id);
    const out=manualPayrollCommand(company.manualPayroll,company,payload);
    company.manualPayroll=out.data;validateState(next);await current.save(next);
    if(token===epoch&&current===session){closeModal();render();toast(out.run?'Manual pay run finalized.':'Manual payroll saved to the vault.');}
    return out;
  }}))return;
  switch(type){
    case 'company':form('Create company',input('name','Company name')+setupFields(),(v,f)=>({...v,activities:f.getAll('activities')}));break;
    case 'settings':form('Company setup',input('name','Company name','text',c.name)+`<fieldset><legend>Company activities</legend>${choices('activities',acts,c.activities)}</fieldset><div class="callout small">Recommended home & navigation<p id="suggested">${esc(recommended(c.activities).join(' · '))}</p></div><fieldset><legend>Feature these workflows</legend>${choices('featured',modules.map(m=>[m,m]),c.featured)}</fieldset>`,(v,f)=>({...v,activities:f.getAll('activities'),featured:f.getAll('featured')}));break;
    case 'contact':case 'item':form(type==='item'?'Add item or service':'Add contact',input('name','Name')+select('kind','Type',(type==='item'?['Product','Service']:['Customer','Vendor']).map(x=>[x,x])));break;
    case 'job':form('Create job',input('name','Job name'));break;
    case 'employee':form('Add employee',input('name','Employee name')+select('state','Work state',states.map(x=>[x,x]))+input('locality','Work locality')+amount('rate','Hourly rate (USD)'),v=>({...v,rate:cents(v.rate)}));break;
    case 'time':form('Log time',list('employee','Employee',c.employees)+list('job','Job',c.jobs)+dates+count('minutes','Minutes worked',60),v=>({...v,minutes:Number(v.minutes)}));break;
    case 'approve time':form('Approve time entry',dates,v=>({...v,time:key}),'Approve');break;
    case 'job expense':form('Record cash job expense',list('job','Job',c.jobs)+memo+amount()+dates,v=>({...v,amount:cents(v.amount)}));break;
    case 'quote':case 'purchase order':form('New '+type,docFields(c,type==='quote')+memo+dates,(v,f)=>({party:v.party,job:v.job,label:v.label,date:v.date,lines:parseDocumentLines(f)}));break;
    case 'advance':{
      const [parent,step]=key.split('|'),p=c.docs.find(d=>d.id===parent),settles=['collection','payment'].includes(step);
      const info=`<p class="quiet">${esc(code(p))} · ${esc(title(c.parties,p.party))} · ${money(p.total)}</p>`;
      const credit=step.includes('credit')?'<p class="callout warn">Credits reduce the open balance first and record a cash refund for any excess; selected products return to or leave stock. Record only completed returns and refunds.</p>':'';
      formModal(pretty(step),info+credit+dates+documentLineSelection(c,p,step,availableDocumentLines(c,p,step))+(settles?amount('amount','Settlement amount (USD)',(BigInt(outstanding(c,p))/100n)+'.'+String(outstanding(c,p)%100).padStart(2,'0')):''),'Record '+step,(v,f)=>save(step,{date:v.date,label:pretty(step)+' · '+code(p),parent,...(settles?{amount:cents(v.amount)}:parseSelectedDocumentLines(f))}));break;
    }
    case 'transfer':case 'adjust':{
      const adjustment=type==='adjust';const fields=(adjustment?select('direction','Direction',[['adjust in','Increase'],['adjust out','Decrease']]):'')+list('item','Stock item',products)+input('location','Source location','text','Main')+(adjustment?amount('amount','Total value for increase (USD)','0.00'):input('to','Destination location'))+count('qty','Units')+memo+dates;
      formModal(adjustment?'Adjust stock':'Transfer stock',fields,'Post movement',v=>save(adjustment?v.direction:type,{...v,qty:Number(v.qty),...(adjustment?{amount:cents(v.amount)}:{})}));break;
    }
    case 'assemble':{
      check(products.length>=2,'Add at least two product items to the directory.');
      const parts=products.map(p=>input('component-'+p.id,'Consume '+p.name,'number',0,'min="0" step="1"')).join('');
      form('Build assembly',list('item','Finished item',products)+count('qty','Finished units')+input('location','Build location','text','Main')+`<fieldset><legend>Components consumed</legend>${parts}</fieldset>`+dates,v=>({...v,qty:Number(v.qty),components:products.map(p=>({item:p.id,qty:Number(v['component-'+p.id])})).filter(x=>x.qty>0)}));break;
    }
    case 'asset':form('Acquire fixed asset',input('name','Asset name')+amount('amount','Cash purchase cost (USD)')+amount('residual','Residual value (USD)','0.00')+count('months','Useful life in months',36)+dates,v=>({...v,amount:cents(v.amount),residual:cents(v.residual),months:Number(v.months)}));break;
    case 'depreciate':form('Post monthly depreciation','<p class="quiet">Straight-line book depreciation begins in the acquisition month.</p>'+dates,v=>({...v,asset:key}));break;
    case 'journal':{
      const opts=manualAccounts.map(k=>[k,k+' · '+accounts[k][0]]);
      form('Post journal',memo+dates+select('debit','Debit account',opts)+select('credit','Credit account',opts)+amount()+select('flow','Cash-flow classification',['Operating','Financing','Investing'].map(x=>[x,x])),v=>{const n=cents(v.amount);check(n>0,'Enter a positive amount.');return {...v,lines:[[v.debit,n],[v.credit,-n]]};},'Post journal');break;
    }
    case 'reverse journal':form('Reverse posted journal',memo+dates,v=>({...v,entry:key}),'Post reversal');break;
    case 'close-export':{const packet=closeSnapshot(c,closeWindow.from,closeWindow.through);download(closePrintable(packet),'FirmQuill-close-'+closeWindow.through+'.html','text/html;charset=utf-8');break;}
    case 'close-download-data':{const packet=closeSnapshot(c,closeWindow.from,closeWindow.through);download(JSON.stringify(packet,null,2)+'\n','FirmQuill-close-'+closeWindow.through+'.json','application/json');break;}
    case 'close-review-confirm':formModal('Close accounting period','<div class="callout warn">Closing prevents new postings through '+esc(closeWindow.through)+'. Existing unresolved items stay open.</div><input type="hidden" name="date" value="'+esc(closeWindow.through)+'"><label class="checkfield"><input type="checkbox" required>I reviewed the close workspace and approve closing.</label>','Close period',v=>save('close',v));break;
    case 'close':form('Close accounting period','<div class="callout warn">Closing prevents new postings through this date. Review journals and statements before closing.</div>'+dateField(now,'date','Close through')+'<label class="checkfield"><input type="checkbox" required>I reviewed the period and approve closing.</label>',v=>v,'Close period');break;
    case 'group':form('Create reporting group',input('name','Group name')+`<fieldset><legend>Member companies</legend>${choices('members',mapping(s.companies))}</fieldset>`,(v,f)=>({...v,members:f.getAll('members')}));break;
    case 'intercompany':form('Charge another company',`<p class="quiet">${esc(c.name)} earns service revenue. The receiving company records the expense and payable.</p>`+list('other','Receiving company',s.companies.filter(x=>x.id!==c.id))+amount()+memo+dates,v=>({...v,amount:cents(v.amount)}),'Post to both books');break;
    case 'import':importForm(c);break;
    case 'export':formModal('Export bank transactions','<p class="callout warn">This download contains readable dates, descriptions and amounts.</p>'+select('profile','Destination',[['wave','Wave bank upload'],['quickbooks','QuickBooks Online bank upload']]),'Download CSV',v=>{
      const rows=c.entries.map(j=>({date:j.date,description:j.memo,amountCents:sum(j.lines.filter(l=>l.account==='1000').map(l=>l.cents))})).filter(r=>r.amountCents);
      download(exportBankCsv(rows,v.profile),'operating-account-'+v.profile+'.csv','text/csv');closeModal();
    });break;
    case 'match':{
      const r=c.bank.find(x=>x.id===key),openingCleared=openingClearedCashIds(c),eligible=c.entries.filter(e=>!openingCleared.has(e.id)&&!c.bank.some(x=>x.match===e.id)&&cashMovement(e)===r.amountCents);
      check(eligible.length,'Record a matching cash transaction in Accounting, Sales or Purchasing first.');
      form('Match bank line',`<p>${esc(r.description)} · ${money(r.amountCents)}</p>`+select('entry','Posted cash entry',eligible.map(e=>[e.id,e.date+' · '+e.memo]))+dates,v=>({...v,row:key}));break;
    }
    case 'reconcile':{
      const cash=c.entries.filter(j=>cashMovement(j)!==0);
      const prior=c.reconciliations.at(-1);
      const start=prior?line('Opening from last reconciled statement',prior.closing):
        '<details><summary>Start from an existing bank balance</summary><p class="quiet">Use this for your first statement when your bank already had a balance. Confirm the opening amount from the bank. In the list, check only cash entries dated on or before the opening date that had not cleared by then.</p>'+
        '<label>Opening statement date (leave blank to start from zero)<input type="date" name="openingThrough"></label><label>Opening statement balance (USD)<input type="text" inputmode="decimal" name="openingCash" placeholder="0.00"></label>'+
        '<fieldset data-opening-pending hidden><legend>Still outstanding at opening (optional)</legend><div></div></fieldset></details>';
      form('Reconcile statement',dateField(now,'date','Statement ending date')+amount('closing','Closing statement balance (USD)')+start,(v,f)=>{
        const pending=f.getAll('openingPending');
        check(v.openingThrough||(!v.openingCash&&!pending.length),'Enter an opening statement date or clear the opening details.');
        return {date:v.date,closing:cents(v.closing),...(v.openingThrough?{openingBasis:{through:v.openingThrough,balance:cents(v.openingCash||'0.00'),outstanding:pending}}:{})};
      });
      if(!prior){
        const dateInput=dialog.querySelector('[name=openingThrough]'), fieldset=dialog.querySelector('[data-opening-pending]');
        dateInput.addEventListener('input',()=>{
          const selected=[...fieldset.querySelectorAll('input:checked')].map(x=>x.value);
          const eligible=dateInput.value?cash.filter(j=>j.date<=dateInput.value):[];
          fieldset.hidden=!eligible.length;
          fieldset.querySelector('div').innerHTML=choices('openingPending',eligible.map(j=>[j.id,j.date+' · '+j.memo+' · '+money(cashMovement(j))]),selected);
        });
      }
      break;
    }
    case 'worksheet':worksheet(c,key);break;
    case 'detail':detail(c,key);break;
    case 'print document':window.print();break;
    case 'attach':{
      const token=epoch;formModal('Attach a file',input('file','File (up to 1 MB)','file'),'Save attachment',async v=>{
        check(v.file.size>0&&v.file.size<=1000000,'Choose a file up to 1 MB.');const bytes=new Uint8Array(await v.file.arrayBuffer());if(token!==epoch)return;
        let raw='';for(let p=0;p<bytes.length;p+=8192)raw+=String.fromCharCode(...bytes.subarray(p,p+8192));await save('attachment',{source:key,name:v.file.name,data:btoa(raw)});
      });break;
    }
    case 'get attachment':{const a=c.attachments.find(x=>x.id===key);download(Uint8Array.from(atob(a.data),ch=>ch.charCodeAt(0)),a.name,'application/octet-stream');break;}
  }
}
function detail(c,id){
  const e=ref(c,id),d=c.docs.find(x=>x.id===id),j=c.entries.filter(j=>j.source===id),files=c.attachments.filter(a=>a.source===id);
  const evidence=d?`<section class="printable"><div class="printbrand"><img src="./mark.svg" alt="">FirmQuill</div><p><b>${esc(c.name)}</b></p><p>${esc(d.date)} · ${esc(title(c.parties,d.party))}</p>`+
    (['payment','collection'].includes(d.kind)?line('Amount settled',d.total):commercialLineTable(c,d))+'</section>'+
    btn('print document','Print document')+
    (d.parent?btn('detail','View source '+code(ref(c,d.parent)),d.parent):''):'';
  formModal(code(e)+' · '+pretty(e.kind),`<p>${esc(e.date)} · ${esc(e.label)}</p><p class="small quiet source">${esc(e.id)}</p>${evidence}`+
    table(['Account','Debit','Credit'],j.flatMap(entry=>entry.lines.map(l=>[esc(l.account+' '+accounts[l.account][0]),money(Math.max(0,l.cents)),money(Math.max(0,-l.cents))])),'No journal was posted for this activity.')+
    `<div class="rule"></div><h3>Attachments</h3><p class="small quiet">Downloaded attachments are readable outside the vault.</p><div class="actions">${files.map(a=>btn('get attachment',a.name,a.id)).join('')}${btn('attach','Attach file',id)}</div>`,'',null);
}
function importForm(c){
  const acct=c.id,token=epoch;formModal('Preview statement import',select('profile','File layout',[['wave','Wave · YYYY-MM-DD'],['quickbooks','QuickBooks Online · DD/MM/YYYY']])+input('file','Statement CSV','file','','accept=".csv,text/csv"')+input('opening','Statement opening balance (USD)','text','0.00')+input('closing','Statement closing balance (USD)','text',''),'Preview',async v=>{
    check(v.file.size<=2000000,'File exceeds 2 MB.');const raw=await v.file.text();if(epoch!==token)return;
    const opening=cents(v.opening),closing=cents(v.closing);
    const p=previewBankCsv(raw,v.profile,c.bank),r=reconcileBankStatement(p,opening,closing);
    const statementKey=await statementFingerprint(p,opening,closing);if(epoch!==token)return;
    const plan=bankImportReview(p,c.bank,statementKey),ambiguous=plan.decisions.includes('ambiguous');
    const body=`<p>${p.added.length} new · ${p.skipped.length} possible or known duplicates</p>`+line('Movement',p.totalCents)+line('Calculated closing',r.computedClosingCents)+line('Difference',r.differenceCents)+
      table(['Date','Description','Amount','Action'],p.rows.map((x,index)=>[x.date,esc(x.description),money(x.amountCents),
        plan.decisions[index]==='new'?'Import':plan.decisions[index]==='recorded'?'Skip: previously confirmed separate':r.balanced&&plan.decisions[index]==='ambiguous'?
          `<label><input type="checkbox" name="distinct" value="${index}"> Confirm row ${index+2} is a separate transaction</label>`:'Skip duplicate']))+
      (r.balanced&&ambiguous?'<p class="callout warn">Rows with the same date, description and amount are skipped unless you check a row that you independently verified as another transaction on the bank statement. Never check a repeated upload.</p>':'')+
      (!r.balanced?'<div class="callout warn">Resolve the closing balance difference before import.</div>':'');
    formModal('Review statement lines',body,(r.balanced&&(p.added.length||ambiguous))?'Import lines':'',async(_,f)=>{
      check(companyId===acct,'Company changed.');const fresh=session.state.companies.find(b=>b.id===acct);
      const checkPreview=previewBankCsv(raw,v.profile,fresh.bank);
      check(reconcileBankStatement(checkPreview,opening,closing).balanced,'Statement control totals changed.');
      const rows=bankImportReview(checkPreview,fresh.bank,statementKey,f.getAll('distinct')).rows;
      check(rows.length,'No new lines selected. Leave repeated transactions unchecked.');
      await save('statement import',{rows,label:'Bank CSV import'});
    });
  });
}
function worksheet(c,personId){
  const p=c.employees.find(e=>e.id===personId),approved=c.time.filter(t=>t.employee===p.id&&t.approved);
  const dollarsField=(k,l,v='')=>input(k,l,'text',v,'inputmode="decimal"');
  const fields=`<p class="quiet">${esc(p.name)} · ${esc(p.state)} · ${esc(p.locality)}. Enter taxable bases and year-to-date wages explicitly.</p>`+
    dateField(localDate(),'date','Pay date')+dateField('2026-01-01','from','Approved time from')+dateField(localDate(),'to','Approved time through')+
    dollarsField('fed','Federal taxable wages')+dollarsField('ss','Social Security taxable wages')+dollarsField('med','Medicare taxable wages')+dollarsField('priorSs','Prior Social Security wages this year')+dollarsField('priorMed','Prior Medicare wages this year')+
    select('status','2020+ W-4 filing status',[['single','Single / married filing separately'],['joint','Married filing jointly'],['head','Head of household']])+select('periods','Pay periods per year',[52,26,24,12,4,2,260].map(n=>[n,n]))+
    '<label class="checkfield"><input type="checkbox" name="step2">W-4 Step 2 box checked</label>'+dollarsField('other','W-4 other income','0.00')+dollarsField('ded','W-4 deductions','0.00')+dollarsField('credits','W-4 credits','0.00')+dollarsField('extra','W-4 extra withholding','0.00');
  formModal('Federal payroll worksheet',fields,'Calculate preview',v=>{
    check(v.from<=v.to&&v.to<=v.date,'Review time and pay dates.');
    const rows=approved.filter(t=>t.date>=v.from&&t.date<=v.to);
    const fica=ficaPreview({payDate:v.date,ssWagesCents:cents(v.ss),medicareWagesCents:cents(v.med),priorSsWagesCents:cents(v.priorSs),priorMedicareWagesCents:cents(v.priorMed)});
    const tax=incomeTaxPreview({payDate:v.date,taxableWagesCents:cents(v.fed),periods:Number(v.periods),filingStatus:v.status,step2:v.step2==='on',otherIncomeCents:cents(v.other),deductionsCents:cents(v.ded),creditsCents:cents(v.credits),extraCents:cents(v.extra)});
    const gate=payrollGate({payDate:v.date,state:p.state,locality:p.locality});
    formModal('Federal worksheet result',`<p>${esc(p.name)} · ${esc(v.date)}</p>`+line('Approved straight-time estimate',sum(rows.map(t=>t.cost)))+line('Federal income tax',tax)+line('Employee Social Security',fica.employeeSocialSecurityCents)+line('Employee Medicare',fica.employeeMedicareCents)+line('Additional Medicare',fica.additionalMedicareCents)+line('Employer Social Security',fica.employerSocialSecurityCents)+line('Employer Medicare',fica.employerMedicareCents)+`<div class="callout warn"><b>Final output blocked</b><ul>${gate.blockers.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`,'',null);
  });
}
document.addEventListener('click',ev=>{const b=ev.target.closest('button[data-act]');if(!b||b.dataset.act==='cancel'||busy)return;try{action(b.dataset.act,b.dataset.key);}catch(err){showError(err);}});
app.addEventListener('change',ev=>{
  if(ev.target.id==='company'){companyId=ev.target.value;menu=false;filter.group='';render();}
  if(ev.target.form?.id==='gate-form')previewSettings(ev.target.form);
});
app.addEventListener('submit',async ev=>{
  ev.preventDefault();if(busy)return;const form=ev.target,f=new FormData(form),v=Object.fromEntries(f);busy=true;const b=ev.submitter;if(b)b.disabled=true;
  try{if(form.id==='gate-form'){
    if(!existing)check(v.password===v.confirm,'Passwords differ.');
    await start(existing?await openVault(v.password,validateState):await createVault(v.password,newVault(v.name,f.getAll('activities')),validateState));
  }else if(form.id==='close-filter'){
    statements([],v.from,v.through);check(v.through<=localDate(),'The selected cutoff is in the future.');closeWindow={from:v.from,through:v.through};render();
  }else if(form.id==='report-filter'){
    statements([],v.from,v.through);filter={from:v.from,through:v.through,group:v.group};render();
  }}catch(err){showError(err);}finally{busy=false;if(b)b.disabled=false;}
});
let offlineStatus='Offline setup pending';
function setOffline(s){offlineStatus=s;const status=document.querySelector('#offline-status');if(status)status.textContent=s;}
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('./sw.js',{scope:'./'}).then(()=>navigator.serviceWorker.ready).then(()=>setOffline('Available offline')).catch(()=>setOffline('Offline setup failed'));
}else setOffline('Offline setup unavailable');
try{existing=await hasVault();gate();}catch{app.innerHTML='<div class="gatepanel"><h1>Storage unavailable</h1><p>Open the local launcher in a browser that permits IndexedDB and Web Crypto.</p></div>';}



