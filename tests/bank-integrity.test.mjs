import test from 'node:test';
import assert from 'node:assert/strict';
const modules=[['lite','../']];
for(const [name,dir] of modules){
 const {apply,newVault,validateState,openingClearedCashIds,cashMovement}=await import(dir+'core.mjs');
 const {previewBankCsv,statementFingerprint,bankImportReview}=await import(dir+'interop.mjs');
 const fixture=()=>{let state=newVault('Fictional cutover fixture'),id=state.companies[0].id;
  const c=()=>state.companies[0];
  const run=(a)=>state=apply(state,id,a);
  const journal=(date,label,cents)=>run({type:'journal',date,label,flow:'Operating',lines:[['1000',cents],[cents>0?'3000':'5100',-cents]]});
  const rows=(date,...rows)=>run({type:'statement import',date,label:'Fictional bank lines',rows:rows.map(([day,label,amount])=>({date:day,description:label,amountCents:amount,sourceRef:'test-'+day+'-'+label}))});
  const j=label=>c().entries.find(e=>e.memo===label).id;
  const match=(label,entry,date='2026-11-28')=>run({type:'match',date,label:'Bank match',row:c().bank.find(b=>b.description===label).id,entry:j(entry)});
  const rec=(date,closing,openingBasis)=>run({type:'reconcile',date,label:'Bank reconciliation',closing,...(openingBasis?{openingBasis}:{})});
  return {run,c,journal,rows,j,match,rec,state:()=>state};
 };
 test(name+' opens from independently confirmed existing balance, keeps pending items and future backdates visible',()=>{
  const x=fixture();
  x.journal('2026-09-25','Capital received',100000);
  x.journal('2026-09-28','Prior pending cheque',-5000);
  x.journal('2026-10-12','October receipt',18000);
  x.journal('2026-10-21','October disbursement',-15000);
  x.rows('2026-10-31',['2026-10-12','Receipt',18000],['2026-10-21','Payment',-15000]);
  x.match('Receipt','October receipt');x.match('Payment','October disbursement');
  const snap=structuredClone(x.state());
  const basis={through:'2026-09-30',balance:100000,outstanding:[x.j('Prior pending cheque')]};
  assert.throws(()=>x.rec('2026-10-31',103000),/Opening balance/);
  assert.throws(()=>x.rec('2026-10-31',103000,{...basis,balance:101000}),/must equal/);
  assert.throws(()=>x.rec('2026-10-31',103000,{...basis,outstanding:[]}),/must equal/);
  assert.throws(()=>x.rec('2026-10-31',103000,{...basis,through:'2026-10-31'}),/opening date must be before/);
  assert.throws(()=>x.rec('2026-10-31',103000,{...basis,through:'2026-10-12'}),/overlap/);
  assert.throws(()=>x.rec('2026-10-31',103000,{...basis,outstanding:[x.j('October receipt')]}),/missing or after/);
  assert.deepEqual(x.state(),snap);
  x.rec('2026-10-31',103000,basis);assert.equal(validateState(x.state()),true);
  const r=x.c().reconciliations[0];
  assert.deepEqual({opening:r.opening,closing:r.closing,outstanding:r.outstandingCash,book:r.bookCash,links:r.rows.length},
    {opening:100000,closing:103000,outstanding:-5000,book:98000,links:2});
  assert.deepEqual([...openingClearedCashIds(x.c())],[x.j('Capital received')]);
  assert.equal(x.c().entries.length,4);
  // A new posted backdate must not silently count as formerly cleared.
  x.journal('2026-09-29','Later entered pending cash',500);
  x.journal('2026-11-10','November received',2000);
  x.rows('2026-11-20',['2026-11-05','Old pending cheque cleared',-5000],['2026-11-10','New cash cleared',2000]);
  x.match('Old pending cheque cleared','Prior pending cheque');x.match('New cash cleared','November received');
  x.rec('2026-11-30',100000);assert.equal(validateState(x.state()),true);
  assert.equal(x.c().reconciliations.at(-1).opening,103000);
  assert.equal(x.c().reconciliations.at(-1).outstandingCash,500);
  assert.equal(x.c().reconciliations.at(-1).bookCash,100500);
  assert.equal(x.c().reconciliations.at(-1).openingBasis,undefined);
 });
 test(name+' retains old zero-based reconciliation and prevents reusing a cleared opening transaction',()=>{
  const z=fixture();z.journal('2026-09-01','Old legacy cash',10000);
  z.rows('2026-09-29',['2026-09-01','Old statement line',10000]);z.match('Old statement line','Old legacy cash');z.rec('2026-09-30',10000);
  assert.equal(z.c().reconciliations[0].openingBasis,undefined);
  assert.equal(validateState(JSON.parse(JSON.stringify(z.state()))),true);
  const x=fixture();
  x.journal('2026-09-25','Original cash',10000);x.journal('2026-10-11','Receipts later',500);
  x.rows('2026-10-12',['2026-10-11','Current statement',500]);x.match('Current statement','Receipts later');
  x.rec('2026-10-31',10500,{through:'2026-09-30',balance:10000,outstanding:[]});
  x.rows('2026-11-20',['2026-11-05','Similar larger actual new cash',10000]);
  assert.throws(()=>x.match('Similar larger actual new cash','Original cash'),/already cleared/);
 });
 test(name+' reviews ambiguous split lines explicitly and never reoffers normalized exact reviewed reimports',async()=>{
  const src='Date,Description,Amount\n2026-11-05,Fake same-day merchant,-12.75\n';
  const equivalent='Date,Description,Amount\r\n2026-11-05,"Fake same-day merchant",-12.75\r\n';
  const p=(raw,prior)=>previewBankCsv(raw,'wave',prior);
  const a=p(src,[]), keyA=await statementFingerprint(a,103000,101725);
  const rA=bankImportReview(a,[],keyA);
  assert.deepEqual(rA.decisions,['new']);
  const againA=p(equivalent,rA.rows);assert.equal(await statementFingerprint(againA,103000,101725),keyA);
  assert.deepEqual(bankImportReview(againA,rA.rows,keyA).decisions,['duplicate']);
  assert.throws(()=>bankImportReview(againA,rA.rows,keyA,['0']),/selections changed/);
  const b=p(src,rA.rows),keyB=await statementFingerprint(b,101725,100450);
  assert.notEqual(keyA,keyB);
  assert.deepEqual(bankImportReview(b,rA.rows,keyB).decisions,['ambiguous']);
  assert.deepEqual(bankImportReview(b,rA.rows,keyB).rows,[]);
  const rB=bankImportReview(b,rA.rows,keyB,['0']);
  assert.equal(rB.rows.length,1);assert.notEqual(rB.rows[0].sourceRef,rA.rows[0].sourceRef);
  const all=[...rA.rows,...rB.rows];
  assert.deepEqual(bankImportReview(p(equivalent,all),all,keyB).decisions,['recorded']);
  assert.equal(bankImportReview(p(equivalent,all),all,keyB).rows.length,0);
  assert.throws(()=>bankImportReview(p(equivalent,all),all,keyB,['0']),/selections changed/);
  const both=p(src+'2026-11-05,Fake same-day merchant,-12.75\n',[]);
  assert.equal(both.added.length,2);assert.notEqual(both.added[0].sourceRef,both.added[1].sourceRef);
  // Legacy backup rows pass default dedup; only deliberate review can distinguish independent statements.
  const legacy=[{...rA.rows[0],statementKey:undefined}];
  assert.equal(bankImportReview(p(src,legacy),legacy,keyB).rows.length,0);
 });
}
