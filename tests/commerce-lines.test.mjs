import test from 'node:test';
import assert from 'node:assert/strict';
import {newVault,apply,validateState,balance,position,nextSteps,outstanding,documentLines} from '../core.mjs';
const day='2026-11-01';
function demo(){let s=newVault('Fictional commercial test');const id=s.companies[0].id;const c=()=>s.companies[0];const add=(type,fields={})=>{s=apply(s,id,{type,date:day,...fields});validateState(s);return c().history.at(-1);};
 const buyer=add('contact',{name:'Fictional Buyer',kind:'Customer'}).id,seller=add('contact',{name:'Fictional Supplier',kind:'Vendor'}).id,product=add('item',{name:'Fictional Widget',kind:'Product'}).id,service=add('item',{name:'Fictional Service',kind:'Service'}).id;
 return {c,add,buyer,seller,product,service,get:()=>s,id};
}
const choose=(parent,lineId,qty)=>({parent:parent.id,lines:[{lineId,qty}]});
test('multi-line partial fulfillment, invoice and mixed paid/unpaid return preserve amounts, stock basis and A/R',()=>{
 const {c,add,buyer,product,service}=demo();
 add('adjust in',{item:product,location:'A',qty:3,amount:701});
 const quote=add('quote',{party:buyer,lines:[{item:product,qty:3,unit:1000,discount:100,location:'A'},{item:service,qty:1,unit:1101,discount:1}]});
 assert.equal(quote.total,4000);const order=add('sales order',{parent:quote.id});
 const first=add('fulfillment',choose(order,'L1',1));assert.equal(first.total,967);assert.equal(first.lines[0].cost,234);
 const rest=add('fulfillment',{parent:order.id});assert.equal(rest.total,3033);assert.equal(rest.lines[0].cost,467);assert.deepEqual(nextSteps(c(),order),[]);
 const a=add('invoice',{parent:first.id}),b=add('invoice',{parent:rest.id});assert.equal(balance(c(),'1100'),4000);assert.equal(balance(c(),'5000'),701);
 add('collection',{parent:b.id,amount:2500});let credit=add('sales credit',choose(b,'L1',1));
 assert.equal(credit.total,966);assert.equal(credit.applied,533);assert.equal(credit.refund,433);assert.equal(outstanding(c(),b),0);
 credit=add('sales credit',{parent:b.id});assert.equal(credit.total,2067);assert.equal(credit.refund,2067);assert.equal(credit.applied,0);
 assert.equal(balance(c(),'1100'),967);assert.equal(balance(c(),'1000'),0);assert.equal(balance(c(),'4000'),-967);assert.equal(balance(c(),'5000'),234);assert.deepEqual(position(c(),product,'A'),{qty:2,value:467});
 add('sales credit',{parent:a.id});assert.equal(balance(c(),'1100'),0);assert.deepEqual(position(c(),product,'A'),{qty:3,value:701});
});
test('mixed purchase receives only selected stock, bills partial receipt, and cumulative vendor credits balance',()=>{
 const {c,add,seller,product,service}=demo();
 const order=add('purchase order',{party:seller,lines:[{item:product,qty:4,unit:1000,discount:1,location:'Main'},{item:service,qty:1,unit:330,discount:0}]});
 const a=add('receiving',choose(order,'L1',3));assert.equal(a.total,2999);assert.equal(balance(c(),'2050'),-2999);
 const b=add('receiving',{parent:order.id});assert.equal(b.total,1330);assert.equal(balance(c(),'2050'),-3999);
 const aa=add('bill',{parent:a.id}),bb=add('bill',{parent:b.id});assert.equal(balance(c(),'2050'),0);assert.equal(balance(c(),'5100'),330);assert.equal(balance(c(),'2000'),-4329);
 add('payment',{parent:bb.id,amount:400});const credit=add('vendor credit',{parent:bb.id});
 assert.equal(credit.applied,930);assert.equal(credit.refund,400);assert.equal(balance(c(),'1000'),0);assert.equal(balance(c(),'5100'),0);assert.equal(balance(c(),'2000'),-2999);
 assert.equal(position(c(),product,'Main').qty,3);add('vendor credit',{parent:aa.id});assert.deepEqual(position(c(),product,'Main'),{qty:0,value:0});assert.equal(balance(c(),'2000'),0);assert.equal(balance(c(),'5200'),0);
});
test('line selection, closed date, and malformed input are rejected without altering the existing book',()=>{
 const {get,id,add,buyer,product,service}=demo();
 const q=add('quote',{party:buyer,lines:[{item:product,qty:2,unit:500},{item:service,qty:1,unit:400}]});
 const order=add('sales order',{parent:q.id});const prior=structuredClone(get());
 assert.throws(()=>apply(get(),id,{...choose(order,'L1',3),type:'fulfillment',date:day}),/remaining line quantity/);
 assert.throws(()=>apply(get(),id,{...choose(order,'L1',2),type:'fulfillment',date:day}),/Insufficient stock/);
 assert.throws(()=>apply(get(),id,{type:'fulfillment',date:day,parent:order.id,lines:[{lineId:'L2',qty:1},{lineId:'L2',qty:1}]}),/distinct/);
 assert.throws(()=>apply(get(),id,{type:'quote',date:day,party:buyer,lines:[{item:service,qty:1,unit:400,discount:400}]}),/discount/);
 assert.throws(()=>apply(get(),id,{type:'quote',date:day,party:buyer,lines:[{item:service,qty:2,unit:Number.MAX_SAFE_INTEGER}]}),/integer range/);
 assert.deepEqual(get(),prior);
 assert.throws(()=>{const broken=structuredClone(get());broken.companies[0].docs.at(-1).lines[0].discount=13;validateState(broken);},/line total/);
});
test('legacy portable records still have the original whole-document workflow and no data rewrite',()=>{
 const {add,buyer,service,get}=demo();const quote=add('quote',{party:buyer,item:service,qty:2,unit:130});
 assert.equal(Object.hasOwn(quote,'lines'),false);assert.equal(documentLines(quote)[0].total,260);const prior=JSON.stringify(get());assert.equal(validateState(JSON.parse(prior)),true);assert.equal(JSON.stringify(get()),prior);
 const o=add('sales order',{parent:quote.id});assert.equal(Object.hasOwn(o,'lines'),false);
});
