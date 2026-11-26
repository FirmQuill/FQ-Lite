import {cents,check} from './core.mjs';
import {btn,esc,input,mapping,money,panel,select,table} from './views.mjs';
import {planningOf,planningSummary,recurrenceDay} from './planning-core.mjs';

const when=(name,label,value)=>input(name,label,'date',value);
const opt=(name,label,rows,selected='')=>`<label>${esc(label)}<select name="${name}">${rows.map(([v,l])=>`<option value="${esc(v)}"${v===selected?' selected':''}>${esc(l)}</option>`).join('')}</select></label>`;
const fixed=n=>String(BigInt(n)/100n)+'.'+String(BigInt(n)%100n).padStart(2,'0');
export function renderPlanning(c,day,remote){
  const p=remote?.data||planningOf(c),s=remote?.summary||planningSummary(c,day);
  const dates=x=>esc(x.date);
  return panel('Recurring billing drafts','<p>Schedules create nonposting drafts. An approved draft becomes a quote or purchase order for review; it does not send an invoice, receive stock, or move money.</p>'+table(['Template','Cadence','Next due','State','Action'],p.schedules.map(r=>{
    const next=recurrenceDay(r.start,r.frequency,r.nextIndex);
    return [esc(r.name+' · '+r.kind),esc(r.frequency),r.end&&next>r.end?'Ended':esc(next),r.active?'Active':'Paused',btn(r.active?'plan-pause':'plan-resume',r.active?'Pause':'Resume',r.id)];}),'No billing schedules yet.'),btn('plan-invoice','Schedule invoice')+btn('plan-bill','Schedule bill')+btn('plan-catchup','Refresh due drafts'))+
  panel('Draft inbox',table(['Due','Template','Expected amount','Status','Action'],p.drafts.toReversed().map(d=>[esc(d.due),esc(d.name+' · '+d.kind),money(d.quantity*d.unitCents),esc(d.status),d.status==='draft'?btn('plan-copy',d.kind==='invoice'?'Create quote':'Create purchase order',d.id)+btn('plan-discard','Discard',d.id):d.status==='converted'?btn('detail','View document',d.document):'']),'No due drafts.'))+
  panel('Project budgets','<p>Actual cost uses posted expense entries and approved labor by work date. Keep labor out of manual project expense entries if it is already counted in approved time.</p>'+table(['Project / budget','Period','Budget','Posted expense','Approved labor','Actual','Remaining','Action'],s.budgets.map(b=>[esc((c.jobs.find(j=>j.id===b.job)?.name||'Project')+' · '+b.name),esc(b.from+' to '+b.through),money(b.limit),money(b.postedCosts),money(b.approvedLabor),money(b.actual),money(b.remaining),btn('plan-edit-budget','Edit',b.id)]),'No project budgets.'),btn('plan-new-budget','Add budget'))+
  panel('Upcoming and overdue · 60 days',table(['Open bill','Due / document date','Open USD'],s.openBills.map(b=>[esc(b.name),dates(b)+(b.estimate?' (document date)':''),money(b.outstanding)]),'No open bills in this window.')+
    table(['Recurring vendor bill','Scheduled date'],s.recurringBills.map(b=>[esc(b.name),dates(b)]),'No scheduled bills in this window.')+
    table(['Active contract renewal','Renewal date'],s.renewals.map(b=>[esc(b.name),dates(b)]),'No contract renewals in this window.'));
}
export function planningAction(type,key,c,day,form,save,p=planningOf(c)){
  if(!type.startsWith('plan-'))return false;
  const actions=(op,x={})=>save({type:op,...x});
  if(type==='plan-invoice'||type==='plan-bill'){
    const kind=type.slice(5),party=c.parties.filter(r=>r.kind===(kind==='invoice'?'Customer':'Vendor'));
    check(party.length&&c.items.length,'Add the matching contact and an item in Directory first.');
    form('Schedule '+kind,input('name','Template name')+select('party','Contact',mapping(party))+select('item','Item',mapping(c.items))+
      input('quantity','Quantity','number',1,'min="1" step="1"')+input('price','Unit price (USD)','text','','inputmode="decimal"')+
      input('location','Stock location','text','Main')+opt('job','Project',[['','None'],...mapping(c.jobs)])+
      select('frequency','Frequency',[['monthly','Monthly'],['weekly','Weekly'],['quarterly','Quarterly'],['yearly','Yearly']])+when('start','First scheduled date',day)+
      '<label>Last scheduled date (optional)<input type="date" name="end"></label>','Save schedule',v=>actions('schedule-create',{...v,quantity:Number(v.quantity),unitCents:cents(v.price),kind}));
  }else if(type==='plan-new-budget'||type==='plan-edit-budget'){
    check(c.jobs.length,'Create a project first.');
    const row=type==='plan-edit-budget'?p.budgets.find(b=>b.id===key):null;
    form(row?'Edit project budget':'Add project budget',input('name','Budget name','text',row?.name||'')+opt('job','Project',mapping(c.jobs),row?.job)+
      when('from','Start date',row?.from||day)+when('through','End date',row?.through||day)+input('amount','Cost budget (USD)','text',row?fixed(row.limit):'','inputmode="decimal"'),
      'Save budget',v=>actions('budget-save',{...v,id:row?.id,limit:cents(v.amount)}));
  }else if(type==='plan-copy'){
    const d=p.drafts.find(r=>r.id===key);check(d,'Draft unavailable.');
    form('Create nonposting document',input('name','Description','text',d.name)+input('quantity','Quantity','number',d.quantity,'min="1" step="1"')+input('unit','Unit price (USD)','text',fixed(d.unitCents),'inputmode="decimal"')+when('date','Document date',day),'Create for review',v=>actions('draft-copy',{id:key,date:v.date,name:v.name,quantity:Number(v.quantity),unitCents:cents(v.unit)}));
  }else if(type==='plan-discard'){
    form('Discard recurring draft','<p>This occurrence will not be re-created. Later occurrences are unaffected.</p>','Discard draft',()=>actions('draft-discard',{id:key}));
  }else if(type==='plan-pause'||type==='plan-resume'){
    form(type==='plan-pause'?'Pause schedule':'Resume schedule',type==='plan-pause'?'<p>No drafts are generated while paused.</p>':'<p>Missed occurrences will be generated for review.</p>',type==='plan-pause'?'Pause':'Resume',()=>actions('schedule-active',{id:key,active:type==='plan-resume'}));
  }else if(type==='plan-catchup'){
    form('Refresh due drafts','<p>Catch up due schedules without posting any changes to your books.</p>','Refresh drafts',()=>actions('catch-up'));
  }else return false;
  return true;
}
