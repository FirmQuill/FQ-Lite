// Manual payroll never supplies legal or statutory defaults. All monetary values are USD cents.
const fail=(ok,message,status=400)=>{if(!ok)throw Object.assign(Error(message),{status});};
const labels=value=>{fail(typeof value==='string'&&value.trim().length>0&&value.length<=120,'Enter a name of 1–120 characters.');return value.trim();};
const code=value=>{fail(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value),'Use a stable ID of letters, numbers, hyphens or underscores.');return value.toLowerCase();};
const cents=n=>{fail(Number.isSafeInteger(n)&&n>=0&&n<=9e12,'Enter a nonnegative amount within the supported cents range.');return n;};
const add=(a,b)=>cents(a+b);
const date=value=>{fail(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='1900-01-01'&&value<='9999-12-31'&&Number.isFinite(Date.parse(value+'T00:00Z'))&&new Date(value+'T00:00Z').toISOString().slice(0,10)===value,'Enter a valid calendar date.');return value;};
const runId=value=>{fail(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(value),'Choose a valid payroll run ID.');return value;};
const safeId=value=>{fail(typeof value==='string'&&value.length>0&&value.length<=160,'Choose a valid record.');return value;};
export const emptyManualPayroll=()=>({schema:1,revision:0,rules:[],opening:[],drafts:[],runs:[]});
const ppm=value=>{fail(Number.isInteger(value)&&value>=0&&value<=1_000_000,'Enter a rate between 0% and 100%.');return value;};
const ratio=(n,d,mode)=>cents(Number(mode==='down'?n/d:mode==='up'?(n+d-1n)/d:(n+d/2n)/d));
const methodKeys=['jurisdiction','wageBasis','pretaxTreatment','rounding','periodPolicy'];
const ruleDefaults={jurisdiction:null,wageBasis:'all',pretaxTreatment:'ignore',rounding:'nearest',periodPolicy:'every'};
export const manualRulePolicy=rule=>({...ruleDefaults,...Object.fromEntries(methodKeys.filter(k=>Object.hasOwn(rule,k)).map(k=>[k,rule[k]]))});
const periodKeys=['periodKind','pretaxRegular','pretaxOther'];
const optionalRun=a=>periodKeys.some(k=>Object.hasOwn(a,k));
function periodInput(a,regular,other){
  const periodKind=a.periodKind??'full',pretaxRegular=cents(a.pretaxRegular??0),pretaxOther=cents(a.pretaxOther??0);
  fail(['full','partial'].includes(periodKind),'Choose a full or partial pay period.');
  fail(pretaxRegular<=regular&&pretaxOther<=other,'Entered pre-tax deductions exceed the earnings bucket.');
  return {periodKind,pretaxRegular,pretaxOther};
}
function ruleBasis(rule,input,priorWages){
  const {wageBasis,pretaxTreatment,periodPolicy}=manualRulePolicy(rule);
  const affected=input.periodKind==='partial'&&periodPolicy==='full-only';
  const regular=input.regular-(pretaxTreatment==='subtract'?(input.pretaxRegular??0):0);
  const other=input.other-(pretaxTreatment==='subtract'?(input.pretaxOther??0):0);
  const eligibleBasis=affected?0:wageBasis==='regular'?regular:wageBasis==='other'?other:add(regular,other);
  const basis=Math.min(eligibleBasis,rule.periodCap??eligibleBasis,rule.annualCap==null?eligibleBasis:Math.max(0,rule.annualCap-priorWages));
  return {eligibleBasis,basis,skippedForPartial:affected};
}
export function parsePayrollAmount(value,field='Amount'){
  const m=/^(\d{1,11})(?:\.(\d{1,2}))?$/.exec(String(value??'').trim());fail(m,field+' must be a dollar amount with up to two decimals.');return cents(Number(m[1])*100+Number((m[2]||'').padEnd(2,'0')));
}
export function parsePayrollRate(value){
  const m=/^(\d{1,3})(?:\.(\d{1,4}))?$/.exec(String(value??'').trim());fail(m,'Use a percentage with up to four decimal places.');return ppm(Number(m[1])*10_000+Number((m[2]||'').padEnd(4,'0')));
}
const ruleInput=a=>{
  const key=code(a.key),name=labels(a.name),effective=date(a.effective),through=a.through?date(a.through):null;
  fail(!through||through>=effective,'End date must be on or after the effective date.');
  fail(['employee','employer'].includes(a.side),'Choose who pays the rule.');
  fail(['percentage','flat','brackets'].includes(a.method),'Choose a calculation method.');
  const workState=a.workState==null||a.workState===''?null:String(a.workState).trim().toUpperCase();
  const locality=a.locality==null||a.locality===''?null:labels(a.locality);
  fail(!workState||/^[A-Z]{2}$/.test(workState),'Use a two-letter work state.');
  const rule={key,name,effective,through,workState,locality,side:a.side,method:a.method,periodCap:a.periodCap==null?null:cents(a.periodCap),annualCap:a.annualCap==null?null:cents(a.annualCap)};
  if(Object.hasOwn(a,'calculationVersion')||methodKeys.some(k=>Object.hasOwn(a,k))){
    fail(a.calculationVersion===undefined||a.calculationVersion===2,'Unknown payroll rule calculation version.');
    const m=manualRulePolicy(a);
    if(m.jurisdiction!==null)m.jurisdiction=labels(m.jurisdiction);
    fail(['all','regular','other'].includes(m.wageBasis)&&['ignore','subtract'].includes(m.pretaxTreatment)&&
      ['nearest','down','up'].includes(m.rounding)&&['every','full-only'].includes(m.periodPolicy),'Choose a supported basis, deduction treatment, rounding and pay period policy.');
    Object.assign(rule,{calculationVersion:2,...m});
  }
  if(a.method==='percentage')rule.rate=ppm(a.rate);
  if(a.method==='flat')rule.amount=cents(a.amount);
  if(a.method==='brackets'){
    fail(Array.isArray(a.brackets)&&a.brackets.length>0&&a.brackets.length<=20,'Enter 1–20 progressive rate bands.');
    rule.brackets=a.brackets.map(({start,rate})=>({start:cents(start),rate:ppm(rate)}));
    fail(rule.brackets[0].start===0&&rule.brackets.every((b,i)=>!i||b.start>rule.brackets[i-1].start),'Bands must start at zero and increase without repeats.');
  }
  return rule;
};
const employeeFor=(company,id)=>{const e=company.employees.find(e=>e.id===id);fail(e,'Employee is not in this company.',404);return e;};
function runInput(a,company) {
  const employee=safeId(a.employee);employeeFor(company,employee);
  const start=date(a.start),end=date(a.end),payDate=date(a.payDate);fail(start<=end&&end<=payDate,'Pay date must be on or after the period end.');
  const regular=cents(a.regular),other=cents(a.other??0),gross=add(regular,other);
  fail(gross>0,'Add a positive gross wage amount.');
  const exclude=a.exclude??[];
  fail(Array.isArray(exclude)&&exclude.length<=24,'Invalid rule selection.');
  const omitted=exclude.map(code);fail(new Set(omitted).size===omitted.length,'A rule was excluded twice.');
  return {employee,start,end,payDate,regular,other,exclude:omitted,...(optionalRun(a)?periodInput(a,regular,other):{})};
}
function relevant(data,key,payDate){
  return data.rules.filter(r=>r.key===key&&r.effective<=payDate).sort((a,b)=>b.effective.localeCompare(a.effective))[0];
}
function rateAmount(rule,base){
  if(!base)return 0;
  if(rule.method==='flat')return rule.amount;
  if(rule.method==='percentage')return ratio(BigInt(base)*BigInt(rule.rate),1_000_000n,rule.rounding);
  let total=0n;
  for(const [i,band] of rule.brackets.entries()){
    const amount=Math.max(0,Math.min(base,rule.brackets[i+1]?.start??base)-band.start);
    total+=BigInt(amount)*BigInt(band.rate);
  }
  return ratio(total,1_000_000n,rule.rounding);
}
export function activeManualRules(data,payDate){
  date(payDate);
  return [...new Set(data.rules.map(r=>r.key))].map(k=>relevant(data,k,payDate)).filter(r=>r&&(!r.through||r.through>=payDate)).sort((a,b)=>a.key.localeCompare(b.key));
}
export function calculateManualPayroll(data,company,input){
  const a=runInput(input,company),year=a.payDate.slice(0,4),prior=data.runs.filter(r=>r.employee===a.employee),gross=add(a.regular,a.other);
  fail(!prior.some(r=>r.start<=a.end&&r.end>=a.start),'Employee already has a finalized run for an overlapping period.',409);
  fail(!prior.some(r=>r.payDate>=a.payDate),'Enter payroll in pay-date order for each employee.',409);
  const worker=employeeFor(company,a.employee);
  const active=activeManualRules(data,a.payDate).filter(r=>(!r.workState||r.workState===worker.state)&&(!r.locality||r.locality.toLowerCase()===worker.locality?.trim().toLowerCase()));
  fail(a.exclude.every(k=>data.rules.some(r=>r.key===k)),'An excluded rule is not defined; review the draft.');
  const included=active.filter(r=>!a.exclude.includes(r.key));
  const versioned=optionalRun(a)||included.some(r=>r.calculationVersion===2);
  const period=periodInput(a,a.regular,a.other),pretaxTotal=add(period.pretaxRegular,period.pretaxOther);
  const ruleLines=included.map(rule=>{
    const opening=data.opening.find(r=>r.employee===a.employee&&r.key===rule.key&&r.year===year)?.wages??0;
    const priorWages=prior.filter(r=>r.payDate.slice(0,4)===year).reduce((sum,r)=>add(sum,r.ruleLines.find(x=>x.rule.key===rule.key)?.basis??0),opening);
    const {basis,eligibleBasis,skippedForPartial}=ruleBasis(rule,{...a,...period},priorWages);
    return {rule,priorWages,basis,amount:rateAmount(rule,basis),...(versioned?{eligibleBasis,skippedForPartial}:{})};
  });
  const employeeTax=ruleLines.filter(l=>l.rule.side==='employee').reduce((s,l)=>add(s,l.amount),0);
  const employerTax=ruleLines.filter(l=>l.rule.side==='employer').reduce((s,l)=>add(s,l.amount),0);
  fail(employeeTax<=gross-pretaxTotal,'Employee withholdings exceed wages after entered deductions. Review your rules.');
  const priorYear=prior.filter(r=>r.payDate.slice(0,4)===year),priorNet=priorYear.reduce((total,r)=>add(total,r.net),0),priorGross=priorYear.reduce((total,r)=>add(total,r.gross),0);
  const excludedRules=active.filter(r=>a.exclude.includes(r.key)).map(r=>({key:r.key,name:r.name}));
  return {...a,employeeName:employeeFor(company,a.employee).name,companyName:company.name,gross,employeeTax,employerTax,net:gross-employeeTax-pretaxTotal,cost:add(gross,employerTax),priorNet,priorGross,ruleLines,excludedRules,mode:'manual',
    ...(versioned?{calculationVersion:2,...period,pretaxTotal}:{})};
}
export function manualPayrollCommand(data,company,a,actor='local owner',stamp=new Date().toISOString()){
  fail(a&&typeof a==='object','Choose a manual payroll action.');
  const next=structuredClone(data??emptyManualPayroll());
  // Retrying a submitted draft is safe even when a prior response was lost.
  if(a.type==='finalize'){
    const existing=next.runs.find(r=>r.id===a.id);
    if(existing)return {data:next,run:existing,replayed:true};
  }
  fail(a.revision===next.revision,'Manual payroll changed. Refresh and review before retrying.',409);
  if(a.type==='rule'){
    const r=ruleInput(a);
    fail(next.rules.length<240,'Too many rule versions.');
    fail(!next.rules.some(x=>x.key===r.key&&x.effective===r.effective),'That rule already has a version effective on this date.');
    fail(next.rules.some(x=>x.key===r.key)||new Set(next.rules.map(x=>x.key)).size<24,'Limit manual payroll to 24 tax rule codes.');
    next.rules.push(r);
  }else if(a.type==='opening'){
    const employee=safeId(a.employee);employeeFor(company,employee);
    const key=code(a.key),year=String(a.year),wages=cents(a.wages);
    fail(/^\d{4}$/.test(year)&&next.rules.some(r=>r.key===key),'Choose a year and an existing rule code.');
    fail(!next.runs.some(r=>r.employee===employee&&r.payDate.startsWith(year)&&r.ruleLines.some(l=>l.rule.key===key)),'Opening basis is frozen after the first finalized use of this rule for this employee and year.');
    next.opening=next.opening.filter(r=>!(r.key===key&&r.year===year&&r.employee===employee));
    next.opening.push({employee,key,year,wages});
  }else if(a.type==='draft'){
    const id=runId(a.id);fail(!next.runs.some(r=>r.id===id),'This run was already finalized.',409);
    const result=calculateManualPayroll(next,company,a);
    // Save the exact preview. A material change requires explicit recalculation and review.
    const {employee,start,end,payDate,regular,other,exclude}=result;
    const previous=next.drafts.find(d=>d.id===id);
    const draft={id,input:{employee,start,end,payDate,regular,other,exclude,...(optionalRun(a)?periodInput(a,regular,other):{})},preview:result,savedAt:stamp,savedBy:actor,...(a.timeSource?{timeSource:a.timeSource}:{})};
    if(previous)next.drafts=next.drafts.map(d=>d.id===id?draft:d);else next.drafts.push(draft);
  }else if(a.type==='finalize'){
    const draft=next.drafts.find(d=>d.id===a.id);fail(draft,'Payroll draft not found.',404);
    const result=calculateManualPayroll(next,company,draft.input);
    fail(JSON.stringify(result)===JSON.stringify(draft.preview),'Payroll totals or applicable rules changed. Recalculate and review this draft.',409);
    fail(a.reviewed===true,'Confirm the reviewed gross, taxes and net amount.');
    const run={...result,id:draft.id,finalizedAt:stamp,finalizedBy:actor,...(draft.timeSource?{timeSource:draft.timeSource}:{})};
    next.runs.push(run);next.drafts=next.drafts.filter(d=>d.id!==draft.id);next.revision++;
    return {data:next,run};
  }else if(a.type==='discard'){
    fail(next.drafts.some(r=>r.id===a.id),'Payroll draft not found.',404);next.drafts=next.drafts.filter(r=>r.id!==a.id);
  }else fail(false,'Unknown manual payroll action.');
  next.revision++;
  return {data:next};
}
export function validateManualPayroll(data,company){
  if(data===undefined)return true;
  fail(data?.schema===1&&Number.isSafeInteger(data.revision)&&data.revision>=0,'Invalid manual payroll schema.');
  for(const key of ['rules','opening','drafts','runs'])fail(Array.isArray(data[key]),'Invalid manual payroll collection.');
  const unique=(rows,key)=>fail(new Set(rows.map(key)).size===rows.length,'Duplicate manual payroll record.');
  const tuple=(...keys)=>row=>JSON.stringify(keys.map(k=>row[k]));
  unique(data.rules,tuple('key','effective'));unique(data.opening,tuple('employee','year','key'));unique([...data.drafts,...data.runs],r=>r.id);
  fail(data.rules.length<=240&&new Set(data.rules.map(r=>r.key)).size<=24,'Invalid manual rule count.');
  for(const r of data.rules)validateStoredRule(r);
  for(const r of data.opening){employeeFor(company,r.employee);cents(r.wages);code(r.key);fail(/^\d{4}$/.test(r.year)&&data.rules.some(v=>v.key===r.key),'Invalid payroll opening balance.');}
  for(const r of data.drafts){runId(r.id);runInput(r.input,company);checkResult(r.preview);}
  for(const r of data.runs){runId(r.id);runInput(r,company);checkResult(r);fail(typeof r.finalizedAt==='string'&&r.finalizedAt.length<=40&&typeof r.finalizedBy==='string'&&r.finalizedBy.length<=160,'Invalid finalized payroll snapshot.');}
  return true;
}
function validateStoredRule(rule){
  const validated=ruleInput(rule);
  fail(!validated.calculationVersion||rule.calculationVersion===2&&methodKeys.every(k=>Object.hasOwn(rule,k)&&rule[k]===validated[k]),
    'Versioned rule settings are incomplete.');
  return validated;
}
function checkResult(r){
  fail(r?.mode==='manual'&&Array.isArray(r.ruleLines)&&r.ruleLines.length<=24&&Array.isArray(r.excludedRules)&&r.excludedRules.length<=24,'Invalid manual tax result.');
  fail([r.employeeName,r.companyName].every(v=>typeof v==='string'&&v.trim().length>0&&v.length<=160),'Invalid payroll statement names.');
  for(const v of [r.gross,r.regular,r.other,r.employeeTax,r.employerTax,r.net,r.cost,r.priorNet,r.priorGross])cents(v);
  const versioned=r.calculationVersion===2;
  const treatment=versioned?periodInput(r,r.regular,r.other):{pretaxRegular:0,pretaxOther:0};
  const pretaxTotal=add(treatment.pretaxRegular,treatment.pretaxOther);
  fail(versioned?periodKeys.every(k=>Object.hasOwn(r,k))&&r.pretaxTotal===pretaxTotal:r.calculationVersion===undefined&&!optionalRun(r)&&r.pretaxTotal===undefined,
    'Invalid payroll calculation snapshot version or deductions.');
  for(const l of r.ruleLines){
    const normalized=validateStoredRule(l.rule);cents(l.priorWages);cents(l.basis);cents(l.amount);
    if(versioned){
      const b=ruleBasis(normalized,{...r,...treatment},l.priorWages);
      fail(b.basis===l.basis&&b.eligibleBasis===l.eligibleBasis&&b.skippedForPartial===l.skippedForPartial,'Payroll basis or period snapshot does not reconcile.');
    }else fail(!normalized.calculationVersion&&!Object.hasOwn(l,'eligibleBasis')&&!Object.hasOwn(l,'skippedForPartial'),'Unexpected rule snapshot version.');
    fail(l.basis<=r.gross&&rateAmount(normalized,l.basis)===l.amount,'Tax line does not reconcile.');
  }
  for(const rule of r.excludedRules){code(rule.key);labels(rule.name);}
  fail(r.gross===r.regular+r.other&&r.net===r.gross-r.employeeTax-pretaxTotal&&r.cost===r.gross+r.employerTax&&r.employeeTax===r.ruleLines.filter(l=>l.rule.side==='employee').reduce((n,l)=>n+l.amount,0)&&r.employerTax===r.ruleLines.filter(l=>l.rule.side==='employer').reduce((n,l)=>n+l.amount,0),'Manual payroll snapshot does not reconcile.');
}
export const payrollDollars=n=>[Math.trunc(n/100),String(n%100).padStart(2,'0')].join('.');
const quote=v=>'"'+String(v??'').replace(/^(?:[\t\r\n]|\s*[=+@-])/,"'$&").replaceAll('"','""')+'"';
export function payrollRegisterCsv(runs){
 const header=['run_id','mode','employee_id','employee','period_start','period_end','pay_date','regular_usd','other_usd','gross_usd','employee_tax_usd','employer_tax_usd','net_usd','employer_cost_usd','rule_breakdown','excluded_rules','calculation_version','pay_period_kind','pretax_regular_usd','pretax_other_usd','pretax_total_usd','rule_method_snapshot_json'];
 return header.join(',')+'\r\n'+runs.map(r=>[r.id,r.mode,r.employee,r.employeeName,r.start,r.end,r.payDate,...[r.regular,r.other,r.gross,r.employeeTax,r.employerTax,r.net,r.cost].map(payrollDollars),r.ruleLines.map(l=>l.rule.key+':'+l.rule.side+':'+payrollDollars(l.amount)).join('; '),(r.excludedRules||[]).map(l=>l.key).join('; '),r.calculationVersion??1,r.periodKind??'full',
   ...[r.pretaxRegular??0,r.pretaxOther??0,r.pretaxTotal??0].map(payrollDollars),
   JSON.stringify(r.ruleLines.map(l=>({...l,rule:{...l.rule,...manualRulePolicy(l.rule)}})))].map(quote).join(',')).join('\r\n')+'\r\n';
}
export function payrollJournalCsv(runs,accountMap){
 const refs=['wages','employerExpense','net','employeeTax','employerTax',...(runs.some(r=>r.pretaxTotal>0)?['pretaxPayable']:[])];
 for(const ref of refs)fail(typeof accountMap[ref]==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/.test(accountMap[ref]),'Enter verified chart account codes (1–40 letters, digits, periods, hyphens or underscores).');
 const rows=[];
 for(const r of runs){
   const lines=[['wages','Gross wage expense',r.gross,0],['employerExpense','Employer tax expense',r.employerTax,0],['net','Net wage payable',0,r.net],['employeeTax','Employee tax payable',0,r.employeeTax],['employerTax','Employer tax payable',0,r.employerTax],['pretaxPayable','Entered pre-tax deduction payable',0,r.pretaxTotal??0]];
   fail(lines.reduce((d,x)=>d+x[2]-x[3],0)===0,'Payroll journal does not balance.');
   for(const [ref,memo,dr,cr] of lines)if(dr||cr)rows.push([r.id,r.payDate,accountMap[ref],memo,payrollDollars(dr),payrollDollars(cr)].map(quote).join(','));
 }
 return 'manual_run_id,pay_date,external_account,memo,debit_usd,credit_usd\r\n'+rows.join('\r\n')+'\r\n';
}
function pdfEsc(t){
  return String(t).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7e]/g,'?').replace(/[()\\]/g,'\\$&');
}
export function manualPaystubPdf(run){
 fail(run?.finalizedAt,'Finalize payroll before downloading a statement.');
 const text=[run.companyName,'MANUAL PAYROLL - PAY STATEMENT','Employee: '+run.employeeName,'Pay date: '+run.payDate+'  Period: '+run.start+' to '+run.end,'Regular earnings: $'+payrollDollars(run.regular)+'  Other earnings: $'+payrollDollars(run.other),'Gross pay: $'+payrollDollars(run.gross),...(run.calculationVersion===2?['Pay period type: '+run.periodKind,'Entered pre-tax deductions: $'+payrollDollars(run.pretaxTotal)]:[]),...run.ruleLines.filter(l=>l.rule.side==='employee').map(l=>l.rule.name+(l.rule.jurisdiction?' ['+l.rule.jurisdiction+']':'')+': $'+payrollDollars(l.amount)),'Total withheld: $'+payrollDollars(run.employeeTax),'Net pay: $'+payrollDollars(run.net),'Recorded in FirmQuill this calendar year (incl. current): gross $'+payrollDollars(run.priorGross+run.gross)+'; net $'+payrollDollars(run.priorNet+run.net),'Withholding uses company-entered rules. This document does not transfer funds.'];
 const wrapped=text.flatMap(line=>line.match(/.{1,78}/g)||['']);
 const pdfHead='%PDF-1.4\n',pages=[];
 for(let i=0;i<wrapped.length;i+=45)pages.push(wrapped.slice(i,i+45));
 const objs=['<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 const kids=[];
 for(const chunk of pages){
   const i=objs.length+1;kids.push(i+' 0 R');
   const stream='BT /F1 10 Tf 14 TL 48 748 Td '+chunk.map((l,index)=>(index?'T* ':'')+'('+pdfEsc(l)+') Tj').join('\n')+'\nET\n';
   objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents '+(i+1)+' 0 R >>','<< /Length '+stream.length+' >>\nstream\n'+stream+'endstream');
 }
 objs[1]='<< /Type /Pages /Count '+kids.length+' /Kids ['+kids.join(' ')+'] >>';
 let pdf=pdfHead;const offsets=[];
 for(const [i,body] of objs.entries()){offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+body+'\nendobj\n';}
 const xref=pdf.length;pdf+='xref\n0 '+(objs.length+1)+'\n0000000000 65535 f \n'+offsets.map(v=>String(v).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+(objs.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
 return new TextEncoder().encode(pdf);
}
