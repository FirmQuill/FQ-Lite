import {emptyManualPayroll,parsePayrollAmount,parsePayrollRate,manualPaystubPdf,payrollRegisterCsv,payrollJournalCsv,payrollDollars,manualRulePolicy} from './manual-payroll.mjs';
import {esc,btn,money,table,panel,input,select} from './views.mjs';
const optional=(name,label,value='',type='text')=>`<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}"></label>`;
const states=[['employee','Employee withholding'],['employer','Employer tax']];
const methods=[['percentage','Percentage'],['flat','Flat amount'],['brackets','Progressive per-pay-period brackets']];
const bases=[['all','All earnings'],['regular','Regular earnings only'],['other','Other earnings only']];
const pretax=[['ignore','Ignore entered pre-tax deductions for this rule'],['subtract','Subtract from this rule’s selected earnings']];
const rounding=[['nearest','Nearest cent (half up)'],['down','Round down to cent'],['up','Round up to cent']];
const periodPolicy=[['every','Apply in all entered periods'],['full-only','Skip partial periods']];
const kinds=[['full','Full period'],['partial','Partial period']];
const selected=(k,l,opts,value)=>`<label>${esc(l)}<select name="${esc(k)}" required>${opts.map(([id,n])=>`<option value="${esc(id)}"${id===value?' selected':''}>${esc(n)}</option>`).join('')}</select></label>`;
const labelFor=(items,value)=>items.find(([id])=>id===value)?.[1]??value;
const detail=r=>`<p><b>${esc(r.employeeName)}</b> · ${esc(r.start)} to ${esc(r.end)} · Pay date ${esc(r.payDate)}</p><p>Gross <b>${money(r.gross)}</b> · Employee taxes <b>${money(r.employeeTax)}</b> · Net <b>${money(r.net)}</b> · Employer taxes <b>${money(r.employerTax)}</b> · Employer cost <b>${money(r.cost)}</b></p>` +
 (r.calculationVersion===2?`<p>${esc(labelFor(kinds,r.periodKind))} · Entered pre-tax deductions <b>${money(r.pretaxTotal)}</b> (regular ${money(r.pretaxRegular)}; other ${money(r.pretaxOther)})</p>`:'')+
 table(['Manual rule','Paid by','Reviewed calculation','Prior taxable wages','Current taxable wages','Calculated'],r.ruleLines.map(l=>[esc(l.rule.name+' ('+l.rule.key+')'+(l.rule.jurisdiction?' · '+l.rule.jurisdiction:'')+' · effective '+l.rule.effective+(l.skippedForPartial?' · Skipped in partial period':'')),esc(labelFor(states,l.rule.side)),esc([labelFor(bases,manualRulePolicy(l.rule).wageBasis),
 labelFor(pretax,manualRulePolicy(l.rule).pretaxTreatment),labelFor(rounding,manualRulePolicy(l.rule).rounding),
 labelFor(periodPolicy,manualRulePolicy(l.rule).periodPolicy)].join(' · '))+(l.eligibleBasis===undefined?'':'<br>Starting basis: '+money(l.eligibleBasis)),money(l.priorWages),money(l.basis),money(l.amount)]),'No rule amounts calculated.')+
 (r.excludedRules?.length?'<p>Excluded by operator: '+r.excludedRules.map(l=>esc(l.name+' ('+l.key+')')).join(', ')+'</p>':'')+
 (r.timeSource?'<p>Approved time imported: '+esc(String(r.timeSource.minutes))+' minutes across '+esc(String(r.timeSource.count))+' entries.</p>':'');
