import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateManualPayroll,manualPayrollCommand,emptyManualPayroll,validateManualPayroll,payrollRegisterCsv,payrollJournalCsv,manualPaystubPdf} from '../manual-payroll.mjs';

const c={name:'Entirely Fictional Company',employees:[{id:'employee-one',name:'Synthetic Worker',state:'WA',locality:'Fictional City'}]};
const stamp='2027-01-09T00:00:00.000Z';
const sample={employee:'employee-one',start:'2027-01-01',end:'2027-01-07',payDate:'2027-01-08',regular:10001,other:1004};
function engine(){
 let state=emptyManualPayroll();
 return {get data(){return state;},post(a){const result=manualPayrollCommand(state,c,{revision:state.revision,...a},'Fictional operator',stamp);state=result.data;return result;}};
}
const v2={wageBasis:'all',pretaxTreatment:'ignore',jurisdiction:'Fictional region',rounding:'nearest',periodPolicy:'every'};
const rule={type:'rule',effective:'2027-01-01',side:'employee',method:'percentage',rate:10000};
test('separate bases and deduction treatments, full-only policy, independent cent rounding and balanced journal export',()=>{
 const e=engine();
 e.post({...rule,...v2,key:'regular-only',name:'Regular example',wageBasis:'regular',pretaxTreatment:'subtract',rounding:'down'});
 e.post({...rule,...v2,key:'other-only',name:'Other example',wageBasis:'other',pretaxTreatment:'subtract',rounding:'up',rate:5000});
 e.post({...rule,...v2,key:'employer-all',name:'Employer example',side:'employer'});
 e.post({...rule,...v2,key:'full-only',name:'Full-period example',periodPolicy:'full-only',method:'flat',amount:100});
 const input={...sample,periodKind:'partial',pretaxRegular:1000,pretaxOther:3};
 const calc=calculateManualPayroll(e.data,c,input);
 const amounts=Object.fromEntries(calc.ruleLines.map(l=>[l.rule.key,[l.eligibleBasis,l.basis,l.amount,l.skippedForPartial]]));
 assert.deepEqual(amounts,{'employer-all':[11005,11005,110,false],'full-only':[0,0,0,true],
   'other-only':[1001,1001,6,false],'regular-only':[9001,9001,90,false]});
 assert.deepEqual([calc.gross,calc.employeeTax,calc.employerTax,calc.pretaxTotal,calc.net,calc.cost],[11005,96,110,1003,9906,11115]);
 assert.equal(calculateManualPayroll(e.data,c,{...input,periodKind:'full'}).employeeTax,196);
 const pr=e.post({type:'draft',id:'example-draft',...input}).data;
 assert.equal(pr.drafts[0].input.pretaxRegular,1000);
 const {run}=e.post({type:'finalize',id:'example-draft',reviewed:true});assert(validateManualPayroll(e.data,c));
 const reg=payrollRegisterCsv([run]);assert.match(reg,/rule_method_snapshot_json/);assert.match(reg,/Fictional region/);assert.match(reg,/""rounding"":""down""/);
 const chart={wages:'6000',employerExpense:'6100',net:'2100',employeeTax:'2200',employerTax:'2210'};
 assert.throws(()=>payrollJournalCsv([run],chart),/chart account codes/);
 const journal=payrollJournalCsv([run],{...chart,pretaxPayable:'2300'});
 assert.match(journal,/"2300","Entered pre-tax deduction payable","0.00","10.03"/);
 assert.match(new TextDecoder().decode(manualPaystubPdf(run)),/Entered pre-tax deductions: \$10.03/);
 for(const change of [
   d=>{d.runs[0].ruleLines[0].eligibleBasis++;},d=>{d.runs[0].ruleLines[1].skippedForPartial=false;},
   d=>{d.runs[0].ruleLines[2].amount--;},d=>{delete d.rules[0].pretaxTreatment;},d=>{d.runs[0].pretaxTotal++;}]) {
   const invalid=structuredClone(e.data);change(invalid);assert.throws(()=>validateManualPayroll(invalid,c),/reconcile|snapshot|incomplete/);
 }
 assert.throws(()=>calculateManualPayroll(emptyManualPayroll(),c,{...input,pretaxOther:1005}),/deductions exceed/);
});
test('stable rule key selects its latest date first; different jurisdictions must use distinct IDs; existing runs stay immutable',()=>{
 const e=engine();
 e.post({...rule,key:'legacy',name:'Legacy rule'});
 e.post({type:'draft',id:'old-record',...sample});
 const legacyInput=e.data.drafts[0].input;assert.equal(legacyInput.periodKind,undefined);
 const old=e.post({type:'finalize',id:'old-record',reviewed:true}).run;
 assert.equal(old.calculationVersion,undefined);
 assert.equal(old.net,10895);assert(validateManualPayroll(e.data,c));
 e.post({...rule,...v2,key:'location-a',jurisdiction:'Fictional City A',name:'Fictional City A',workState:'WA',locality:'Fictional City'});
 e.post({...rule,...v2,key:'location-a',jurisdiction:'Fictional City B',name:'Later replaces location A',workState:'ZZ',effective:'2027-01-09'});
 e.post({...rule,...v2,key:'location-independent',jurisdiction:'Fictional City A other',name:'Distinct scope key',workState:'WA'});
 const later={...sample,start:'2027-01-09',end:'2027-01-15',payDate:'2027-01-16'};
 const current=calculateManualPayroll(e.data,c,later);
 assert.deepEqual(current.ruleLines.map(l=>l.rule.key),['legacy','location-independent']);
 assert.deepEqual(e.data.runs[0],old);
 assert.equal(current.calculationVersion,2);assert(validateManualPayroll(e.data,c));
});
