import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newVault,validateState} from '../core.mjs';
import {emptyManualPayroll,manualPayrollCommand,calculateManualPayroll,validateManualPayroll,manualPaystubPdf,payrollRegisterCsv,payrollJournalCsv,parsePayrollAmount,parsePayrollRate} from '../manual-payroll.mjs';

function fixture(){
 const state=newVault('Example Firm');
 const company=state.companies[0];company.employees.push({id:'employee-1',name:'First Employee',rate:2400,state:'WA',locality:'Pierce'},{id:'employee-2',name:'Second Employee',rate:2500,state:'OR',locality:'Multnomah'});
 let data=emptyManualPayroll();
 const stamp='2026-11-26T12:00:00.000Z';
 const apply=(patch)=>{const out=manualPayrollCommand(data,company,{revision:data.revision,...patch},'test-user',stamp);data=out.data;return out;};
 const rule=(patch={})=>apply({type:'rule',key:'synthetic-tax',name:'Synthetic Tax',side:'employee',method:'percentage',rate:100000,effective:'2027-01-01',...patch});
 const draft=(patch={})=>apply({type:'draft',id:'run-01',employee:'employee-1',start:'2027-01-01',end:'2027-01-07',payDate:'2027-01-08',regular:10000,...patch});
 const finalize=(id='run-01')=>apply({type:'finalize',id,reviewed:true});
 return {state,company,rule,draft,apply,finalize,get data(){return data;}};
}
test('manual payroll separates employee and employer taxes, rounds brackets once and snapshots pay gross to net',()=>{
 const f=fixture();f.rule({workState:'wa',locality:'pierce',periodCap:9000,annualCap:10000});
 f.rule({key:'flat-local',method:'flat',amount:325,workState:'OR'});
 f.rule({key:'bracket-employer',method:'brackets',side:'employer',brackets:[{start:0,rate:12500},{start:10000,rate:25000}]});
 f.draft({regular:15000,other:500});
 const r=f.finalize().run;
 assert.equal(r.gross,15500);assert.equal(r.employeeTax,900);assert.equal(r.employerTax,263);assert.equal(r.net,14600);assert.equal(r.cost,15763);
 assert.equal(r.ruleLines.find(l=>l.rule.key==='synthetic-tax').rule.locality,'pierce');assert(!r.ruleLines.some(l=>l.rule.key==='flat-local'));
 assert.ok(validateManualPayroll(f.data,f.company));assert.deepEqual(f.finalize().run,r);assert.equal(f.data.runs.length,1);
 assert.throws(()=>f.draft({id:'new-id'}),/overlapping/);
 assert.equal(Buffer.from(manualPaystubPdf(r)).subarray(0,8).toString(),'%PDF-1.4');
 assert.match(payrollRegisterCsv([r]),/"146.00"/);
 const j=payrollJournalCsv([r],{wages:'6000',employerExpense:'6100',net:'2300',employeeTax:'2350',employerTax:'2390'});
 assert.match(j,/"6000","Gross wage expense","155.00","0.00"/);
 assert.match(j,/"2300","Net wage payable","0.00","146.00"/);
});
test('opening taxable basis, capped prior YTD, fresh calendar year and prospective rule versions',()=>{
 const f=fixture();f.rule({periodCap:9000,annualCap:10000});
 f.apply({type:'opening',employee:'employee-1',key:'synthetic-tax',wages:8000,year:2027});
 f.draft();const r=f.finalize().run;assert.equal(r.ruleLines[0].priorWages,8000);assert.equal(r.ruleLines[0].basis,2000);assert.equal(r.employeeTax,200);
 f.draft({id:'run-02',start:'2027-01-08',end:'2027-01-14',payDate:'2027-01-15'});const sameYear=f.finalize('run-02').run;
 assert.equal(sameYear.ruleLines[0].priorWages,10000);assert.equal(sameYear.ruleLines[0].basis,0);assert.equal(sameYear.priorGross,10000);
 f.rule({effective:'2028-01-01',rate:80000,periodCap:1000});
 f.draft({id:'run-03',start:'2028-01-01',end:'2028-01-07',payDate:'2028-01-08'});const newYear=f.finalize('run-03').run;
 assert.equal(newYear.ruleLines[0].priorWages,0);assert.equal(newYear.employeeTax,80);assert.equal(f.data.runs[0].ruleLines[0].rule.rate,100000);
 assert.throws(()=>f.apply({type:'opening',employee:'employee-1',key:'synthetic-tax',wages:2,year:2027}),/frozen/);
});
test('effective rule changes force re-review; stale revision, tampered results and missing employee are rejected',()=>{
 const f=fixture();f.rule();f.draft();
 f.rule({effective:'2027-01-06',rate:300000});
 assert.throws(()=>f.finalize(),/Recalculate and review/);
 assert.throws(()=>f.apply({revision:0,type:'discard',id:'run-01'}),/changed/);
 f.draft();assert.throws(()=>f.apply({type:'finalize',id:'run-01',reviewed:false}),/Confirm/);
 assert.throws(()=>f.draft({employee:'not-a-record'}),/not in this company/);
 const r=f.finalize().run;
 f.company.manualPayroll=structuredClone(f.data);validateState(f.state);
 f.company.manualPayroll.runs[0].net++;
 assert.throws(()=>validateState(f.state),/does not reconcile/);
 assert.equal(r.employeeTax,3000);
});
test('manual amount/date validation, explicit exclusions and effective expiration are safe',()=>{
 const f=fixture();f.rule({through:'2027-01-08'});
 assert.equal(parsePayrollAmount('1.02'),102);assert.equal(parsePayrollRate('1.2345'),12345);
 assert.throws(()=>parsePayrollAmount('1.002'));assert.throws(()=>parsePayrollRate('101'));
 assert.throws(()=>f.draft({start:'2027-02-30'}),/valid calendar/);
 assert.throws(()=>f.draft({exclude:['not-defined']}),/not defined/);
 f.draft({exclude:['synthetic-tax']});
 const r=f.finalize().run;assert.equal(r.employeeTax,0);assert.equal(r.excludedRules[0].key,'synthetic-tax');
 assert.equal(calculateManualPayroll(f.data,f.company,{employee:'employee-1',start:'2027-02-01',end:'2027-02-02',payDate:'2027-02-03',regular:10000}).ruleLines.length,0);
});
