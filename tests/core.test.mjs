import test from 'node:test';
import assert from 'node:assert/strict';
import {apply,balance,cents,consolidate,newVault,statements,position,validateState,jobSummary,outstanding} from '../core.mjs';
import {sampleVault} from '../sample.mjs';
import {previewBankCsv} from '../interop.mjs';

function fixture(seed=sampleVault(),idx=0){
  let s=seed;const company=s.companies[idx].id;
  return {get s(){return s;},get c(){return s.companies[idx];},run(type,args={},date='2026-02-01'){
    const next=apply(s,company,{type,date,...args});validateState(next);s=next;return s.companies[idx].history.at(-1).id;
  }};
}
test('USD parser, rounding boundaries, invalid inputs and safe integer range',()=>{
  assert.equal(cents('0.10')+cents('0.20'),30);assert.equal(cents('-0.01'),-1);
  assert.equal(cents('90071992547409.91'),Number.MAX_SAFE_INTEGER);
  for(const x of ['4.001','2e3','NaN','','90071992547409.92'])assert.throws(()=>cents(x));
});
test('service and product samples balance to independently calculated totals',()=>{
  const [service,product]=sampleVault().companies;
  const sr=statements(service.entries),pr=statements(product.entries);
  assert.equal(sr.closingCash,1542000);assert.equal(sr.balances['1100'],185000);assert.equal(sr.income,479500);
  assert.equal(pr.closingCash,994800);assert.equal(pr.balances['1200'],80000);assert.equal(pr.balances['2000'],-50000);assert.equal(pr.income,12300);
  for(const r of [sr,pr]){assert.equal(r.trialDifference,0);assert.equal(r.assets,r.capital+r.earnings+r.liabilities);assert.equal(r.closingCash,r.openingCash+Object.values(r.cashFlow).reduce((a,b)=>a+b));}
  const jan=statements(service.entries,'2026-01-12','2026-01-22');
  assert.equal(jan.openingCash,1500000);assert.equal(jan.cashFlow.Operating,282000);
  assert.deepEqual(jobSummary(service,service.jobs[0].id),{revenue:485000,postedCost:18000,labor:16000,margin:451000});
});
test('company isolation, independent numbering, mixed setup and reference rejection',()=>{
  const x=fixture(),other=structuredClone(x.s.companies[1]),history=x.c.history.length;
  x.run('settings',{name:'Mixed business',activities:['jobs','stock'],featured:['Assembly','Banking']});
  assert.deepEqual(x.s.companies[1],other);assert.equal(x.c.history.length,history+1);
  assert.equal(x.c.history[0].number,1);assert.equal(other.history[0].number,1);
  assert.throws(()=>x.run('quote',{item:other.items[0].id,party:x.c.parties[0].id,qty:1,unit:10}),/missing/);
});
test('product sale fully returned after payment, receipt and journal references preserved',()=>{
  const x=fixture(sampleVault(),1),invoice=x.c.docs.find(d=>d.kind==='invoice'),qty=position(x.c,invoice.item,'Main').qty;
  x.run('sales credit',{parent:invoice.id});assert.equal(position(x.c,invoice.item,'Main').qty,qty+8);
  assert.equal(balance(x.c,'5000'),0);assert.equal(balance(x.c,'4000'),0);assert.equal(balance(x.c,'1100'),0);
  assert.throws(()=>x.run('sales credit',{parent:invoice.id}));assert.throws(()=>x.run('collection',{parent:invoice.id,amount:1}));
});
test('vendor return after partial payment clears AP, returns goods and records refund',()=>{
  const x=fixture(sampleVault(),1);const bill=x.c.docs.find(d=>d.kind==='bill');
  const before=JSON.stringify(x.s);assert.throws(()=>x.run('vendor credit',{parent:bill.id}),/Insufficient/);assert.equal(JSON.stringify(x.s),before);
  x.run('sales credit',{parent:x.c.docs.find(d=>d.kind==='invoice').id});
  x.run('vendor credit',{parent:bill.id});assert.equal(balance(x.c,'2000'),0);assert.equal(balance(x.c,'1200'),0);assert.equal(balance(x.c,'1000'),1000000);
});
test('open service credit splits outstanding and cash portions',()=>{
  const x=fixture(),invoice=x.c.docs.find(d=>d.kind==='invoice');
  assert.equal(outstanding(x.c,invoice),185000);x.run('sales credit',{parent:invoice.id});
  assert.equal(balance(x.c,'1100'),0);assert.equal(balance(x.c,'1000'),1242000);assert.equal(outstanding(x.c,invoice),0);
});
test('warehouse transfer and assembly preserve stock value and abort insufficient builds',()=>{
  const x=fixture(sampleVault(),1),[raw,finished]=x.c.items;
  x.run('transfer',{item:raw.id,location:'Main',to:'Bench',qty:7});
  x.run('assemble',{item:finished.id,location:'Bench',qty:2,components:[{item:raw.id,qty:6}]});
  assert.deepEqual(position(x.c,finished.id,'Bench'),{qty:2,value:15000});
  assert.deepEqual(position(x.c,raw.id,'Bench'),{qty:1,value:2500});
  assert.equal(balance(x.c,'1200'),80000);
  const before=JSON.stringify(x.s);assert.throws(()=>x.run('assemble',{item:finished.id,location:'Bench',qty:1,components:[{item:raw.id,qty:1},{item:raw.id,qty:1}]}));assert.equal(JSON.stringify(x.s),before);
  x.run('adjust out',{item:finished.id,location:'Bench',qty:1});assert.equal(balance(x.c,'1200'),72500);assert.equal(balance(x.c,'5200'),7500);
});
test('depreciation schedule distributes rounding and stops at residual',()=>{
  const x=fixture(newVault('Synthetic fixture'));const a=x.run('asset',{name:'Fixture',amount:10000,residual:2,months:3},'2026-01-14');
  for(const date of ['2026-01-31','2026-02-28','2026-03-31'])x.run('depreciate',{asset:a},date);
  assert.equal(balance(x.c,'1590'),-9998);assert.deepEqual(x.c.assets[0].charges.map(t=>t.cents),[3333,3332,3333]);
  assert.throws(()=>x.run('depreciate',{asset:a},'2026-04-30'));
});
test('closed period, immutable correction and duplicate request checks',()=>{
  const x=fixture(newVault('Synthetic fixture'));const payload={label:'Funding',lines:[['1000',10000],['3000',-10000]],flow:'Financing',requestId:'same'};
  x.run('journal',payload);assert.throws(()=>x.run('journal',payload),/Duplicate/);
  assert.throws(()=>x.run('journal',{...payload,requestId:'unequal',lines:[['1000',100],['3000',-10]]}),/balance/);
  const e=x.c.entries[0];x.run('close',{},'2026-02-28');assert.throws(()=>x.run('reverse journal',{entry:e.id}),/closed/);
  x.run('reverse journal',{entry:e.id},'2026-03-01');assert.equal(balance(x.c,'1000'),0);assert.deepEqual(x.c.entries[0],e);assert.equal(x.c.entries.at(-1).reverses,e.id);
  assert.throws(()=>x.run('reverse journal',{entry:e.id},'2026-03-02'));
});
test('group-only eliminations net both sides and preserve original books',()=>{
  const x=fixture(),original=JSON.stringify(x.s),g=consolidate(x.s,x.s.groups[0].id);
  assert.equal(g.eliminations.length,2);for(const a of ['1150','2100','4100','5150'])assert.ok(g.report.balances[a]===0);
  assert.equal(g.report.income,491800);assert.equal(g.report.trialDifference,0);assert.equal(JSON.stringify(x.s),original);
  assert.equal(consolidate(x.s,x.s.groups[0].id,'2026-01-01','2026-01-27').eliminations.length,0);
});
test('bank file import, repeat suppression, matching and statement to GL reconciliation',()=>{
  const x=fixture(newVault('Synthetic account'));x.run('journal',{lines:[['1000',9999],['3000',-9999]],flow:'Financing'});
  const txt='Date,Description,Amount\n2026-02-01,Capital,99.99';
  const added=previewBankCsv(txt,'wave').added;x.run('statement import',{rows:added});
  assert.equal(previewBankCsv(txt,'wave',x.c.bank).added.length,0);assert.throws(()=>x.run('statement import',{rows:added}));
  assert.throws(()=>x.run('reconcile',{closing:9999}));x.run('match',{row:x.c.bank[0].id,entry:x.c.entries[0].id});
  assert.throws(()=>x.run('reconcile',{closing:9998}));x.run('reconcile',{closing:9999});
  assert.equal(x.c.reconciliations[0].bookCash,9999);assert.equal(x.c.reconciliations[0].outstandingCash,0);
  assert.throws(()=>x.run('statement import',{rows:[{...added[0],sourceRef:'new'}]}),/reconciled/);
});
test('versioned snapshot round-trip preserves attachment IDs, history and reference validation',()=>{
  const x=fixture();x.run('attachment',{source:x.c.docs[0].id,name:'synthetic-note.txt',data:btoa('synthetic note')});
  const restored=JSON.parse(JSON.stringify(x.s));assert.ok(validateState(restored));assert.deepEqual(restored,x.s);
  restored.companies[0].docs[0].item='missing';assert.throws(()=>validateState(restored),/missing/);
});
