// Shared authorized snapshot reader. Schedule, dashboard and home never manufacture an empty result from a failed read.
import {api,esc} from './common.js';
import {koreanToday} from '../domain.mjs';
import {productionView,ahuView} from './production-view.js?v=20261124-requests';
import {productionDisplay} from './production-display.js?v=20261124-requests';
import {productionPriority} from './production-priority.js?v=20261124-layout';
let account=null;const snapshots=new Map(),pending=new Map();
const identity=()=>window.hpmServerUser?JSON.stringify([window.hpmServerUser.id,window.hpmServerUser.role,window.hpmServerUser.authRevision]):null;
function current(){const owner=identity();if(owner!==account){account=owner;snapshots.clear();pending.clear();}return owner;}
if(typeof document!=='undefined')document.addEventListener('hpm:auth',current);
export const productionTime=value=>{if(!value)return '미기록';const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));return p.year+'-'+p.month+'-'+p.day+' '+p.hour+':'+p.minute+' KST';};
export async function loadProductionSnapshot(part,{onProgress=()=>{}}={}){
 if(!['part1','part2'].includes(part))throw Error('생산 파트를 선택하세요.');const owner=current();if(!owner)throw Error('로그인 후 생산자료를 조회하세요.');
 const check=()=>{if(identity()!==owner)throw Error('로그인 계정이 변경됐습니다.');},scoped=path=>api(path+(path.includes('?')?'&':'?')+'part='+part);
 const {record}=await scoped('imports/latest?kind=production');check();
 if(!record)return {state:'empty',part,record:null,records:[],meta:null,equipment:part==='part2'?'LINE 5000':'',queriedAt:new Date().toISOString()};
 const key=owner+'|'+part+'|'+record.id+'|'+record.sha256;
 let snapshot=snapshots.get(key);
 if(!snapshot){
  if(!pending.has(key))pending.set(key,(async()=>{
   const records=[],ids=new Set();let response=null,offset=0;
   do{response=await scoped('production?import='+encodeURIComponent(record.id)+'&offset='+offset);check();if(response.importId!==record.id||response.imported?.row_count!==record.row_count)throw Error('자료 버전이 달라 다시 조회해야 합니다.');for(const row of response.records){if(ids.has(row.id))throw Error('중복된 조회 응답입니다. 다시 조회하세요.');ids.add(row.id);records.push(row);}const next=response.nextOffset;if(next!=null&&(!Number.isSafeInteger(next)||next<=offset))throw Error('조회 위치를 확인할 수 없습니다.');offset=next;onProgress(records.length,record.row_count);}while(offset!=null);
   if(records.length!==record.row_count)throw Error('전체 행 조회를 완료하지 못했습니다.');
   const meta=response.version===2?response.meta:null,equipment=part==='part2'?'LINE 5000':meta?.equipment||['제조사양관리구분','분류','LINE 5000'].find(k=>records.some(r=>Object.hasOwn(r,k)))||'';
   if(part==='part1'&&meta){const extra=['규격','제품 규격','품번'].flatMap(name=>{const matches=meta.columns.map((c,index)=>({c,index})).filter(({c})=>c.title.trim()===name);return matches.length===1&&!records.some(r=>Object.hasOwn(r,name))?[[name,matches[0].index]]:[];});if(extra.length){const byId=new Map(records.map(r=>[r.id,r])),seen=new Set();let rawOffset=0;do{const result=await scoped('imports/'+record.id+'/rows?offset='+rawOffset);check();for(const raw of result.records){const row=byId.get(record.id+'_'+raw.number);if(!row||seen.has(raw.number))throw Error('표시할 원본 행이 조회 자료와 다릅니다.');for(const [name,index]of extra)row[name]=raw.values[index]??'';seen.add(raw.number);}const next=result.nextOffset;if(next!=null&&(!Number.isSafeInteger(next)||next<=rawOffset))throw Error('원본 조회 위치를 확인하세요.');rawOffset=next;}while(rawOffset!=null);if(seen.size!==records.length)throw Error('원본 열 조회가 불완전합니다. 다시 조회하세요.');}}
   check();const result={records,meta,equipment};for(const cached of snapshots.keys())if(cached.startsWith(owner+'|'+part+'|'))snapshots.delete(cached);snapshots.set(key,result);return result;
  })().finally(()=>pending.delete(key)));
  snapshot=await pending.get(key);
 }
 check();if(snapshot.records.length!==record.row_count)throw Error('저장 자료의 전체 건수를 확인하세요.');
 return {...snapshot,state:'ready',part,record,queriedAt:new Date().toISOString()};
}
export function productionOverview(snapshot,filters={},selection={},today=koreanToday()){
 const {part,records,equipment}=snapshot,view=part==='part2'?ahuView(records,filters,selection,today):productionView(records,filters,equipment,selection,today);view.display=productionDisplay(view,part,equipment);return {view,priority:productionPriority(view.records,{part,today}),snapshot,today,filters:{...filters}};
}
export function productionBucket(model,bucket){if(['overdue','upcoming','unknown'].includes(bucket))return model.priority[bucket].map(i=>i.record);if(bucket==='active'||bucket==='ready'){const chosen=productionOverview(model.snapshot,model.filters||{}, {status:bucket},model.today);return chosen.view.records;}return model.view.records;}
export function productionBasis(snapshot,{queryTime=false}={}){
 if(!snapshot.record)return '<span>자료 미반영 · 생산일정 관리에서 담당자가 파일을 반영해 주세요.</span>';
 const r=snapshot.record;return `<span>자료 기준일 <strong>${esc(r.source_date||'기준일 미제공')}</strong></span><span>마지막 반영 ${esc(productionTime(r.applied_at))}</span><span>반영자 ${esc(r.applied_by||'미기록')}${r.applied_by_basis==='import-owner'?' (기존 이력 등록자)':''}</span><span class="production-basis-file">${esc(r.filename)}</span>${queryTime?`<span>현재 조회 ${esc(productionTime(snapshot.queriedAt))}</span>`:''}`;
}
