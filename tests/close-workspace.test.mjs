import test from 'node:test';
import assert from 'node:assert/strict';
import {closeSnapshot,closePrintable,priorPeriod} from '../close-workspace.mjs';
const company={id:'synthetic',name:'Synthetic & safe',closedThrough:'',parties:[{id:'cust',name:'Demo customer'}],docs:[
 {id:'invoice-1',number:1,date:'2026-10-04',kind:'invoice',party:'cust',total:10000},
 {id:'collect-1',parent:'invoice-1',number:2,date:'2026-10-18',kind:'collection',applied:3000},
 {id:'collect-2',parent:'invoice-1',number:3,date:'2026-11-02',kind:'collection',applied:2000},
 {id:'bill-1',number:4,date:'2026-10-05',kind:'bill',party:'vendor',total:5500},
 {id:'payment-1',parent:'bill-1',number:5,date:'2026-10-15',kind:'payment',applied:500},
],entries:[],bank:[],reconciliations:[]};
const jr=(id,date,flow,debit,credit,amt)=>({id,date,flow,memo:id,lines:[{account:debit,cents:amt},{account:credit,cents:-amt}]});
company.entries=[
 jr('capital','2026-09-30','Financing','1000','3000',100000),
 jr('invoice','2026-10-04','Operating','1100','4000',10000),
 jr('bill','2026-10-05','Operating','5100','2000',5500),
 jr('payment','2026-10-15','Operating','2000','1000',500),
 jr('collect','2026-10-18','Operating','1000','1100',3000),
 jr('later','2026-11-02','Operating','1000','1100',2000),
];
company.bank=[
 {id:'deposit',date:'2026-10-18',description:'Customer deposit',amountCents:3000,match:'collect'},
 {id:'unmatched',date:'2026-10-30',description:'Pending bank item',amountCents:-750},
 {id:'next',date:'2026-11-02',description:'Next month',amountCents:2000,match:'later'}
];
company.reconciliations=[{date:'2026-10-23',closing:3000,rows:['deposit']},{date:'2026-11-30',closing:5000,rows:['next']}];
test('month window handles year and leap boundary',()=>{
 assert.deepEqual(priorPeriod('2027-01-01'),{from:'2026-12-01',through:'2026-12-31'});assert.equal(priorPeriod('2028-03-20').through,'2028-02-29');
});
test('historical packet excludes later settlement and later reconciliation',()=>{
 const p=closeSnapshot(company,'2026-10-01','2026-10-31');
 assert.deepEqual(p.openDocumentTotals,{receivable:7000,payable:5000});
 assert.equal(p.report.income,4500);assert.equal(p.report.closingCash,102500);assert.equal(p.report.trialDifference,0);
 assert.equal(p.operatingCash.lastReconciledThrough,'2026-10-23');assert.equal(p.operatingCash.bankItems.length,1);assert(!p.operatingCash.cashItems.some(x=>x.memo==='collect'));assert(p.operatingCash.reviewNeeded);
 assert(!p.reviewNotes.some(x=>x.includes('differ')));
 assert.match(closePrintable(p),/Synthetic &amp; safe/);
 const done=closeSnapshot({...company,closedThrough:'2026-10-31'},'2026-10-01','2026-10-31');assert.equal(done.periodLocked,true);
 assert.throws(()=>closeSnapshot(company,'2026-11-01','2026-10-31'),/Start date exceeds end date/);
});
