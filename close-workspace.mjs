import {accounts, balance, check, date, statements, sum} from './core.mjs';
import {btn, esc, money, panel, table} from './views.mjs';

export function priorPeriod(now){
  date(now);
  const previous=new Date(now.slice(0,7)+'-01T00:00:00.000Z');
  previous.setUTCDate(0);
  const through=previous.toISOString().slice(0,10);
  return {from:through.slice(0,7)+'-01',through};
}

export function closeSnapshot(company,from,through){
  const report=statements(company.entries,from,through);
  const use=new Set(['collection','payment','sales credit','vendor credit']);
  const settlement=new Map();
  for(const d of company.docs){
    if(d.date>through||!d.parent||!use.has(d.kind))continue;
    settlement.set(d.parent,sum([settlement.get(d.parent)??0,d.applied]));
  }
  const parties=new Map(company.parties.map(p=>[p.id,p.name]));
  const open=company.docs.filter(d=>d.date<=through&&['invoice','bill'].includes(d.kind))
    .map(d=>({number:d.number,date:d.date,kind:d.kind,party:parties.get(d.party)||'Unlisted contact',balance:sum([d.total,-(settlement.get(d.id)??0)])}))
    .filter(d=>d.balance>0).sort((a,b)=>a.date.localeCompare(b.date)||a.number-b.number);
  const bank=company.bank.filter(row=>row.date<=through);
  const reconciliations=company.reconciliations.filter(r=>r.date<=through).sort((a,b)=>a.date.localeCompare(b.date));
  const latest=reconciliations.at(-1)??null;
  const clearedRows=new Set(reconciliations.flatMap(r=>r.rows));
  const entries=new Map(company.entries.map(e=>[e.id,e]));
  const clearedEntries=new Set(bank.filter(row=>clearedRows.has(row.id)).map(row=>row.match));
  for(const id of reconciliations[0]?.openingBasis?.cleared??[])clearedEntries.add(id);
  const bankItems=bank.filter(row=>!clearedRows.has(row.id)).map(r=>({date:r.date,description:r.description,amount:r.amountCents,matched:!!entries.get(r.match)&&entries.get(r.match).date<=through}));
  const cashItems=company.entries.filter(e=>e.date<=through&&!clearedEntries.has(e.id)).map(e=>({date:e.date,memo:e.memo,amount:sum(e.lines.filter(l=>l.account==='1000').map(l=>l.cents))})).filter(r=>r.amount!==0);
  const cashActive=report.balances['1000']!==0||cashItems.length>0||bank.length>0||!!latest;
  const dueBank=cashActive&&latest?.date!==through;
  const totals={receivable:sum(open.filter(d=>d.kind==='invoice').map(d=>d.balance)),payable:sum(open.filter(d=>d.kind==='bill').map(d=>d.balance))};
  const notes=[];
  if(dueBank)notes.push('Operating cash has no reconciliation dated at the selected cutoff.');
  if(bankItems.length)notes.push(bankItems.length+' imported statement row(s) have not been included in a finalized reconciliation by the cutoff.');
  if(cashItems.length)notes.push(cashItems.length+' operating cash journal item(s) have not cleared in a finalized reconciliation by the cutoff.');
  if(open.length)notes.push(open.length+' invoice(s) or bill(s) are open. Confirm the balances and carry forward amounts still owed.');
  if(report.trialDifference)notes.push('The trial balance does not balance.');
  if(totals.receivable!==report.balances['1100']||totals.payable!==-report.balances['2000'])notes.push('Open documents differ from the receivable or payable control accounts. Review the timing difference.');
  return {schema:'firmquill.month-end-close.v1',currency:'USD',moneyUnit:'integer cents',company:{id:company.id,name:company.name},period:{from,through},closedThrough:company.closedThrough||null,periodLocked:!!company.closedThrough&&company.closedThrough>=through,report,trialBalance:Object.entries(report.balances).map(([code,value])=>({code,name:accounts[code][0],debit:Math.max(0,value),credit:Math.max(0,-value)})),openDocuments:open,openDocumentTotals:totals,operatingCash:{ledgerBalance:balance(company,'1000',through),lastReconciledThrough:latest?.date??null,lastStatementClose:latest?.closing??null,reviewNeeded:dueBank,bankItems,cashItems},approvalQueue:'Not applicable to Lite; the vault has a single owner.',reviewNotes:notes};
}

