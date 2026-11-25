import {accounts,balance,position,statements,consolidate,jobSummary,dollars,outstanding,nextSteps,sum} from './core.mjs';

const esc=x=>String(x??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const btn=(action,label,key='',cls='')=>`<button type="button" class="${esc(cls)}" data-act="${esc(action)}" data-key="${esc(key)}">${esc(label)}</button>`;
const money=n=>`<span class="money">${dollars(n)}</span>`;
const table=(headers,rows,empty='No records yet.')=>rows.length?`<div class="tablewrap"><table><thead><tr>${headers.map(s=>`<th scope="col">${esc(s)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:`<p class="empty">${esc(empty)}</p>`;
const panel=(title,body,action='')=>`<section class="panel"><div class="panelhead"><h2>${esc(title)}</h2>${action}</div>${body}</section>`;
const metric=(label,n)=>`<div class="metric"><span class="small quiet">${esc(label)}</span><b>${money(n)}</b></div>`;
const ref=(c,k)=>c.history.find(x=>x.id===k);
const pretty=x=>x.slice(0,1).toUpperCase()+x.slice(1);
const code=e=>'#'+String(e.number).padStart(4,'0');
const title=(c,k)=>c.find(x=>x.id===k)?.name||'—';
const choices=(k,opts,chosen=[])=>`<div class="choices">${opts.map(([value,label])=>`<label><input type="checkbox" name="${esc(k)}" value="${esc(value)}"${chosen.includes(value)?' checked':''}>${esc(label)}</label>`).join('')}</div>`;
const input=(k,label,type='text',value='',attr='')=>`<label>${esc(label)}<input type="${type}" name="${esc(k)}" value="${esc(value)}" ${attr} required></label>`;
const options=opts=>opts.map(([v,l])=>`<option value="${esc(v)}">${esc(l)}</option>`).join('');
const select=(k,label,opts)=>`<label>${esc(label)}<select name="${esc(k)}" required>${options(opts)}</select></label>`;
const dateField=(v,k='date',l='Posting date')=>input(k,l,'date',v);
const mapping=rows=>rows.map(x=>[x.id,x.name]);
const acts=[['products','Sells products'],['jobs','Performs jobs'],['time','Bills for time'],['stock','Holds stock'],['employees','Has employees']];
const brand=`<div class="brand"><img src="./mark.svg" alt="">FirmQuill <small>LITE</small></div>`;
const recordBtn=e=>btn('detail',code(e),e.id,'link');
function trend(c){
  const days=[...new Set(c.entries.map(e=>e.date))].sort();
  if(!days.length)return '<p class="quiet">Cash activity appears after the first posting.</p>';
  const values=days.map(d=>balance(c,'1000',d)),min=Math.min(...values,0),max=Math.max(...values,1);
  const points=values.map((v,i)=>`${3+294*i/Math.max(1,values.length-1)},${89-80*(v-min)/(max-min)}`);
  return `<svg class="trend" viewBox="0 0 300 96" role="img" aria-label="Closing cash by posting date"><path d="M0 90H300M0 50H300M0 10H300" stroke="#c7d8bf" fill="none"/><polyline points="${points.join(' ')}" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg><p class="cashcaption">${esc(days[0])} – ${esc(days.at(-1))}</p>`;
}
function home(c){
  const r=statements(c.entries);
  const recent=c.history.slice(-6).reverse().map(e=>[recordBtn(e),esc(e.label),esc(e.date)]);
  return `<div class="hero"><div><p class="eyebrow">Operating cash</p><strong>${money(r.closingCash)}</strong><p class="quiet small">Balance across posted transactions</p></div><div>${trend(c)}</div></div><div class="metrics">${metric('Receivables',r.balances['1100'])}${metric('Payables',-r.balances['2000'])}${metric('Net income',r.income)}</div><div class="grid2">${panel('Recent activity',table(['Record','Activity','Date'],recent),btn('nav','View history','History'))}${panel('Featured workflows',`<div class="quick">${c.featured.map(m=>btn('nav',m,m)).join('')||'Choose workflows in company setup.'}</div>`,btn('settings','Edit'))}</div>`;
}
function contacts(c){
  return panel('Contacts',table(['Name','Role'],c.parties.map(p=>[esc(p.name),p.kind])),btn('contact','Add contact'))+
  panel('Items & services',table(['Description','Type'],c.items.map(i=>[esc(i.name),i.kind])),btn('item','Add item'));
}
function commerceView(c,sales){
  const kinds=sales?['quote','sales order','fulfillment','invoice','collection','sales credit']:['purchase order','receiving','bill','payment','vendor credit'];
  const docs=c.docs.filter(d=>kinds.includes(d.kind)).toReversed();
  return panel(sales?'Sales documents':'Purchasing documents',table(['Record','Document','Contact / item','Total','Next step'],docs.map(d=>[
    recordBtn(d),pretty(d.kind),`${esc(title(c.parties,d.party))}<br><small>${esc(title(c.items,d.item))} × ${d.qty}</small>`,money(d.total),
    nextSteps(c,d).map(n=>btn('advance',pretty(n),d.id+'|'+n)).join('')||'Complete'
  ])),btn(sales?'quote':'purchase order',sales?'New quote':'New purchase order','','primary'))+
  panel(sales?'Open receivables':'Open payables',table(['Source','Contact','Open amount'],docs.filter(d=>d.kind===(sales?'invoice':'bill')&&outstanding(c,d)>0).map(d=>[recordBtn(d),esc(title(c.parties,d.party)),money(outstanding(c,d))]),'All posted documents are settled.'));
}
function jobs(c){return panel('Job profitability',table(['Job','Revenue','Posted cost','Approved labor¹','Margin'],c.jobs.map(j=>{const r=jobSummary(c,j.id);return [esc(j.name),money(r.revenue),money(r.postedCost),money(r.labor),money(r.margin)];}))+`<p class="small quiet">¹ Estimated at the hourly rate recorded with each time entry.</p>`,btn('job','New job')+btn('job expense','Record expense'))+
  panel('Time entries',table(['Date','Person / job','Minutes','Cost','Review'],c.time.toReversed().map(t=>[t.date,esc(title(c.employees,t.employee))+'<br><small>'+esc(title(c.jobs,t.job))+'</small>',t.minutes,money(t.cost),t.approved?'Approved':btn('approve time','Approve',t.id)])),btn('time','Log time'))+
  panel('Employees',table(['Name','Work state','Locality','Hourly rate'],c.employees.map(p=>[esc(p.name),esc(p.state),esc(p.locality),money(p.rate)])),btn('employee','Add employee'));}
function warehouse(c,assembly){
  const unique=new Map(c.moves.map(m=>[JSON.stringify([m.item,m.location]),m]));
  const movements=c.moves.filter(m=>!assembly||ref(c,m.source)?.kind==='assemble').toReversed();
  return panel('Stock by location',table(['Item','Location','On hand','Carrying value'],[...unique.values()].map(m=>{const p=position(c,m.item,m.location);return [esc(title(c.items,m.item)),esc(m.location),p.qty,money(p.value)];})),
    assembly?btn('assemble','Build assembly','','primary'):btn('transfer','Transfer')+btn('adjust','Adjust stock'))+
   panel(assembly?'Assembly movements':'Stock movements',table(['Source','Date','Item / location','Units','Value'],movements.map(m=>[recordBtn(ref(c,m.source)),m.date,esc(title(c.items,m.item))+' · '+esc(m.location),m.qty,money(m.value)])));
}
function assetsView(c){return panel('Asset register',table(['Asset','Acquired','Cost','Depreciation','Book value','Schedule'],c.assets.map(a=>{const dep=sum(a.charges.map(x=>x.cents));return [esc(a.name),a.date,money(a.cost),money(dep),money(a.cost-dep),`${a.charges.length} / ${a.months} months `+(a.charges.length<a.months?btn('depreciate','Post charge',a.id):'')];})),btn('asset','Acquire asset','','primary'));}
function accounting(c){
  const r=statements(c.entries);
  return panel('General journal',table(['Source','Date','Memo','Debits / credits','Correction'],c.entries.toReversed().map(j=>[recordBtn(ref(c,j.source)),j.date,esc(j.memo),j.lines.map(l=>esc(l.account)+' '+money(Math.abs(l.cents))+' '+(l.cents>0?'Dr':'Cr')).join('<br>'),ref(c,j.source).kind==='journal'&&!c.entries.some(x=>x.reverses===j.id)?btn('reverse journal','Reverse',j.id):j.reverses?'Reversal':'—'])),btn('journal','Post journal','','primary'))+
    panel('Chart of accounts',table(['Account','Name','Class','Debit-positive balance'],Object.entries(accounts).map(([k,[n,g]])=>[k,n,g,money(r.balances[k])])))+
    panel('Period close',`<p>${c.closedThrough?'Books closed through '+esc(c.closedThrough):'All periods are open.'}</p>`,btn('close','Close period'));}
function banks(c){
  return panel('Operating account',table(['Date','Description','Amount','Matched entry'],c.bank.map(r=>[r.date,esc(r.description),money(r.amountCents),r.match?recordBtn(ref(c,c.entries.find(e=>e.id===r.match).source)):btn('match','Match',r.id)])),btn('import','Import CSV','','primary')+btn('export','Export CSV'))+
  panel('Reconciled statements',table(['Through','Opening','Statement close','Outstanding cash','Book cash','Matched lines'],c.reconciliations.map(r=>[r.date,money(r.opening),money(r.closing),money(r.outstandingCash),money(r.bookCash),r.rows.length])),btn('reconcile','Reconcile statement'));}
const line=(label,n)=>`<div class="reportline"><span>${esc(label)}</span><b>${money(n)}</b></div>`;
function reportView(c,s,filter){
  const {from,through,group}=filter;
  const g=group?consolidate(s,group,from,through):null,r=g?.report||statements(c.entries,from,through);
  const filters=`<form class="filters" id="report-filter"><label>Scope<select name="group">${options([['','Current company'],...mapping(s.groups)])}</select></label><label>From<input type="date" required name="from" value="${esc(from)}"></label><label>Through<input type="date" required name="through" value="${esc(through)}"></label><button>Apply</button></form>`;
  return filters+(g?panel('Company comparison',table(['Company','Cash','Assets','Net income'],g.members.map(m=>[esc(m.name),money(m.report.closingCash),money(m.report.assets),money(m.report.income)]))):'')+
    `<div class="reports">${panel('Balance sheet',line('Assets',r.assets)+line('Liabilities',r.liabilities)+line('Contributed capital',r.capital)+line('Cumulative earnings',r.earnings))}${panel('Income statement',line('Revenue',r.revenue)+line('Expenses',r.expenses)+line('Net income',r.income))}${panel('Cash flow',line('Opening cash',r.openingCash)+Object.entries(r.cashFlow).map(([k,v])=>line(k,v)).join('')+line('Closing cash',r.closingCash))}${panel('Trial balance',table(['Account','Debit','Credit'],Object.entries(r.balances).filter(([,n])=>n).map(([a,n])=>[esc(accounts[a][0]),money(Math.max(0,n)),money(Math.max(0,-n))]))+line('Difference',r.trialDifference))}</div>`+
    (g?panel('Group-only elimination journals',table(['Company','Date','Pair','Entry'],g.eliminations.map(e=>[esc(title(s.companies,e.company)),e.date,esc(e.pair),e.lines.map(l=>l.account+' '+money(l.cents)).join('<br>')]))):'')+
    panel('Reporting groups',table(['Name','Companies'],s.groups.map(g=>[esc(g.name),g.members.map(k=>esc(title(s.companies,k))).join(', ')])),btn('group','New group')+btn('intercompany','Intercompany charge'));
}
function payrollView(c){
  return `<div class="callout warn"><b>Final payroll is blocked</b><p>2026 federal worksheets are available for synthetic testing. State and local rules, filing forms, bank acceptance and independent review remain open.</p></div>`+
    panel('Approved time',table(['Employee','Work state','Approved minutes','Straight-time estimate','Worksheet'],c.employees.map(p=>{const rows=c.time.filter(t=>t.employee===p.id&&t.approved);return [esc(p.name),esc(p.state),sum(rows.map(t=>t.minutes)),money(sum(rows.map(t=>t.cost))),btn('worksheet','Federal preview',p.id)];})),btn('employee','Add employee'))+
    panel('Release coverage',`<p>Final approval, pay stubs, payroll journals, direct-deposit files and tax forms require the complete payroll gate. The release package includes the jurisdiction register and federal test sources.</p>`);
}
function history(c){return panel('Company history',table(['Record','Date','Activity','Description'],c.history.toReversed().map(e=>[recordBtn(e),e.date,esc(pretty(e.kind)),esc(e.label)])));}

export {esc,btn,money,table,panel,pretty,code,choices,input,options,select,dateField,mapping,acts,brand,home,contacts,commerceView,jobs,warehouse,assetsView,accounting,banks,reportView,payrollView,history,ref,title,line};

