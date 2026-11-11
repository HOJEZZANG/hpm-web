// Browser-local comparison evidence only: never workbook bytes or preview cells.
export const PND_DATABASE='hpm-pnd-results';
export const PND_COMPARISON_ALGORITHM='erp-minus-plan-v2';
const readableAlgorithms=new Set(['erp-minus-plan-v1',PND_COMPARISON_ALGORITHM]);
const version=1,maxBytes=64*1024*1024,states=new Set(['advanced','delayed','review','same']);
const resultText=['yard','hull','label','linkBasis','erpYard','planYard','erpHull','planHull','erpSpec','planSpec','erpModel','erpNormalized','planNormalized','erpPnd','planPnd'];
const sourceText=['file','sheet','yard','hull','spec','pnd'];
const check=(ok,message='저장된 PND 결과 형식을 확인할 수 없습니다. 원본 파일을 다시 선택해 비교하세요.')=>{if(!ok)throw Error(message);};
const text=value=>String(value??'');
const scope=(userId,part)=>{check(typeof userId==='string'&&userId.length>0&&['part1','part2'].includes(part));return JSON.stringify([userId,part]);};
const viewState=value=>({search:typeof value?.search==='string'?value.search.slice(0,2000):'',status:['attention','',...states].includes(value?.status)?value.status:'attention',page:Number.isSafeInteger(value?.page)&&value.page>=0?value.page:0});
function config(value){return {header:Number(value.header),yard:Number(value.yard),hull:Number(value.hull),pnd:Number(value.pnd),spec:Number(value.spec),selected:[...value.selected].filter(Number.isSafeInteger),targetConfirmed:Boolean(value.targetConfirmed)};}
export function packPndSnapshot({userId,part,results,files,conditions,comparedAt=new Date().toISOString(),view}){
 check(Array.isArray(results)&&results.length<=40000);const sources=[],bySource=new Map();
 function reference(source){
  const item={...Object.fromEntries(sourceText.map(key=>[key,text(source[key])])),row:source.row,model:{value:text(source.model?.value)},date:{iso:text(source.date?.iso)},notices:(source.notices||[]).map(text)};
  const signature=JSON.stringify(item);if(!bySource.has(signature)){bySource.set(signature,sources.length);sources.push(item);}return bySource.get(signature);
 }
 const rows=results.map(r=>({...Object.fromEntries(resultText.map(key=>[key,text(r[key])])),id:r.id,status:r.status,diff:r.diff,reasons:[...r.reasons],candidateCount:r.candidateCount,eligibleCount:r.eligibleCount,
  erp:r.erp.map(reference),plan:r.plan.map(reference),candidates:r.candidates.map(c=>({source:reference(c.source),reason:text(c.reason),eligible:Boolean(c.eligible)}))}));
 const snapshot={key:scope(userId,part),version,algorithm:PND_COMPARISON_ALGORITHM,snapshotId:crypto.randomUUID(),userId,part,comparedAt,files:{erp:text(files.erp),plan:text(files.plan)},
  conditions:{erp:config(conditions.erp),plan:config(conditions.plan),aliases:Object.entries(conditions.aliases||{}).map(([from,to])=>({from,to:text(to)}))},sources,rows,view:viewState(view)};
 check(new TextEncoder().encode(JSON.stringify(snapshot)).byteLength<=maxBytes,'비교 결과가 브라우저 저장 한도를 초과했습니다. 이전 결과를 유지합니다. 자료를 나누어 비교하세요.');
 unpackPndSnapshot(snapshot,userId,part);return snapshot;
}
export function unpackPndSnapshot(snapshot,userId,part){
 check(snapshot?.key===scope(userId,part)&&snapshot.userId===userId&&snapshot.part===part&&snapshot.version===version&&readableAlgorithms.has(snapshot.algorithm));
 check(typeof snapshot.snapshotId==='string'&&typeof snapshot.comparedAt==='string'&&Number.isFinite(Date.parse(snapshot.comparedAt))&&typeof snapshot.files?.erp==='string'&&typeof snapshot.files?.plan==='string');
 check(Array.isArray(snapshot.sources)&&snapshot.sources.length<=40000&&Array.isArray(snapshot.rows)&&snapshot.rows.length<=40000);const sources=snapshot.sources;
 for(const s of sources)check(sourceText.every(k=>typeof s[k]==='string')&&Number.isSafeInteger(s.row)&&s.row>0&&typeof s.model?.value==='string'&&typeof s.date?.iso==='string'&&Array.isArray(s.notices)&&s.notices.every(n=>typeof n==='string'));
 const get=index=>{check(Number.isSafeInteger(index)&&index>=0&&index<sources.length);return sources[index];};let edges=0;const ids=new Set();
 return snapshot.rows.map(r=>{check(Number.isSafeInteger(r.id)&&r.id>=0&&!ids.has(r.id)&&states.has(r.status)&&resultText.every(k=>typeof r[k]==='string')&&(r.diff===null||Number.isSafeInteger(r.diff))&&Array.isArray(r.reasons)&&r.reasons.every(s=>typeof s==='string')&&Array.isArray(r.erp)&&Array.isArray(r.plan)&&Array.isArray(r.candidates));ids.add(r.id);
  edges+=r.candidates.length;check(edges<=250000&&r.candidateCount===r.candidates.length&&Number.isSafeInteger(r.eligibleCount)&&r.eligibleCount>=0&&r.eligibleCount<=r.candidateCount);
  return {...r,erp:r.erp.map(get),plan:r.plan.map(get),candidates:r.candidates.map(c=>{check(typeof c.reason==='string'&&typeof c.eligible==='boolean');return {...c,source:get(c.source)};})};
 });
}
function open(){return new Promise((resolve,reject)=>{
 if(!globalThis.indexedDB){reject(Error('브라우저 저장 기능을 사용할 수 없습니다. 이전 결과를 교체하지 않았습니다.'));return;}
 let finished=false;const request=indexedDB.open(PND_DATABASE,1),timer=setTimeout(()=>{finished=true;reject(Error('브라우저 저장 공간을 열지 못했습니다. 다른 PND 창을 닫고 다시 시도하세요.'));},5000);
 request.onupgradeneeded=()=>{for(const store of ['snapshots','views'])if(!request.result.objectStoreNames.contains(store))request.result.createObjectStore(store,{keyPath:'key'});};
 request.onerror=()=>{clearTimeout(timer);reject(request.error);};request.onblocked=()=>{clearTimeout(timer);finished=true;reject(Error('다른 PND 창에서 저장 공간을 사용 중입니다. 창을 닫고 다시 시도하세요.'));};
 request.onsuccess=()=>{clearTimeout(timer);if(finished){request.result.close();return;}request.result.onversionchange=()=>request.result.close();resolve(request.result);};
});}
async function transaction(mode,work,signal){
 if(signal?.aborted)throw new DOMException('비교를 취소했습니다.','AbortError');const db=await open();
 return new Promise((resolve,reject)=>{const tx=db.transaction(['snapshots','views'],mode),result={},abort=()=>{try{tx.abort();}catch{}};let synchronousError;
  const close=()=>{signal?.removeEventListener('abort',abort);db.close();};
  tx.oncomplete=()=>{close();resolve(result);};tx.onabort=()=>{const error=synchronousError||tx.error||new DOMException('비교를 취소했습니다.','AbortError');close();reject(error);};
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
  try{work(tx,result);}catch(error){synchronousError=error;abort();}
 });
}
export async function loadPndSnapshot(userId,part){
 const key=scope(userId,part),res=await transaction('readonly',(tx,result)=>{tx.objectStore('snapshots').get(key).onsuccess=e=>result.snapshot=e.target.result;tx.objectStore('views').get(key).onsuccess=e=>result.view=e.target.result;});
 if(!res.snapshot)return null;const results=unpackPndSnapshot(res.snapshot,userId,part);
 return {snapshot:res.snapshot,results,view:viewState(res.view?.snapshotId===res.snapshot.snapshotId?res.view.view:res.snapshot.view)};
}
export async function savePndSnapshot(snapshot,{signal}={}){
 unpackPndSnapshot(snapshot,snapshot.userId,snapshot.part);
 await transaction('readwrite',tx=>{tx.objectStore('snapshots').put(snapshot);tx.objectStore('views').put({key:snapshot.key,snapshotId:snapshot.snapshotId,view:snapshot.view});},signal);
}
export async function savePndView(userId,part,snapshotId,view){await transaction('readwrite',tx=>tx.objectStore('views').put({key:scope(userId,part),snapshotId,view:viewState(view)}));}
export function pndStorageError(error){return error?.name==='QuotaExceededError'?'브라우저 저장 공간이 부족합니다. 이전 비교 결과를 유지했습니다.':error?.message||'결과를 저장하지 못했습니다. 이전 비교 결과를 유지했습니다.';}