const dateControls=(window,today)=>'<form class="filters" id="close-filter"><label>Period starts<input type="date" name="from" value="'+esc(window.from)+'" required></label><label>Close through<input type="date" name="through" value="'+esc(window.through)+'" max="'+esc(today)+'" required></label><button>Apply dates</button></form>';
const metrics=rows=>'<ul>'+rows.map(([k,v])=>'<li>'+esc(k)+' <strong>'+money(v)+'</strong></li>').join('')+'</ul>';
function packetContent(p){
 const r=p.report, bank=p.operatingCash;
 return panel('Close review',
   '<p><strong>'+esc(p.period.from)+' through '+esc(p.period.through)+'</strong> · '+(p.periodLocked?'Closed':'Open')+'</p>'+
   '<p>'+esc(p.closedThrough?'Books are closed through '+p.closedThrough+'.':'No prior period close is recorded.')+'</p>'+
   (p.reviewNotes.length?'<ul>'+p.reviewNotes.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'<p>No open items flagged by these checks. Independently review account balances and entries before closing.</p>')+
   '<p>'+esc(p.approvalQueue)+'</p>')+
 panel('Open invoices and bills',metrics([['Receivable',p.openDocumentTotals.receivable],['Payable',p.openDocumentTotals.payable]])+
   table(['Type','Record','Date','Contact','Open amount'],p.openDocuments.map(d=>[esc(d.kind),esc(d.number),esc(d.date),esc(d.party),money(d.balance)])))+
 panel('Operating cash reconciliation','<p>Last finalized statement at or before cutoff: <b>'+esc(bank.lastReconciledThrough||'None')+'</b>.</p>'+
   metrics([['Cash in books at cutoff',bank.ledgerBalance]])+
   '<h3>Statement lines not finalized</h3>'+table(['Date','Description','Amount','Matched by cutoff'],bank.bankItems.map(b=>[esc(b.date),esc(b.description),money(b.amount),b.matched?'Yes':'No']))+
   '<h3>Cash journal lines not cleared</h3>'+table(['Date','Entry','Amount'],bank.cashItems.map(b=>[esc(b.date),esc(b.memo),money(b.amount)])))+
 panel('Balance sheet',metrics([['Assets',r.assets],['Liabilities',r.liabilities],['Contributed capital',r.capital],['Cumulative earnings',r.earnings]]))+
 panel('Income statement',metrics([['Revenue',r.revenue],['Expenses',r.expenses],['Net income',r.income]]))+
 panel('Cash flow',metrics([['Opening cash',r.openingCash],...Object.entries(r.cashFlow),['Closing cash',r.closingCash]]))+
 panel('Trial balance',table(['Account','Name','Debit','Credit'],p.trialBalance.filter(a=>a.debit||a.credit).map(a=>[esc(a.code),esc(a.name),money(a.debit),money(a.credit)]))+metrics([['Difference',r.trialDifference]]));
}
export function closeView(c,window,today){
 const p=closeSnapshot(c,window.from,window.through);
 return dateControls(window,today)+'<div class="callout"><p>Review the books as of the selected date. Export the packet for your records or close the period once reviewed. Unresolved items are visible; they are not cleared by closing.</p><p><strong>Exports are not encrypted.</strong> Save them privately. The encrypted vault backup is separate.</p>'+
 btn('close-export','Download close packet')+btn('close-download-data','Download packet data')+(!p.periodLocked?btn('close-review-confirm','Review and close through '+window.through,'','primary'):'')+'</div>'+packetContent(p);
}
export function closePrintable(p){
 return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>FirmQuill month-end close packet</title><style>body{font:16px/1.55 system-ui;max-width:55rem;margin:2rem auto;padding:0 1rem}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:.3rem;border-bottom:1px solid #b8c2c0}section{margin:1.25rem 0}h2,h3{break-after:avoid}@media print{body{margin:0}table{font-size:10pt}}</style><h1>Month-end close packet</h1><p>'+esc(p.company.name)+' · '+esc(p.currency)+'</p>'+packetContent(p)+'</html>';
}
