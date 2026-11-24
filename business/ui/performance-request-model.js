import {canonicalYardCode} from '../ahu-models.mjs?v=20261119-stx';
const clean=value=>String(value??'').normalize('NFC').trim();
export const noticeLine=value=>clean(value).replace(/\s+/g,' ');
const first=(row,keys)=>keys.map(k=>clean(row[k])).find(Boolean)||'';
export function requestIdentity(row,part){
 const yard=canonicalYardCode(row.Yard),hull=clean(row.HullNo),workOrder=clean(row['Work Order']),item=clean(row['품번']),spec=first(row,['규격','제품 규격']),product=first(row,['LINE 5000','분류','제조사양관리구분']);
 const variant=JSON.stringify([spec,item,product]),ship=yard&&hull?JSON.stringify([part,yard,hull]):'';
 return {ship,variant,spec,item,product,workOrder,strong:workOrder&&ship?JSON.stringify([part,yard,hull,workOrder,item,spec,product]):'',weak:ship?JSON.stringify([part,yard,hull,item,spec,product]):'',locator:ship?JSON.stringify([part,yard,hull,workOrder]):''};
}
export function createPerformanceRequestModel(part){
 let snapshot=null,entries=[],serial=0,readState='pending';
 const identity=row=>requestIdentity(row,part),currentRows=()=>snapshot?.records||[];
 function choose(entry,row){entry.current=row;entry.currentId=row.id;entry.identity=identity(row);entry.review='';entry.candidates=[];entry.confirmed=false;}
 function setSnapshot(next){
  const previous=snapshot;snapshot=next;readState='ready';
  for(const entry of entries){
   if(previous?.record?.id===next.record?.id){const same=currentRows().find(r=>r.id===entry.currentId);if(same){if(clean(same['현공정'])!==clean(entry.current?.['현공정'])){entry.confirmed=false;entry.review='ERP 공정 변경 · 요청 필요 여부 재확인';}entry.current=same;continue;}}
   const old=entry.current||entry.original,oldIdentity=entry.identity,oldProcess=clean(old['현공정']),strong=oldIdentity.strong?currentRows().filter(r=>identity(r).strong===oldIdentity.strong):[];
   entry.confirmed=false;entry.previousProcess=oldProcess;
   if(strong.length===1){choose(entry,strong[0]);entry.review=clean(strong[0]['현공정'])===oldProcess?'새 자료 · 현장 완료 재확인':'ERP 공정 변경 · 요청 필요 여부 재확인';}
   else{entry.current=null;entry.currentId='';entry.candidates=currentRows().filter(r=>{const key=identity(r);return oldIdentity.weak&&key.weak===oldIdentity.weak||oldIdentity.locator&&key.locator===oldIdentity.locator;});entry.review=entry.candidates.length?'식별 후보를 선택해 재확인':'새 자료에서 찾지 못함 · 재선택 또는 제외';}
  }
 }
 function toggle(row,checked){if(!row.id)throw Error('안정적인 자료 식별자가 없어 선택할 수 없습니다.');const found=entries.find(e=>e.currentId===row.id);if(!checked){entries=entries.filter(e=>e!==found);return;}if(found)return;if(!snapshot?.record)throw Error('반영된 생산자료를 먼저 조회하세요.');entries.push({key:String(++serial),original:{...row},current:row,currentId:row.id,identity:identity(row),process:clean(row['현공정']),confirmed:false,showSpec:false,review:'',previousProcess:'',candidates:[]});}
 function update(key,patch){const entry=entries.find(e=>e.key===key);if(!entry)return;if(Object.hasOwn(patch,'process')){entry.process=String(patch.process);entry.confirmed=false;}if(Object.hasOwn(patch,'showSpec'))entry.showSpec=Boolean(patch.showSpec);if(Object.hasOwn(patch,'confirmed'))entry.confirmed=Boolean(patch.confirmed);}
 function match(key,id){const entry=entries.find(e=>e.key===key),candidate=entry?.candidates.find(r=>r.id===id);if(!candidate)throw Error('새 자료의 후보를 선택하세요.');choose(entry,candidate);entry.review='선택한 항목의 현장 완료 재확인';}
 function build(){
  const errors=[],lines=[],seen=new Set(),variants=new Map();let duplicates=0;
  for(const row of currentRows()){const key=identity(row);if(key.ship){if(!variants.has(key.ship))variants.set(key.ship,new Set());variants.get(key.ship).add(key.variant);}}
  for(const entry of entries){
   const row=entry.current,reasons=[];if(!row)reasons.push(entry.review||'식별 재확인 필요');if(!clean(row?.Yard))reasons.push('야드 미기재');if(!clean(row?.HullNo))reasons.push('호선 미기재');if(!noticeLine(entry.process))reasons.push('실제 완료 공정 입력 필요');if(!entry.confirmed)reasons.push('현장 완료 확인 필요');
   const key=row?identity(row):entry.identity,required=(variants.get(key.ship)?.size||0)>1,qualifier=key.spec||key.item||key.product;
   if((required||entry.showSpec)&&!qualifier)reasons.push('규격·제품 식별 정보 부족');
   entry.specRequired=required;
   if(reasons.length){errors.push({key:entry.key,reasons:[...new Set(reasons)]});continue;}
   // Weak identities never justify collapsing distinct source records.
   const duplicateKey=JSON.stringify([key.strong||row.id,key.variant,noticeLine(entry.process)]);if(seen.has(duplicateKey)){duplicates++;continue;}seen.add(duplicateKey);
   lines.push([noticeLine(row.Yard),noticeLine(row.HullNo),(required||entry.showSpec)?'('+noticeLine(qualifier)+')':'',noticeLine(entry.process)].filter(Boolean).join(' '));
  }
  return {text:['[실적 미처리 현황]',...lines].join('\n'),lines,errors,duplicates,ready:entries.length>0&&errors.length===0&&readState==='ready'};
 }
 return {setSnapshot,toggle,update,match,build,get entries(){return entries;},get snapshot(){return snapshot;},get readState(){return readState;},setReadState(value){readState=value;},remove(key){entries=entries.filter(e=>e.key!==key);},clear(){entries=[];},isSelected:id=>entries.some(e=>e.currentId===id),visibleCount:rows=>entries.filter(e=>rows.some(r=>r.id===e.currentId)).length};
}
