// Optional synthetic scenario; no real company, employee or bank records.
import {newVault,apply,validateState} from './core.mjs';
export function sampleVault(){
  let s=newVault('Northline Studio',['jobs','time','employees']),c=s.companies[0].id;
  const book=()=>s.companies.find(x=>x.id===c);
  const add=(type,a={},date='2026-01-05')=>{s=apply(s,c,{type,date,...a});return book().history.at(-1).id;};
  const customer=add('contact',{name:'Cedar Lane Co.',kind:'Customer'}), item=add('item',{name:'Design engagement',kind:'Service'});
  const job=add('job',{name:'Cedar Lane identity'}),employee=add('employee',{name:'Morgan Example',state:'CO',locality:'Denver',rate:3200});
  add('journal',{label:'Opening contribution',lines:[['1000',1500000],['3000',-1500000]],flow:'Financing'});
  const t=add('time',{employee,job,minutes:300});add('approve time',{time:t});
  let p=add('quote',{party:customer,item,qty:1,unit:485000,job,label:'Identity design'});
  for(const type of ['sales order','fulfillment','invoice'])p=add(type,{parent:p,label:'Identity design'},'2026-01-12');
  add('collection',{parent:p,amount:300000,label:'Cedar Lane receipt'},'2026-01-20');
  add('job expense',{job,amount:18000,label:'Proof printing'},'2026-01-22');
  add('asset',{name:'Studio workstation',amount:240000,residual:0,months:24},'2026-01-23');
  add('company',{name:'Alder Supply',activities:['products','stock']});c=s.companies[1].id;
  const vendor=add('contact',{name:'Juniper Mill',kind:'Vendor'}),buyer=add('contact',{name:'Clover Shop',kind:'Customer'});
  const stock=add('item',{name:'Maple tray',kind:'Product'});add('item',{name:'Boxed tray',kind:'Product'});
  add('journal',{label:'Opening contribution',lines:[['1000',1000000],['3000',-1000000]],flow:'Financing'});
  p=add('purchase order',{party:vendor,item:stock,qty:40,unit:2500,label:'Maple trays'});
  p=add('receiving',{parent:p});p=add('bill',{parent:p});add('payment',{parent:p,amount:50000});
  p=add('quote',{party:buyer,item:stock,qty:8,unit:5600,label:'Clover display'});
  for(const type of ['sales order','fulfillment','invoice'])p=add(type,{parent:p},'2026-01-14');
  add('collection',{parent:p,amount:44800},'2026-01-16');
  add('group',{name:'Northline & Alder',members:s.companies.map(x=>x.id)});
  c=s.companies[0].id;add('intercompany',{other:s.companies[1].id,amount:12500,label:'Catalog design'},'2026-01-28');
  validateState(s);return s;
}
