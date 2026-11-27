import {validateManualPayroll} from './manual-payroll.mjs';
// ERP Lite portable format v1. Currency is USD; journal amounts are signed cents (debit positive).
import {deskTypes,applyDesk,validateDesk} from './desk-core.mjs';
import {validatePlanning} from './planning-core.mjs';
export const VERSION = '0.4.0-preview.1';
export const activities = ['products','jobs','time','stock','employees'];
export const modules = ['Sales','Purchasing','Projects','Contracts & legal','Jobs & time','Assets & pallets','Warehouse','Assembly','Fixed assets','Accounting','Banking','Reports','Payroll'];
export const accounts = {
  '1000':['Operating cash','Asset'], '1100':['Accounts receivable','Asset'], '1200':['Inventory','Asset'],
  '1500':['Equipment at cost','Asset'], '1590':['Accumulated depreciation','Asset'],
  '2000':['Accounts payable','Liability'], '2050':['Received, unbilled','Liability'],
  '2100':['Intercompany payable','Liability'], '1150':['Intercompany receivable','Asset'],
  '3000':['Owner capital','Equity'], '4000':['Sales and services','Revenue'], '4100':['Intercompany services','Revenue'],
  '5000':['Cost of goods sold','Expense'], '5100':['Operating expense','Expense'], '5150':['Intercompany services expense','Expense'],
  '5200':['Stock variance','Expense'], '5300':['Depreciation','Expense']
};
export function check(ok,message){ if(!ok) throw new Error(message); }
export function integer(n){check(Number.isSafeInteger(n),'Amount or quantity exceeds the exact integer range.');return n;}
export const sum = values => integer(Number(values.reduce((a,b)=>a+BigInt(integer(b)),0n)));
export function cents(text){
  const v=String(text).trim();
  check(/^-?\d+(\.\d{1,2})?$/.test(v),'Use a dollar amount with up to two decimal places.');
  const [whole,part='']=v.replace('-','').split('.');
  return integer(Number((v.startsWith('-')?-1n:1n)*(BigInt(whole)*100n+BigInt(part.padEnd(2,'0')))));
}
export function dollars(n){
  const v=BigInt(integer(n)), abs=v<0n?-v:v;
  return (v<0n?'−':'')+'$'+(abs/100n).toLocaleString('en-US')+'.'+String(abs%100n).padStart(2,'0');
}
function ratio(n,m,d){return integer(Number((BigInt(n)*BigInt(m)+BigInt(Math.floor(d/2)))/BigInt(d)));}
function positive(n){check(integer(n)>0,'Enter a positive value.');return n;}
function name(v){check(typeof v==='string'&&v.trim()&&v.trim().length<=160,'Enter text between 1 and 160 characters.');return v.trim();}
export function date(v){check(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'Enter a valid calendar date.');return v;}
const id=()=>crypto.randomUUID();
const byId=(rows,k)=>{const x=rows.find(i=>i.id===k);check(x,'Linked record is missing from this company.');return x;};
export function recommended(flags){return [...new Set([...flags.flatMap(f=>({products:['Sales','Purchasing'],jobs:['Jobs & time','Sales'],time:['Jobs & time'],stock:['Warehouse','Assembly'],employees:['Payroll']}[f]||[])),'Accounting','Reports'])];}
export function newBook(title,flags=[]){return {id:id(),name:name(title),activities:[...flags],featured:recommended(flags),sequence:0,closedThrough:'',parties:[],items:[],jobs:[],employees:[],time:[],docs:[],moves:[],entries:[],assets:[],bank:[],reconciliations:[],history:[],attachments:[]};}
export function newVault(title,flags=[]){return {format:'fieldledger.erp',schema:1,edition:'Lite',currency:'USD',companies:[newBook(title,flags)],groups:[]};}
export function balance(c,account,through='9999-12-31',from='0001-01-01'){return sum(c.entries.filter(e=>e.date<=through&&e.date>=from).flatMap(e=>e.lines.filter(l=>l.account===account).map(l=>l.cents)));}
export const cashMovement=entry=>sum(entry.lines.filter(line=>line.account==='1000').map(line=>line.cents));
export function openingClearedCashIds(company){return new Set(company.reconciliations[0]?.openingBasis?.cleared||[]);}
export function position(c,item,location,through='9999-12-31'){
  const m=c.moves.filter(x=>x.item===item&&x.location===location&&x.date<=through);
  return {qty:sum(m.map(x=>x.qty)),value:sum(m.map(x=>x.value))};
}
function move(c,e,item,location,qty,value){
  location=name(location);const hist=c.moves.filter(m=>m.item===item&&m.location===location);
  check(hist.every(m=>m.date<=e.date),'Use a date on or after the last movement at this location.');
  const p=position(c,item,location);
  check(sum([p.qty,qty])>=0&&sum([p.value,value])>=0,'Insufficient stock quantity or value.');
  c.moves.push({id:id(),source:e.id,date:e.date,item,location,qty,value});
}
function removeStock(c,e,item,location,qty){
  const p=position(c,item,location);check(p.qty>=qty,'Insufficient stock at this location.');
  const cost=ratio(p.value,qty,p.qty);move(c,e,item,location,-qty,-cost);return cost;
}
function journal(c,e,lines,flow='Operating',extra={}){
  lines=lines.filter(([,n])=>integer(n)!==0).map(([account,cents])=>{check(Object.hasOwn(accounts,account),'Unknown account.');return {account,cents};});
  if(!lines.length)return;
  check(lines.length>=2&&sum(lines.map(l=>l.cents))===0,'Journal does not balance.');
  check(['Operating','Investing','Financing'].includes(flow),'Select a cash flow classification.');
  c.entries.push({id:id(),source:e.id,date:e.date,memo:e.label,lines,flow,...extra});
}
function event(c,kind,when,label){return {id:id(),number:++c.sequence,kind,date:date(when),label:name(label)};}
const lines2=(a,b,n)=>[[a,n],[b,-n]];
const receivable=d=>d.kind==='invoice';
export function outstanding(c,d){return sum([d.total,...c.docs.filter(x=>x.parent===d.id&&['collection','payment','sales credit','vendor credit'].includes(x.kind)).map(x=>-x.applied)]);}
// Old documents remain unchanged. New line IDs are stable within the source chain.
export const documentLines=d=>d.lines||[{lineId:'legacy',item:d.item,qty:d.qty,unit:d.unit,discount:0,total:d.total,location:d.location}];
const quantitySteps=['fulfillment','receiving','sales credit','vendor credit'];
const commercialSourceKind={'sales order':'quote','fulfillment':'sales order','invoice':'fulfillment','receiving':'purchase order','bill':'receiving','sales credit':'invoice','vendor credit':'bill'};
function consumed(children,kind){
  const result=new Map();for(const child of children)if(child.kind===kind)for(const row of documentLines(child))result.set(row.lineId,sum([result.get(row.lineId)||0,row.qty]));return result;
}
export function availableDocumentLines(c,p,kind){
  const used=p.lines&&quantitySteps.includes(kind)?consumed(c.docs.filter(x=>x.parent===p.id),kind):new Map();
  return documentLines(p).map(l=>({...l,remaining:l.qty-(used.get(l.lineId)||0)})).filter(l=>l.remaining>0);
}
function lineMoney(q,u){return integer(Number(BigInt(q)*BigInt(u)));}
function sumDoc(e,lines){
  const first=lines[0];Object.assign(e,{lines,item:first.item,qty:first.qty,unit:first.unit,location:first.location,total:sum(lines.map(l=>l.total))});
}
function originalLine(c,l,index,location){
  const item=byId(c.items,l.item).id,qty=positive(l.qty),unit=positive(l.unit),gross=lineMoney(qty,unit),discount=integer(l.discount??0);
  check(discount>=0&&discount<gross,'A line discount must be nonnegative and less than the line subtotal.');
  return {lineId:'L'+(index+1),item,qty,unit,discount,total:gross-discount,location:name(l.location||location||'Main')};
}
function selectedLines(c,p,type,request){
  const remaining=availableDocumentLines(c,p,type);
  const selected=request===undefined?remaining.map(l=>({lineId:l.lineId,qty:l.remaining})):request;
  check(Array.isArray(selected)&&selected.length>0&&selected.length<=remaining.length&&new Set(selected.map(l=>l.lineId)).size===selected.length,'Choose at least one distinct available line.');
  return selected.map(q=>{
    const l=byId(remaining.map(r=>({...r,id:r.lineId})),q.lineId),qty=positive(q.qty);
    check(qty<=l.remaining,'Quantity exceeds the remaining line quantity.');
    const used=l.qty-l.remaining;
    const discount=ratio(l.discount,used+qty,l.qty)-ratio(l.discount,used,l.qty);
    const cost=l.cost===undefined?undefined:ratio(l.cost,used+qty,l.qty)-ratio(l.cost,used,l.qty);
    return {lineId:l.lineId,item:l.item,qty,unit:l.unit,discount,total:lineMoney(qty,l.unit)-discount,location:l.location,...(cost===undefined?{}:{cost})};
  });
}
function multiCommerce(c,a,e,p){
  if(!p){
    const party=byId(c.parties,a.party);check(party.kind===(a.type==='quote'?'Customer':'Vendor'),'Select a matching contact.');if(a.job)byId(c.jobs,a.job);
    check(Array.isArray(a.lines)&&a.lines.length>0&&a.lines.length<=100,'Enter one to 100 item lines.');
    e.party=party.id;e.job=a.job||'';sumDoc(e,a.lines.map((l,i)=>originalLine(c,l,i,a.location)));return;
  }
  e.parent=p.id;e.party=p.party;e.job=p.job;
  const type=a.type,settlement=type==='collection'||type==='payment',credit=type==='sales credit'||type==='vendor credit';
  if(settlement){
    check(a.lines===undefined,'A settlement records an amount, not selected lines.');
    Object.assign(e,{item:p.item,qty:p.qty,unit:p.unit,location:p.location});
    e.applied=positive(a.amount);check(e.applied<=outstanding(c,p),'Amount exceeds open balance.');e.total=e.applied;
    journal(c,e,type==='collection'?lines2('1000','1100',e.applied):lines2('2000','1000',e.applied));return;
  }
  check(quantitySteps.includes(type)||a.lines===undefined,'This operation copies all source lines.');
  const rows=quantitySteps.includes(type)?selectedLines(c,p,type,a.lines):structuredClone(p.lines);
  const jl=[], product=l=>byId(c.items,l.item).kind==='Product';
  if(type==='fulfillment')for(const l of rows)if(product(l)){l.cost=removeStock(c,e,l.item,l.location,l.qty);jl.push(...lines2('5000','1200',l.cost));}
  if(type==='receiving')for(const l of rows)if(product(l)){move(c,e,l.item,l.location,l.qty,l.total);jl.push(...lines2('1200','2050',l.total));}
  sumDoc(e,rows);
  if(type==='invoice')jl.push(...lines2('1100','4000',e.total));
  if(type==='bill')for(const l of rows)jl.push(...lines2(product(l)?'2050':'5100','2000',l.total));
  if(credit){
    check(c.docs.filter(x=>x.parent===p.id).every(x=>x.date<=e.date),'Credit date precedes an existing settlement.');
    e.applied=Math.min(e.total,outstanding(c,p));e.refund=e.total-e.applied;
    const sales=type==='sales credit';
    jl.push(...(sales?[['4000',e.total],['1100',-e.applied],['1000',-e.refund]]:[['2000',e.applied],['1000',e.refund]]));
    for(const l of rows){
      if(product(l)){
        if(sales){move(c,e,l.item,l.location,l.qty,l.cost);jl.push(...lines2('1200','5000',l.cost));}
        else {const cost=removeStock(c,e,l.item,l.location,l.qty);jl.push(['1200',-cost],['5200',cost-l.total]);}
      } else if(!sales)jl.push(['5100',-l.total]);
    }
  }
  journal(c,e,jl);
}
function child(c,p,kind){return c.docs.find(x=>x.parent===p.id&&x.kind===kind);}
export function nextSteps(c,p){
  const chain={quote:'sales order','sales order':'fulfillment',fulfillment:'invoice','purchase order':'receiving',receiving:'bill'};
  if(chain[p.kind]){
    const kind=chain[p.kind],open=p.lines&&quantitySteps.includes(kind)?availableDocumentLines(c,p,kind).length>0:!child(c,p,kind);
    return open?[kind]:[];
  }
  if(['invoice','bill'].includes(p.kind)){
    const sale=receivable(p), credit=sale?'sales credit':'vendor credit';
    return [...(outstanding(c,p)>0?[sale?'collection':'payment']:[]),...((p.lines?availableDocumentLines(c,p,credit).length>0:!child(c,p,credit))?[credit]:[])];
  }
  return [];
}
function commerce(c,a,e){
  const source=a.parent?byId(c.docs,a.parent):null;
  if(['quote','purchase order'].includes(a.type))check(!source,'New commercial documents do not have a source.');
  if(source?.lines||(!source&&['quote','purchase order'].includes(a.type)&&Object.hasOwn(a,'lines'))){
    if(source){check(nextSteps(c,source).includes(a.type),'That step is already complete or unavailable.');check(e.date>=source.date,'Document date precedes its source.');}
    multiCommerce(c,a,e,source);c.docs.push(e);return;
  }
  check(a.lines===undefined,'A legacy document must follow its original whole-document workflow.');
  if(['quote','purchase order'].includes(a.type)){
    const p=byId(c.parties,a.party), item=byId(c.items,a.item);
    check(p.kind===(a.type==='quote'?'Customer':'Vendor'),'Select a matching contact.');
    if(a.job)byId(c.jobs,a.job);
    const qty=positive(a.qty),unit=positive(a.unit);
    Object.assign(e,{party:p.id,item:item.id,qty,unit,total:integer(Number(BigInt(qty)*BigInt(unit))),location:name(a.location||'Main'),job:a.job||''});
  }else{
    const p=byId(c.docs,a.parent), item=byId(c.items,p.item);
    check(nextSteps(c,p).includes(a.type),'That step is already complete or unavailable.');
    check(e.date>=p.date,'Document date precedes its source.');
    for(const k of ['party','item','qty','unit','total','location','job'])e[k]=p[k];
    e.parent=p.id;
    if(a.type==='fulfillment'&&item.kind==='Product'){
      e.cost=removeStock(c,e,p.item,p.location,p.qty);journal(c,e,lines2('5000','1200',e.cost));
    }
    if(a.type==='invoice')journal(c,e,lines2('1100','4000',e.total));
    if(a.type==='receiving'&&item.kind==='Product'){
      move(c,e,p.item,p.location,p.qty,p.total);journal(c,e,lines2('1200','2050',p.total));
    }
    if(a.type==='bill')journal(c,e,lines2(item.kind==='Product'?'2050':'5100','2000',e.total));
    if(['collection','payment'].includes(a.type)){
      e.applied=positive(a.amount);check(e.applied<=outstanding(c,p),'Amount exceeds open balance.');e.total=e.applied;
      journal(c,e,a.type==='collection'?lines2('1000','1100',e.applied):lines2('2000','1000',e.applied));
    }
    if(['sales credit','vendor credit'].includes(a.type)){
      check(c.docs.filter(x=>x.parent===p.id).every(x=>x.date<=e.date),'Credit date precedes an existing settlement.');
      e.applied=outstanding(c,p);e.refund=p.total-e.applied;
      const sales=a.type==='sales credit';
      const jl=sales?[['4000',p.total],['1100',-e.applied],['1000',-e.refund]]:[['2000',e.applied],['1000',e.refund]];
      if(item.kind==='Product'){
        if(sales){
          const cost=byId(c.docs,p.parent).cost;move(c,e,p.item,p.location,p.qty,cost);jl.push(['1200',cost],['5000',-cost]);
        }else{
          const cost=removeStock(c,e,p.item,p.location,p.qty);jl.push(['1200',-cost],['5200',cost-p.total]);
        }
      }else if(!sales)jl.push(['5100',-p.total]);
      journal(c,e,jl);
    }
  }
  c.docs.push(e);
}
const commerceKinds=['quote','sales order','fulfillment','invoice','collection','sales credit','purchase order','receiving','bill','payment','vendor credit'];
const manualAccounts=['1000','3000','4000','5000','5100','5200'];
export {manualAccounts};
export function apply(state,company,action){
  if(deskTypes.has(action?.type))return applyDesk(state,company,action,apply);
  const s=structuredClone(state), c=byId(s.companies,company), a=action;
  const e=event(c,a.type,a.date,a.label||a.name||a.type);
  if(a.requestId){name(a.requestId);check(!c.history.some(x=>x.requestId===a.requestId),'Duplicate operation.');e.requestId=a.requestId;}
  const setup=['settings','company','group','contact','item','job','employee','attachment'];
  check(setup.includes(a.type)||!c.closedThrough||e.date>c.closedThrough,'This accounting period is closed.');
  if(commerceKinds.includes(a.type))commerce(c,a,e);
  else switch(a.type){
    case 'company':s.companies.push(newBook(a.name,a.activities));break;
    case 'settings':
      check(a.activities.every(x=>activities.includes(x))&&a.featured.every(x=>modules.includes(x)),'Invalid navigation selection.');
      c.name=name(a.name);c.activities=[...new Set(a.activities)];c.featured=[...new Set(a.featured)];break;
    case 'contact':check(['Customer','Vendor'].includes(a.kind),'Choose a contact type.');c.parties.push({id:e.id,name:name(a.name),kind:a.kind});break;
    case 'item':check(['Product','Service'].includes(a.kind),'Choose an item type.');c.items.push({id:e.id,name:name(a.name),kind:a.kind});break;
    case 'job':c.jobs.push({id:e.id,name:name(a.name)});break;
    case 'employee':check(/^[A-Z]{2}$/.test(a.state),'Use a two-letter work state.');c.employees.push({id:e.id,name:name(a.name),rate:positive(a.rate),state:a.state,locality:name(a.locality)});break;
    case 'time':{
      const person=byId(c.employees,a.employee);byId(c.jobs,a.job);
      const minutes=positive(a.minutes);check(minutes<=1440,'Daily time exceeds 24 hours.');
      check(sum(c.time.filter(x=>x.employee===a.employee&&x.date===e.date).map(x=>x.minutes))+minutes<=1440,'Employee total exceeds 24 hours.');
      c.time.push({id:e.id,date:e.date,employee:person.id,job:a.job,minutes,rate:person.rate,cost:ratio(person.rate,minutes,60),approved:false});break;
    }
    case 'approve time':{const t=byId(c.time,a.time);check(!t.approved&&e.date>=t.date,'Time already approved or dated later.');t.approved=true;t.approval=e.id;break;}
    case 'job expense':byId(c.jobs,a.job);e.job=a.job;e.cost=positive(a.amount);journal(c,e,lines2('5100','1000',e.cost));break;
    case 'adjust in':case 'adjust out':case 'transfer':{
      check(byId(c.items,a.item).kind==='Product','Select a stock item.');const q=positive(a.qty),loc=name(a.location);
      if(a.type==='adjust in'){const cost=positive(a.amount);move(c,e,a.item,loc,q,cost);journal(c,e,lines2('1200','5200',cost));}
      else {if(a.type==='transfer')check(name(a.to)!==loc,'Choose a different destination.');const cost=removeStock(c,e,a.item,loc,q);
        if(a.type==='transfer')move(c,e,a.item,a.to,q,cost);else journal(c,e,lines2('5200','1200',cost));}break;
    }
    case 'assemble':{
      check(byId(c.items,a.item).kind==='Product','Select a finished stock item.');
      check(Array.isArray(a.components)&&a.components.length>0,'Add components.');
      const total=sum(a.components.map(r=>{check(r.item!==a.item&&byId(c.items,r.item).kind==='Product','Select a different stock component.');return removeStock(c,e,r.item,name(a.location),positive(r.qty));}));
      move(c,e,a.item,a.location,positive(a.qty),total);break;
    }
    case 'asset':{
      const cost=positive(a.amount),residual=integer(a.residual),months=positive(a.months);
      check(residual>=0&&residual<cost&&months<=600,'Check residual value and useful life (1–600 months).');
      c.assets.push({id:e.id,name:name(a.name),date:e.date,cost,residual,months,charges:[]});journal(c,e,lines2('1500','1000',cost),'Investing');break;
    }
    case 'depreciate':{
      const asset=byId(c.assets,a.asset), n=asset.charges.length+1;
      const month=v=>Number(v.slice(0,4))*12+Number(v.slice(5,7));
      check(n<=asset.months&&e.date>=asset.date&&month(e.date)===month(asset.date)+n-1,'Post each monthly charge in sequence, starting in the acquisition month.');
      const basis=asset.cost-asset.residual, charge=ratio(basis,n,asset.months)-ratio(basis,n-1,asset.months);
      asset.charges.push({source:e.id,date:e.date,cents:charge});journal(c,e,lines2('5300','1590',charge));break;
    }
    case 'journal':{
      check(a.lines.every(([code])=>manualAccounts.includes(code)),'Use the linked workflow for this control account.');
      check(a.lines.filter(([,n])=>n).length>=2&&new Set(a.lines.map(([code])=>code)).size>=2,'Add at least two distinct accounts.');
      journal(c,e,a.lines,a.flow);break;
    }
    case 'reverse journal':{
      const j=byId(c.entries,a.entry);check(c.history.some(x=>x.id===j.source&&x.kind==='journal')&&!c.entries.some(x=>x.reverses===j.id)&&e.date>=j.date,'Select an unreversed manual journal on or before this date.');
      journal(c,e,j.lines.map(l=>[l.account,-l.cents]),j.flow,{reverses:j.id});break;
    }
    case 'close':check(!c.closedThrough||c.closedThrough<e.date,'Choose a later close date.');c.closedThrough=e.date;break;
    case 'group':{
      const members=[...new Set(a.members)];check(members.length>=2,'Select at least two companies.');members.forEach(k=>byId(s.companies,k));
      s.groups.push({id:e.id,name:name(a.name),members});break;
    }
    case 'intercompany':{
      const other=byId(s.companies,a.other);check(c.id!==other.id&&(!other.closedThrough||other.closedThrough<e.date),'Choose another company with an open period.');
      const amt=positive(a.amount),otherEvent=event(other,'intercompany',e.date,e.label);
      other.history.push(otherEvent);journal(c,e,lines2('1150','4100',amt),'Operating',{pair:e.id,other:other.id});
      journal(other,otherEvent,lines2('5150','2100',amt),'Operating',{pair:e.id,other:c.id});break;
    }
    case 'statement import':{
      check(a.rows.length>0,'No new statement lines to import.');
      const refs=new Set(c.bank.map(x=>x.sourceRef));for(const row of a.rows){
        check(!refs.has(row.sourceRef),'Statement includes a duplicate row.');refs.add(row.sourceRef);date(row.date);integer(row.amountCents);
        check(!c.reconciliations.length||row.date>c.reconciliations.at(-1).date,'A new statement line falls within a reconciled statement.');
        check(typeof row.sourceRef==='string'&&row.sourceRef.length>0&&typeof row.description==='string','Invalid bank row.');
        check(row.statementKey===undefined||(typeof row.statementKey==='string'&&/^[a-f0-9]{64}$/.test(row.statementKey)),'Invalid statement identity.');
        c.bank.push({id:id(),source:e.id,sourceRef:row.sourceRef,description:row.description,date:row.date,amountCents:row.amountCents,match:'',...(row.statementKey?{statementKey:row.statementKey}:{})});
      }break;
    }
    case 'match':{
      const row=byId(c.bank,a.row),entry=byId(c.entries,a.entry);
      check(!row.match&&!c.bank.some(x=>x.match===a.entry),'Line or entry already matched.');
      check(!openingClearedCashIds(c).has(entry.id),'This cash entry is already cleared in the opening balance.');
      check(sum(entry.lines.filter(l=>l.account==='1000').map(l=>l.cents))===row.amountCents,'Cash amounts must match.');
      check(e.date>=row.date&&e.date>=entry.date,'Match date precedes one of the records.');row.match=entry.id;break;
    }
    case 'reconcile':{
      const prev=c.reconciliations.at(-1);
      check(!prev||e.date>prev.date,'Choose a later statement closing date.');
      const reconciledIds=new Set(c.reconciliations.flatMap(r=>r.rows));
      const rows=c.bank.filter(x=>x.date<=e.date&&!reconciledIds.has(x.id));
      check(rows.length&&rows.every(r=>r.match&&byId(c.entries,r.match).date<=e.date),'Match every eligible statement line to an entry dated within the cutoff.');
      let opening=prev?.closing??0,openingBasis;
      if(a.openingBasis!==undefined){
        check(!prev,'Only the first reconciliation can establish an opening bank balance.');
        const basis=a.openingBasis;
        check(basis&&Array.isArray(basis.outstanding),'Select the opening outstanding entries.');
        const through=date(basis.through);
        check(through<e.date,'The opening date must be before the statement ending date.');
        check(rows.every(r=>r.date>through),'Imported lines overlap the opening date. Choose an earlier opening date or reconcile those lines first.');
        const priorCash=c.entries.filter(j=>j.date<=through&&cashMovement(j)!==0);
        const outstanding=new Set(basis.outstanding);
        check(outstanding.size===basis.outstanding.length&&basis.outstanding.every(k=>priorCash.some(j=>j.id===k)),'An opening outstanding entry is missing or after the opening date.');
        const cleared=priorCash.filter(j=>!outstanding.has(j.id));
        const clearedSet=new Set(cleared.map(j=>j.id));
        check(rows.every(r=>!clearedSet.has(r.match)),'A statement line matches an entry before the opening date. Mark that entry outstanding at opening or choose an earlier opening date.');
        opening=integer(basis.balance);
        check(sum(cleared.map(cashMovement))===opening,'The posted cash cleared at opening must equal the opening bank balance.');
        openingBasis={through,cleared:[...clearedSet]};
      }
      const closing=integer(a.closing);check(sum([opening,...rows.map(x=>x.amountCents)])===closing,'Opening balance plus statement movement differs from closing balance.');
      const clearedIds=new Set([...reconciledIds,...rows.map(r=>r.id)]);
      const clearedEntries=new Set(c.bank.filter(r=>clearedIds.has(r.id)).map(r=>r.match));
      for(const k of openingBasis?.cleared??openingClearedCashIds(c))clearedEntries.add(k);
      const outstandingCash=balance({entries:c.entries.filter(j=>!clearedEntries.has(j.id))},'1000',e.date);
      const bookCash=balance(c,'1000',e.date);
      check(sum([closing,outstandingCash])===bookCash,'Adjusted statement balance differs from book cash.');
      c.reconciliations.push({id:e.id,date:e.date,opening,closing,outstandingCash,bookCash,rows:rows.map(x=>x.id),...(openingBasis?{openingBasis}:{})});break;
    }
    case 'attachment':{
      byId(c.history,a.source);check(typeof a.data==='string'&&/^[A-Za-z0-9+/]*={0,2}$/.test(a.data)&&a.data.length<=1400000,'Choose a file up to 1 MB.');
      c.attachments.push({id:e.id,source:a.source,name:name(a.name),data:a.data});break;
    }
    default:throw new Error('Unknown operation.');
  }
  c.history.push(e);return s;
}
export function jobSummary(c,id){
  byId(c.jobs,id);
  const related=new Set([...c.docs.filter(d=>d.job===id),...c.history.filter(e=>e.job===id)].map(d=>d.id));
  const lines=c.entries.filter(e=>related.has(e.source)).flatMap(e=>e.lines);
  const revenue=-sum(lines.filter(l=>accounts[l.account][1]==='Revenue').map(l=>l.cents));
  const postedCost=sum(lines.filter(l=>accounts[l.account][1]==='Expense').map(l=>l.cents));
  const labor=sum(c.time.filter(t=>t.approved&&t.job===id).map(t=>t.cost));
  return {revenue,postedCost,labor,margin:sum([revenue,-postedCost,-labor])};
}
export function statements(entries,from='0001-01-01',through='9999-12-31'){
  date(from);date(through);check(from<=through,'Start date exceeds end date.');
  const all=entries.filter(e=>e.date<=through), period=all.filter(e=>e.date>=from);
  const balances=Object.fromEntries(Object.keys(accounts).map(code=>[code,balance({entries:all},code)]));
  const movement=Object.fromEntries(Object.keys(accounts).map(code=>[code,balance({entries:period},code)]));
  const total=(group,map)=>sum(Object.entries(map).filter(([k])=>accounts[k][1]===group).map(([,n])=>n));
  const revenue=-total('Revenue',movement),expenses=total('Expense',movement);
  const assets=total('Asset',balances),liabilities=-total('Liability',balances),capital=-total('Equity',balances);
  const earnings=-sum([total('Revenue',balances),total('Expense',balances)]);
  const cashFlow=Object.fromEntries(['Operating','Investing','Financing'].map(f=>[f,balance({entries:period.filter(e=>e.flow===f)},'1000')]));
  return {balances,movement,revenue,expenses,income:sum([revenue,-expenses]),assets,liabilities,capital,earnings,cashFlow,
    openingCash:sum([balances['1000'],-movement['1000']]),closingCash:balances['1000'],trialDifference:sum(Object.values(balances))};
}
export function consolidate(s,g,from,through){
  const group=byId(s.groups,g),members=group.members.map(k=>byId(s.companies,k)),entries=members.flatMap(c=>c.entries);
  const eliminations=members.flatMap(c=>c.entries.filter(e=>e.pair&&group.members.includes(e.other)).map(e=>{
    const partner=byId(members,e.other).entries.filter(x=>x.pair===e.pair&&x.other===c.id&&x.date===e.date);
    check(partner.length===1,'Intercompany link is incomplete.');
    return {...e,id:'eliminate-'+e.id,source:e.id,memo:'Eliminate '+e.memo,company:c.id,lines:e.lines.map(l=>({...l,cents:-l.cents}))};
  }));
  return {members:members.map(c=>({id:c.id,name:c.name,report:statements(c.entries,from,through)})),eliminations:eliminations.filter(e=>(!through||e.date<=through)&&(!from||e.date>=from)),report:statements([...entries,...eliminations],from,through)};
}
export function validateState(s){
  check(s?.format==='fieldledger.erp'&&s.schema===1&&s.edition==='Lite'&&s.currency==='USD'&&Array.isArray(s.companies)&&s.companies.length>0&&Array.isArray(s.groups),'Unsupported portable data format.');
  const unique=rows=>{check(Array.isArray(rows)&&rows.every(x=>typeof x?.id==='string'&&x.id.length>0)&&new Set(rows.map(x=>x.id)).size===rows.length,'Invalid or repeated record ID.');};
  unique(s.companies);unique(s.groups);
  for(const c of s.companies){
    name(c.name);integer(c.sequence);if(c.closedThrough)date(c.closedThrough);
    check(c.activities.every(x=>activities.includes(x))&&c.featured.every(x=>modules.includes(x)),'Invalid company settings.');
    for(const k of ['parties','items','jobs','employees','time','docs','moves','entries','assets','bank','reconciliations','history','attachments'])unique(c[k]);
    for(const e of c.history){date(e.date);name(e.label);}
    for(const p of c.parties){name(p.name);check(['Customer','Vendor'].includes(p.kind),'Invalid contact type.');}
    for(const i of c.items){name(i.name);check(['Product','Service'].includes(i.kind),'Invalid item type.');}
    for(const j of c.jobs)name(j.name);
    for(const p of c.employees){name(p.name);name(p.locality);positive(p.rate);check(/^[A-Z]{2}$/.test(p.state),'Invalid work state.');}
    for(const d of c.docs){check(commerceKinds.includes(d.kind),'Invalid document type.');date(d.date);}
    const recordedHistory=new Map(c.history.map(e=>[e.id,e])),docIds=new Map(c.docs.map(d=>[d.id,d])),priorChildren=new Map();
    for(const d of c.docs){const recorded=recordedHistory.get(d.id);check(recorded,'Commercial history is missing.');byId(c.items,d.item);byId(c.parties,d.party);if(d.parent)byId(c.docs,d.parent);if(d.job)byId(c.jobs,d.job);positive(d.qty);integer(d.total);
      if(Object.hasOwn(d,'lines')){
        check(Array.isArray(d.lines)&&d.lines.length>0&&d.lines.length<=100&&new Set(d.lines.map(l=>l.lineId)).size===d.lines.length,'Invalid commercial lines.');
        for(const l of d.lines){check(/^L[1-9]\d{0,2}$/.test(l.lineId),'Invalid commercial line ID.');byId(c.items,l.item);name(l.location);positive(l.qty);positive(l.unit);check(integer(l.discount)>=0&&l.discount<=lineMoney(l.qty,l.unit)&&l.total===lineMoney(l.qty,l.unit)-l.discount,'Commercial line total does not balance.');if(l.cost!==undefined)check(integer(l.cost)>=0,'Invalid line cost.');}
        const first=d.lines[0];check(d.item===first.item&&d.qty===first.qty&&d.unit===first.unit&&d.location===first.location&&d.total===sum(d.lines.map(l=>l.total)),'Commercial document total does not balance.');
        check(recorded.kind===d.kind&&recorded.total===d.total&&JSON.stringify(recorded.lines)===JSON.stringify(d.lines),'Commercial lines differ from posting history.');
        if(d.parent){
          const source=docIds.get(d.parent);
          check(source?.lines&&source.kind===commercialSourceKind[d.kind]&&source.party===d.party&&source.job===d.job&&source.date<=d.date&&source.number<d.number,'Commercial document is inconsistent with its source.');
          const used=(priorChildren.get(d.parent)||new Map()).get(d.kind)||new Map();
          if(!quantitySteps.includes(d.kind))check(!used.size&&JSON.stringify(d.lines)===JSON.stringify(source.lines),'Copied commercial lines differ from their source.');
          else{
            const src=new Map(source.lines.map(l=>[l.lineId,l]));
            for(const line of d.lines){
              const origin=src.get(line.lineId),q=used.get(line.lineId)||0,newQ=sum([q,line.qty]);
              check(origin&&line.item===origin.item&&line.unit===origin.unit&&line.location===origin.location&&newQ<=origin.qty,'Commercial line is inconsistent with its source or over-processed.');
              check(line.discount===ratio(origin.discount,newQ,origin.qty)-ratio(origin.discount,q,origin.qty),'Commercial discount differs from its source allocation.');
              if(origin.cost!==undefined)check(line.cost===ratio(origin.cost,newQ,origin.qty)-ratio(origin.cost,q,origin.qty),'Commercial cost differs from its source allocation.');
              if(d.kind==='fulfillment'&&byId(c.items,line.item).kind==='Product')check(Number.isSafeInteger(line.cost),'Fulfillment stock cost is missing.');
            }
          }
          for(const line of d.lines)used.set(line.lineId,sum([used.get(line.lineId)||0,line.qty]));
          if(!priorChildren.has(d.parent))priorChildren.set(d.parent,new Map());
          priorChildren.get(d.parent).set(d.kind,used);
        }else check(['quote','purchase order'].includes(d.kind),'Commercial document source is missing.');
      }
    }
    for(const e of c.entries){byId(c.history,e.source);date(e.date);check(e.lines.length>=2&&e.lines.every(l=>Object.hasOwn(accounts,l.account))&&sum(e.lines.map(l=>l.cents))===0,'Invalid posted journal.');}
    for(const t of c.time){date(t.date);byId(c.jobs,t.job);byId(c.employees,t.employee);positive(t.minutes);integer(t.cost);if(t.approved)byId(c.history,t.approval);}
    for(const m of c.moves){date(m.date);byId(c.history,m.source);byId(c.items,m.item);integer(m.qty);integer(m.value);}
    for(const a of c.assets){name(a.name);date(a.date);positive(a.cost);positive(a.months);integer(a.residual);for(const t of a.charges){integer(t.cents);byId(c.history,t.source);}}
    for(const r of c.bank){date(r.date);integer(r.amountCents);if(r.match)byId(c.entries,r.match);check(r.statementKey===undefined||(typeof r.statementKey==='string'&&/^[a-f0-9]{64}$/.test(r.statementKey)),'Invalid bank statement identity.');}
    for(const [i,r] of c.reconciliations.entries()){
      date(r.date);integer(r.opening);integer(r.closing);r.rows.forEach(k=>byId(c.bank,k));
      if(r.openingBasis!==undefined){
        const {through,cleared}=r.openingBasis;
        check(i===0&&date(through)<r.date&&Array.isArray(cleared)&&new Set(cleared).size===cleared.length,'Invalid opening bank reconciliation basis.');
        const entries=cleared.map(k=>byId(c.entries,k));
        check(entries.every(j=>j.date<=through&&cashMovement(j)!==0)&&sum(entries.map(cashMovement))===r.opening,'Invalid opening cash amounts.');
        const opened=new Set(cleared);
        check(c.bank.every(b=>!opened.has(b.match)&&b.date>through),'Bank lines overlap cleared opening cash.');
      }
    }
    for(const a of c.attachments)byId(c.history,a.source);
    validateDesk(c);
    validatePlanning(c);
    validateManualPayroll(c.manualPayroll,c);
    check(balance(c,'1200')===sum(c.moves.map(x=>x.value)),'Stock value differs from ledger.');
    check(balance(c,'1100')===sum(c.docs.filter(d=>d.kind==='invoice').map(d=>outstanding(c,d)))&&-balance(c,'2000')===sum(c.docs.filter(d=>d.kind==='bill').map(d=>outstanding(c,d))),'Open documents differ from ledger.');
  }
  for(const g of s.groups){g.members.forEach(k=>byId(s.companies,k));consolidate(s,g.id);}
  return true;
}