export function manualPayrollContent(result){
 const data=result?.data??emptyManualPayroll(),employees=result?.employees??[];
 return panel('Manual payroll',`<p>Define your own tax rules, review a pay run, then finalize its permanent record. Rules define their own wage basis, deductions, rounding and period treatment. Jurisdiction labels do not select rules automatically. No payroll amount is prorated or annualized. Rules are not verified tax tables. This workflow does not post to accounting, submit forms or move money.</p>${employees.length?'':'<p>Add employees before creating a payroll run.</p>'}`,btn('manual-rule','Add rule version')+(employees.length?btn('manual-opening','Set opening taxable wages')+btn('manual-draft','New pay run','','primary'):'')+(data.runs.length?btn('manual-export','Export payroll register')+btn('manual-journal','Export balanced journal worksheet'):''))
  +panel('Company-entered tax rules',table(['Code / name','Effective dates','Paid by','Calculation','Work scope','Basis / period','Taxable wage caps (period / annual)'],data.rules.toSorted((a,b)=>a.key.localeCompare(b.key)||b.effective.localeCompare(a.effective)).map(r=>[esc(r.key+' · '+r.name),esc(r.effective+' to '+(r.through??'until superseded')),esc(labelFor(states,r.side)),(r.method==='percentage'?esc((r.rate/10000)+'%'):r.method==='flat'?'Flat '+money(r.amount):r.brackets.map(v=>money(v.start)+'+: '+esc((v.rate/10000)+'%')).join('; ')),esc([r.jurisdiction,r.workState,r.locality].filter(Boolean).join(' / ')||'Any work location'),esc(labelFor(bases,manualRulePolicy(r).wageBasis)+' / '+labelFor(periodPolicy,manualRulePolicy(r).periodPolicy)),(r.periodCap==null?'None':money(r.periodCap))+' / '+(r.annualCap==null?'None':money(r.annualCap))]),'No manual tax rules. Nothing is inferred from location.'))
  +panel('Opening taxable wages',table(['Employee','Calendar year','Rule code','Taxable wages before FirmQuill runs'],data.opening.map(r=>[esc(employees.find(e=>e.id===r.employee)?.name??r.employee),esc(r.year),esc(r.key),money(r.wages)]),'No imported opening tax basis.'))
  +panel('Pay runs to review',data.drafts.length?data.drafts.map(d=>panel('Draft · '+d.preview.employeeName,detail(d.preview),btn('manual-finalize','Review and finalize',d.id,'primary')+btn('manual-draft','Recalculate or edit',d.id)+btn('manual-discard','Discard draft',d.id))).join(''):'<p>No drafts.</p>')
  +panel('Finalized manual payroll',table(['Employee','Pay date','Gross','Employee taxes','Net','Employer taxes','Pay statement'],data.runs.toReversed().map(r=>[esc(r.employeeName),esc(r.payDate),money(r.gross),money(r.employeeTax),money(r.net),money(r.employerTax),btn('manual-detail','View finalized details',r.id)+btn('manual-stub','Download PDF',r.id)]),'No finalized runs.'));
}
function draftFields(now,employees,r,d,allowTimeImport){
 const existing=d?.input;
 const rules=dataRules(r);
 return '<label>Employee<select name="employee" required>'+employees.map(e=>`<option value="${esc(e.id)}"${e.id===(existing?.employee??employees[0]?.id)?' selected':''}>${esc(e.name)}</option>`).join('')+'</select></label>'
   +input('start','Pay period start','date',existing?.start??now)+input('end','Pay period end','date',existing?.end??now)+input('payDate','Pay date','date',existing?.payDate??now)
   +optional('regular','Regular earnings (USD)',existing?payrollDollars(existing.regular):'')
   +(allowTimeImport?`<label class="checkfield"><input type="checkbox" name="fromApprovedTime" value="yes"${d?.timeSource?' checked':''}>Calculate regular gross from approved time for this pay period, at each recorded pay rate</label>`:'')
   +optional('other','Other gross earnings (USD)',existing?payrollDollars(existing.other):'')
   +selected('periodKind','Pay period type',kinds,existing?.periodKind??'full')
   +optional('pretaxRegular','Entered pre-tax deductions from regular earnings (USD)',existing?payrollDollars(existing.pretaxRegular??0):'')
   +optional('pretaxOther','Entered pre-tax deductions from other earnings (USD)',existing?payrollDollars(existing.pretaxOther??0):'')
   +'<p>Amounts reduce net pay once. Each rule independently includes or subtracts the entered amounts in its wage calculation. Confirm applicable treatment before finalizing. No automatic proration.</p>'
   +(rules.length?`<fieldset><legend>Exclude rules from this run only (if applicable on pay date)</legend>${rules.map(k=>`<label class="checkfield"><input type="checkbox" name="exclude" value="${esc(k.key)}"${existing?.exclude.includes(k.key)?' checked':''}>${esc(k.name+' ('+k.key+')')}</label>`).join('')}</fieldset>`:'');
}
const dataRules=r=>[...new Map(r.rules.toSorted((a,b)=>a.effective.localeCompare(b.effective)).map(x=>[x.key,{key:x.key,name:x.name}])).values()];
export function manualPayrollAction(type,key,ctx){
 if(!type.startsWith('manual-'))return false;
 const {result,now,formModal,command,download}=ctx,r=result?.data??emptyManualPayroll(),employees=result?.employees??[],cmd=(data)=>command({...data,revision:r.revision});
 if(type==='manual-rule'){
   formModal('Add manual tax rule version',input('key','Stable rule code')+input('name','Rule name')+input('effective','Effective pay date','date',now)+optional('through','End date (optional, inclusive)','','date')+select('side','Paid by',states)+select('method','Method',methods)+optional('jurisdiction','Jurisdiction label (optional)')+
     select('wageBasis','Starting wage basis',bases)+select('pretaxTreatment','Pre-tax treatment for this rule',pretax)+select('rounding','Final cent rounding',rounding)+
     select('periodPolicy','Apply to partial periods?',periodPolicy)+
     '<p>Keep a distinct rule code for each separate tax, payer or jurisdiction. A newer version under the same code replaces the older version before the location filter is applied.</p>'+optional('workState','Work state filter (optional, e.g. WA)')+optional('locality','Work locality filter (optional, exact record name)')+optional('rate','Percentage (if chosen, e.g. 3.25)')+optional('flat','Flat amount (USD, if chosen)')+'<label>Progressive brackets (if chosen): one threshold USD,rate percent per line<textarea name="brackets" rows="4" placeholder="0,0&#10;500,6.5"></textarea></label>'+optional('periodCap','Taxable wage cap per period (USD)')+optional('annualCap','Taxable wage cap per calendar year (USD)'),'Save rule version',v=>{
      const brackets=v.method==='brackets'?v.brackets.trim().split(/\r?\n/).map(l=>{const fields=l.split(',');if(fields.length!==2)throw Error('Each bracket must have a threshold and a rate separated by one comma.');return {start:parsePayrollAmount(fields[0]),rate:parsePayrollRate(fields[1])};}):undefined;
      return cmd({type:'rule',key:v.key,name:v.name,effective:v.effective,through:v.through,workState:v.workState,locality:v.locality,side:v.side,method:v.method,jurisdiction:v.jurisdiction||null,wageBasis:v.wageBasis,pretaxTreatment:v.pretaxTreatment,rounding:v.rounding,periodPolicy:v.periodPolicy,rate:v.method==='percentage'?parsePayrollRate(v.rate):undefined,amount:v.method==='flat'?parsePayrollAmount(v.flat):undefined,brackets,periodCap:v.periodCap===''?null:parsePayrollAmount(v.periodCap),annualCap:v.annualCap===''?null:parsePayrollAmount(v.annualCap)});
   });
 }else if(type==='manual-opening'){
   if(!r.rules.length)throw Error('Add a tax rule first.');
   formModal('Opening taxable wages',`<p>Optional when starting midyear. Enter prior taxable wages before the first finalized use of a rule for this employee and year.</p>`+select('employee','Employee',employees.map(e=>[e.id,e.name]))+select('key','Rule code',dataRules(r).map(x=>[x.key,x.name+' ('+x.key+')']))+input('year','Calendar pay year','number',now.slice(0,4))+input('wages','Opening taxable wages (USD)'),'Save opening wages',v=>cmd({type:'opening',employee:v.employee,key:v.key,year:v.year,wages:parsePayrollAmount(v.wages)}));
 }else if(type==='manual-draft'){
   if(!employees.length)throw Error('Add an employee first.');const d=key?r.drafts.find(x=>x.id===key):undefined,id=d?.id??crypto.randomUUID();
   formModal('Draft pay run',draftFields(now,employees,r,d,ctx.allowTimeImport),'Save for review',(v,f)=>cmd({type:'draft',id,employee:v.employee,start:v.start,end:v.end,payDate:v.payDate,regular:v.fromApprovedTime?0:parsePayrollAmount(v.regular||'0'),other:parsePayrollAmount(v.other||'0'),periodKind:v.periodKind,pretaxRegular:parsePayrollAmount(v.pretaxRegular||'0'),pretaxOther:parsePayrollAmount(v.pretaxOther||'0'),exclude:f.getAll('exclude'),...(v.fromApprovedTime?{fromApprovedTime:true}:{})}));
 }else if(type==='manual-finalize'){
   const d=r.drafts.find(x=>x.id===key);if(!d)throw Error('Payroll draft not found.');
   formModal('Review manual pay run',detail({...d.preview,timeSource:d.timeSource})+`<p>This saves the finalized pay record.${ctx.allowTimeImport?' The pay statement appears in the employee’s Pay portal, when enabled.':''} It does not post a journal, submit forms or move money.</p><label class="checkfield"><input type="checkbox" name="reviewed" value="yes" required> I reviewed gross earnings, entered deductions, applicable rules, tax amounts and net pay.</label>`,'Finalize pay run',v=>cmd({type:'finalize',id:key,reviewed:v.reviewed==='yes'}));
 }else if(type==='manual-discard'){
   formModal('Discard draft','<p>Only the unfinalized draft will be removed.</p>','Discard draft',()=>cmd({type:'discard',id:key}));
 }else if(type==='manual-export'){
   download(payrollRegisterCsv(r.runs),'firmquill-manual-payroll-register.csv','text/csv');
 }else if(type==='manual-journal'){
   const fields=[['wages','Gross wage expense'],['employerExpense','Employer tax expense'],['net','Net wage payable'],['employeeTax','Employee tax payable'],['employerTax','Employer tax payable'],...(r.runs.some(x=>x.pretaxTotal>0)?[['pretaxPayable','Entered pre-tax deduction payable']]:[])];
   formModal('Export balanced payroll journal worksheet','<p>Enter each verified account code from your external chart. The CSV is a review worksheet, not a direct-post or bank file.</p>'+fields.map(([key,label])=>input(key,label+' account')).join(''),'Download worksheet',v=>download(payrollJournalCsv(r.runs,v),'firmquill-manual-payroll-journal.csv','text/csv'));
 }else if(type==='manual-detail'){
   const run=r.runs.find(x=>x.id===key);if(!run)throw Error('Finalized payroll not found.');
   formModal('Finalized manual pay run',detail(run)+'<p>Recorded in FirmQuill this calendar year, including this run: gross '+money(run.priorGross+run.gross)+'; net '+money(run.priorNet+run.net)+'.</p><p>Finalized '+esc(run.finalizedAt)+'. General ledger, filings and payments are unchanged.</p>','',null);
 }else if(type==='manual-stub'){
   const run=r.runs.find(x=>x.id===key);if(!run)throw Error('Finalized payroll not found.');download(manualPaystubPdf(run),'firmquill-paystatement-'+run.payDate+'.pdf','application/pdf');
 }else throw Error('Unknown manual payroll action.');
 return true;
}
