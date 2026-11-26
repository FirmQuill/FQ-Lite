// Purposefully separate from the journal: collecting due dates creates drafts only.
import {accounts,apply,check,date,integer,outstanding,sum} from './core.mjs';

const version=1, empty=()=>({version,schedules:[],drafts:[],budgets:[]});
const frequency=new Set(['weekly','monthly','quarterly','yearly']);
const modes={invoice:['Customer','quote'],bill:['Vendor','purchase order']};
const ymd=d=>d.toISOString().slice(0,10);
const fromDay=s=>new Date(date(s)+'T00:00:00Z');
export function localPlanningDay(now=new Date()){
  return date([now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-'));
}
function plus(day,n){const d=fromDay(day);d.setUTCDate(d.getUTCDate()+n);return date(ymd(d));}
export function recurrenceDay(start,interval,index){
  check(frequency.has(interval),'Choose a recurrence frequency.');
  check(Number.isInteger(index)&&index>=0&&index<=525000,'Invalid recurrence sequence.');
  if(interval==='weekly')return plus(start,7*index);
  const d=fromDay(start), normalized=new Date(d), origin=d.getUTCDate();
  normalized.setUTCDate(1);normalized.setUTCMonth(normalized.getUTCMonth()+index*({monthly:1,quarterly:3,yearly:12}[interval]));
  const last=new Date(normalized);last.setUTCMonth(last.getUTCMonth()+1,0);
  normalized.setUTCDate(Math.min(origin,last.getUTCDate()));return date(ymd(normalized));
}
const label=s=>{check(typeof s==='string'&&s.trim().length>0&&s.trim().length<=160,'Enter text between 1 and 160 characters.');return s.trim();};
const id=s=>{check(typeof s==='string'&&/^[a-zA-Z0-9:_-]{1,160}$/.test(s),'Invalid planning record ID.');return s;};
const positive=n=>{check(integer(n)>0,'Enter an amount or quantity greater than zero.');return n;};
function plain(o){return !!o&&typeof o==='object'&&!Array.isArray(o);}
function get(rows,key){return rows.find(r=>r.id===key);}
function need(rows,key,thing){const r=get(rows,key);check(r,'Choose a valid '+thing+'.');return r;}
function validationTemplate(c,x){
  check(plain(x)&&Object.hasOwn(modes,x.kind),'Choose invoice or bill.');
  label(x.name);label(x.location);check(get(c.parties,x.party)?.kind===modes[x.kind][0],'Choose the matching contact type.');
  need(c.items,x.item,'item');if(x.job)need(c.jobs,x.job,'project');positive(x.quantity);positive(x.unitCents);
  return integer(Number(BigInt(x.quantity)*BigInt(x.unitCents)));
}
export function validatePlanning(c){
  if(c.planning===undefined)return true;
  const p=c.planning;check(plain(p)&&p.version===version,'Invalid planning data.');
  const ids=new Set();
  for(const key of ['schedules','drafts','budgets']){
    check(Array.isArray(p[key]),'Invalid planning records.');
    for(const x of p[key]){check(plain(x)&&!ids.has(id(x.id)),'Duplicate planning record ID.');ids.add(x.id);}
  }
  const issued=new Set();
  for(const s of p.schedules){
    validationTemplate(c,s);date(s.start);check(frequency.has(s.frequency),'Choose a recurrence frequency.');
    check(typeof s.active==='boolean','Invalid recurrence state.');
    check(Number.isInteger(s.nextIndex)&&s.nextIndex>=0&&s.nextIndex<=525000,'Invalid recurrence sequence.');
    if(s.end){date(s.end);check(s.end>=s.start,'End date precedes start date.');}
  }
  for(const d of p.drafts){
    validationTemplate(c,d);const s=need(p.schedules,d.schedule,'schedule');date(d.due);
    check(Number.isInteger(d.index)&&d.index>=0&&d.index<s.nextIndex&&d.due===recurrenceDay(s.start,s.frequency,d.index)&&(!s.end||d.due<=s.end),'Invalid draft date.');
    const event=s.id+':'+d.index;check(!issued.has(event),'Duplicate recurrence draft.');issued.add(event);
    check(['draft','discarded','converted'].includes(d.status),'Invalid draft status.');
    if(d.status==='converted')check(get(c.docs,d.document)?.kind===modes[d.kind][1],'Draft document link is invalid.');
    else check(!d.document,'Unexpected draft document link.');
  }
  for(const b of p.budgets){need(c.jobs,b.job,'project');label(b.name);date(b.from);date(b.through);check(b.from<=b.through,'Budget end precedes the start.');positive(b.limit);}
  return true;
}

export const planningOf=c=>c.planning??empty();
export function catchUpPlanning(state,day){
  date(day);let copy=state,generated=0;
  const hasDue=c=>planningOf(c).schedules.some(s=>s.active&&recurrenceDay(s.start,s.frequency,s.nextIndex)<=day&&(!s.end||recurrenceDay(s.start,s.frequency,s.nextIndex)<=s.end));
  if(!state.companies.some(hasDue))return {state,generated};
  copy=structuredClone(state);
  for(const c of copy.companies){
    if(!c.planning)continue;
    for(const s of c.planning.schedules){
      if(!s.active)continue;
      // Cap each catch-up batch, not the schedule. A subsequent pass resumes safely.
      for(let n=0;n<120;n++){
        const due=recurrenceDay(s.start,s.frequency,s.nextIndex);
        if(due>day||(s.end&&due>s.end))break;
        const index=s.nextIndex++;
        c.planning.drafts.push({id:crypto.randomUUID(),schedule:s.id,index,due,kind:s.kind,name:s.name,party:s.party,item:s.item,quantity:s.quantity,unitCents:s.unitCents,location:s.location,job:s.job,status:'draft',document:''});
        generated++;
      }
    }
    validatePlanning(c);
  }
  return {state:copy,generated};
}

export function planningCommand(state,companyId,action,today){
  date(today);const cloned=structuredClone(state),c=need(cloned.companies,companyId,'company');
  const p=c.planning??=empty();
  if(action.type==='schedule-create'){
    check(frequency.has(action.frequency),'Choose a recurrence frequency.');
    const s={id:crypto.randomUUID(),kind:action.kind,name:label(action.name),party:id(action.party),item:id(action.item),quantity:positive(action.quantity),unitCents:positive(action.unitCents),location:label(action.location||'Main'),job:action.job?id(action.job):'',start:date(action.start),end:action.end?date(action.end):'',frequency:action.frequency,nextIndex:0,active:true};
    validationTemplate(c,s);p.schedules.push(s);
  }else if(action.type==='schedule-active'){
    check(typeof action.active==='boolean','Invalid schedule state.');
    need(p.schedules,action.id,'schedule').active=action.active;
  }else if(action.type==='budget-save'){
    const b={id:action.id?id(action.id):crypto.randomUUID(),name:label(action.name),job:id(action.job),from:date(action.from),through:date(action.through),limit:positive(action.limit)};
    if(action.id){const old=need(p.budgets,action.id,'budget');Object.assign(old,b);}else p.budgets.push(b);
  }else if(['draft-copy','draft-discard'].includes(action.type)){
    const d=need(p.drafts,action.id,'draft');check(d.status==='draft','This draft has already been resolved.');
    if(action.type==='draft-discard')d.status='discarded';
    else {
      // Sales and purchasing both start as a nonposting source document.
      const next=apply(cloned,c.id,{type:modes[d.kind][1],date:date(action.date||today),requestId:'planning-'+d.id,party:d.party,item:d.item,qty:action.quantity===undefined?d.quantity:positive(action.quantity),unit:action.unitCents===undefined?d.unitCents:positive(action.unitCents),location:d.location,job:d.job,label:action.name===undefined?d.name:label(action.name)});
      const target=need(next.companies,c.id,'company'), persisted=need(target.planning.drafts,d.id,'draft');
      persisted.status='converted';persisted.document=target.docs.at(-1).id;
      validatePlanning(target);return {state:next,generated:0};
    }
  }else if(action.type!=='catch-up')throw Error('Unknown planning action.');
  validatePlanning(c);
  return catchUpPlanning(cloned,today);
}

export function plannedActual(c,b){
  const docs=new Set(c.docs.filter(d=>d.job===b.job).map(d=>d.id));
  const sources=new Set(c.history.filter(e=>e.job===b.job).map(e=>e.id));
  // Reach document descendants and journal reversals even when a legacy record omitted job.
  for(let changed=true;changed;){
    changed=false;
    for(const d of c.docs)if(!docs.has(d.id)&&docs.has(d.parent)){docs.add(d.id);changed=true;}
  }
  const entries=new Set();
  for(let changed=true;changed;){
    changed=false;
    for(const e of c.entries)if(!entries.has(e.id)&&(docs.has(e.source)||sources.has(e.source)||entries.has(e.reverses))){entries.add(e.id);changed=true;}
  }
  const inside=x=>x>=b.from&&x<=b.through;
  const lines=c.entries.filter(e=>inside(e.date)&&entries.has(e.id)).flatMap(e=>e.lines);
  const postedCosts=sum(lines.filter(l=>accounts[l.account]?.[1]==='Expense').map(l=>l.cents));
  const approvedLabor=sum(c.time.filter(t=>t.job===b.job&&t.approved&&inside(t.date)).map(t=>t.cost));
  const actual=sum([postedCosts,approvedLabor]);
  return {postedCosts,approvedLabor,actual,remaining:sum([b.limit,-actual])};
}

export function planningSummary(c,today,extraRenewals=[]){
  date(today);const horizon=plus(today,60),p=planningOf(c);
  const renewals=[...new Map([...(c.desk?.contracts||[]).map(r=>({id:r.id,name:r.name,date:r.status==='Active'?r.renewal:''})),...extraRenewals].map(r=>[r.id,r])).values()].filter(r=>r.date&&r.date<=horizon);
  const openBills=c.docs.filter(d=>d.kind==='bill').map(d=>({id:d.id,date:d.dueDate||d.date,estimate:!d.dueDate,name:d.label,outstanding:outstanding(c,d)})).filter(d=>d.outstanding>0&&d.date<=horizon);
  const recurringBills=p.schedules.filter(s=>s.active&&s.kind==='bill').map(s=>({id:s.id,name:s.name,date:recurrenceDay(s.start,s.frequency,s.nextIndex),end:s.end})).filter(s=>s.date<=horizon&&(!s.end||s.date<=s.end));
  const plannedBills=p.drafts.filter(d=>d.kind==='bill'&&d.status==='draft'&&d.due<=horizon).map(d=>({id:d.id,name:d.name,date:d.due}));
  const sort=(a,b)=>a.date.localeCompare(b.date);
  return {renewals:renewals.sort(sort),openBills:openBills.sort(sort),recurringBills:[...plannedBills,...recurringBills].sort(sort),budgets:p.budgets.map(b=>({...b,...plannedActual(c,b)}))};
}
