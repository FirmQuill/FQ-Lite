// Warehouse metadata never posts stock or accounting entries.
export const warehouseTypes = new Set(['warehouse-bin','warehouse-trace','warehouse-trace-release','warehouse-reorder']);
const check=(ok,msg,status=400)=>{if(!ok)throw Object.assign(new Error(msg),{status});};
const clean=(v,n=100,optional=false)=>{check(typeof v==='string'&&v.trim().length<=n&&(optional||v.trim().length)&&!/[\u0000-\u001f\u007f]/.test(v),'Enter valid warehouse text.');return v.trim();};
const day=(v,optional=false)=>{if(optional&&(v===''||v===undefined))return '';check(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'Enter an actual calendar date.');return v;};
const qty=(n,min=0)=>{check(Number.isSafeInteger(n)&&n>=min,'Enter a whole quantity.');return n;};
const uuid=(v)=>clean(v,120);
const product=(book,id)=>{const p=book.items.find(p=>p.id===id&&p.kind==='Product');check(p,'Select an existing stock product in this company.');return p;};
const getUnit=(units,id)=>{const u=units.find(x=>x.id===id);check(u,'Unknown warehouse unit.',404);return u;};
export const emptyWarehouse=()=>({version:1,events:[]});
export const liteWarehouseUnits=units=>units.map(u=>({id:u.id,location:u.location,locationEpoch:u.locationEpoch||0,retired:u.status==='Retired',contents:u.contents.map(x=>({itemId:x.item,quantity:x.qty}))}));
export const fullWarehouseUnits=units=>units.map(u=>({id:u.id,location:u.location,locationEpoch:u.locationEpoch||0,retired:u.status==='retired',contents:u.contents}));
function readWarehouse(data){
  const bins=new Map(),traces=new Map(),rules=new Map();
  for(const e of data.events){
    if(e.type==='warehouse-bin')bins.set(e.unitId,e);
    if(e.type==='warehouse-trace')traces.set(e.id,{...e});
    if(e.type==='warehouse-trace-release')Object.assign(traces.get(e.traceId),{released:e.date,releasedBy:e.actor,releaseNote:e.note});
    if(e.type==='warehouse-reorder')rules.set(JSON.stringify([e.itemId,e.location]),e);
  }
  return {bins,traces,rules};
}
const free=(book,itemId,location)=>book.moves.reduce((n,m)=>n+(m.item===itemId&&m.location===location?m.qty:0),0);
const packed=(u,itemId)=>u.contents.find(c=>c.itemId===itemId)?.quantity||0;
export function warehouseView(data,book,units,today){
  const {bins,traces,rules}=readWarehouse(data);
  const byId=new Map(units.map(u=>[u.id,u])), assigned=new Map();
  for(const e of traces.values())if(!e.released){const k=JSON.stringify([e.unitId,e.itemId]);assigned.set(k,(assigned.get(k)||0)+e.quantity);}
  const liveBin=unitId=>{const b=bins.get(unitId),u=byId.get(unitId);return b&&u&&!u.retired&&u.location===b.location&&u.locationEpoch===(b.locationEpoch||0)?b.bin:'';};
  return {
    bins:[...bins.values()].map(({unitId,location,bin})=>({unitId,location,bin:liveBin(unitId),lastRecordedBin:bin})),
    traces:[...traces.values()].reverse().map(e=>{const u=byId.get(e.unitId), stillPacked=u&&!u.retired&&packed(u,e.itemId)>0;
      const total=assigned.get(JSON.stringify([e.unitId,e.itemId]))||0;
      return {...e,currentLocation:stillPacked?u.location:'',currentBin:stillPacked?liveBin(u.id):'',
        needsReview:!e.released&&(!stillPacked||total>packed(u,e.itemId)),expired:!e.released&&!!e.expiry&&!!today&&e.expiry<=today};}),
    reorder:[...rules.values()].filter(r=>r.target>0).map(r=>{const stock=free(book,r.itemId,r.location);return {...r,stock,suggested:stock<=r.minimum?Math.max(0,r.target-stock):0};}),
    events:[...data.events].reverse()
  };
}
export function warehouseEvent(data,book,units,a,{id,actor}){
  check(warehouseTypes.has(a.type),'Unknown warehouse action.');
  check(data.events.length<10000,'Warehouse history limit reached. Export and review records before adding more.',409);
  const e={id:uuid(id),type:a.type,date:day(a.date),actor:uuid(actor)};
  const current=readWarehouse(data);
  if(a.type==='warehouse-bin'){
    const u=getUnit(units,a.unitId);check(!u.retired,'Retired units cannot be binned.',409);
    Object.assign(e,{unitId:u.id,location:clean(u.location,500),locationEpoch:qty(u.locationEpoch||0),bin:clean(a.bin,100,true)});
  }else if(a.type==='warehouse-trace'){
    const u=getUnit(units,a.unitId),p=product(book,a.itemId);
    check(!u.retired&&packed(u,p.id)>0,'Pack the item into this active unit before recording traceability.',409);
    const lot=clean(a.lot||'',120,true),serial=clean(a.serial||'',120,true),expiry=day(a.expiry||'',true),quantity=qty(a.quantity,1);
    check(lot||serial,'Enter a lot, serial, or both.');
    check(!serial||quantity===1,'A serial number identifies exactly one unit.');
    const currentRows=[...current.traces.values()].filter(t=>!t.released);
    check(!serial||!currentRows.some(t=>t.itemId===p.id&&t.serial.toLowerCase()===serial.toLowerCase()),'This serial is already assigned to this product.',409);
    check(quantity+currentRows.filter(t=>t.itemId===p.id&&t.unitId===u.id).reduce((n,t)=>n+t.quantity,0)<=packed(u,p.id),'Trace quantities exceed what is packed in this unit.',409);
    Object.assign(e,{unitId:u.id,itemId:p.id,location:clean(u.location,500),lot,serial,expiry,quantity});
  }else if(a.type==='warehouse-trace-release'){
    const t=current.traces.get(a.traceId);
    check(t&&!t.released,'That trace record is unavailable or was already released.',409);
    check(e.date>=t.date,'Release date precedes the original trace record.');
    Object.assign(e,{traceId:t.id,note:clean(a.note,500)});
  }else{
    const p=product(book,a.itemId),location=clean(a.location,500),minimum=qty(a.minimum),target=qty(a.target);
    check((target===0&&minimum===0)||(target>minimum),'The target must exceed the reorder threshold. Use zero for both to disable.');
    Object.assign(e,{itemId:p.id,location,minimum,target});
  }
  return e;
}
export function validateWarehouse(data,book,units){
  check(data&&data.version===1&&Array.isArray(data.events)&&data.events.length<=10000,'Invalid warehouse record.');
  const ids=new Set(),traceIds=new Set(),released=new Set();
  for(const e of data.events){
    check(e&&warehouseTypes.has(e.type)&&!ids.has(uuid(e.id)),'Invalid or duplicate warehouse event.');ids.add(e.id);
    day(e.date);uuid(e.actor);
    if(e.type==='warehouse-bin'){getUnit(units,e.unitId);clean(e.location,500);qty(e.locationEpoch||0);clean(e.bin,100,true);}
    else if(e.type==='warehouse-trace'){
      getUnit(units,e.unitId);product(book,e.itemId);clean(e.location,500);
      const lot=clean(e.lot,120,true),serial=clean(e.serial,120,true);check(lot||serial,'Missing lot or serial.');
      day(e.expiry,true);qty(e.quantity,1);check(!serial||e.quantity===1,'Invalid serial quantity.');traceIds.add(e.id);
    }else if(e.type==='warehouse-trace-release'){
      check(traceIds.has(e.traceId)&&!released.has(e.traceId),'Invalid trace release.');released.add(e.traceId);clean(e.note,500);
    }else{product(book,e.itemId);clean(e.location,500);qty(e.minimum);qty(e.target);check((e.minimum===0&&e.target===0)||e.target>e.minimum,'Invalid reorder threshold and target.');}
  }
}
// Human-readable print label; no live service, external assets, or encoded claims.
const xml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function warehouseLabel(unit,bin=''){
  const rows=[[unit.identifier||unit.unitId,18,'bold'],[unit.name,13,'normal'],[[unit.location,bin].filter(Boolean).join(' / '),12,'normal']];
  return '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="120" viewBox="0 0 360 120" role="img" aria-label="'+xml(rows[0][0])+'"><rect x="1" y="1" width="358" height="118" rx="4" fill="white" stroke="black"/>'+
    rows.map(([v,size,weight],i)=>'<text x="12" y="'+(28+i*32)+'" font-family="sans-serif" font-size="'+size+'" font-weight="'+weight+'"'+(String(v??'').length>27?' textLength="336" lengthAdjust="spacingAndGlyphs"':'')+'>'+xml(v)+'</text>').join('')+'</svg>';
}
