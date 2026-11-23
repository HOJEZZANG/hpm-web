import {api} from './common.js';
import {calendarDate} from '../ahu-pnd.mjs?v=20261119-stx';
let owner=null;const memory=new Map(),shared=new Map();
const identity=()=>window.hpmServerUser?.id||null;
function scope(){const current=identity();if(current!==owner){memory.clear();shared.clear();owner=current;}return current;}
if(typeof document!=='undefined')document.addEventListener('hpm:auth',scope);
export const sourceStamp=value=>value?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}).format(new Date(value))+' 한국시간':'시각 미제공';
export function rememberProductionSource(source){if(!scope())return;memory.set(source.purpose,{...source,id:'memory-'+source.purpose,part:'part2',reflectedAt:new Date().toISOString(),origin:'이 로그인 세션에서 읽은 원본'});document.dispatchEvent(new Event('hpm:production-source'));}
export function reusableProductionSources(purpose){scope();const source=memory.get(purpose);return source?[source]:[];}
export function sourceLabel(source){return `${source.filename} · ${source.id?.startsWith('memory-')?'읽은 시각':'반영 시각'} ${sourceStamp(source.reflectedAt)} · ${source.part==='part2'?'2파트':'1파트'} · ${source.origin}`;}
export function preparedPreview(sheet){return {columns:sheet.columns,rows:sheet.rows.map(r=>({number:r.number,values:sheet.columns.map(c=>r.cells.get(c)?.display??'')})),cellCount:sheet.preview?.cellCount};}
export async function sharedProductionSources(part){scope();const result=await api('imports?kind=production&part='+part);return result.records.filter(r=>r.status==='applied').map(r=>({id:r.id,part,filename:r.filename,reflectedAt:r.applied_at,origin:'팀 공용 생산현황 · 마지막 반영 PND',purpose:'erp-latest'}));}
export async function loadSharedProductionSource(source){
 const user=scope(),key=user+'|'+source.part+'|'+source.id;if(shared.has(key))return structuredClone(shared.get(key));
 const suffix='?part='+source.part,detail=await api('imports/'+source.id+suffix);if(identity()!==user)throw Error('로그인 계정이 변경됐습니다.');
 if(detail.status!=='applied'||detail.version!==2||!detail.meta?.columns)throw Error('저장 자료에 원본 열 매핑이 없습니다. Yard·HullNo·PND·품번이 있는 ERP 원본을 선택하세요.');
 const meta=detail.meta,rows=[{number:meta.headerRow||1,cells:new Map(meta.columns.map(c=>[c.position,{value:c.title,display:c.title}]))}],seen=new Set();let offset=0;
 do{const page=await api('imports/'+source.id+'/rows'+suffix+'&offset='+offset);if(identity()!==user)throw Error('로그인 계정이 변경됐습니다.');for(const row of page.records){if(seen.has(row.number)||row.values?.length!==meta.columns.length)throw Error('저장된 원본 행이 불완전합니다.');seen.add(row.number);rows.push({number:row.number,cells:new Map(meta.columns.map((c,i)=>{const value=row.values[i],date=/^(PND|최종완료일|최신공정완료일)$/.test(c.title)?calendarDate(value,meta.date1904):null;return [c.position,{value,display:date?.iso||String(value??'')}];}))});}const next=page.nextOffset;if(next!=null&&(!Number.isSafeInteger(next)||next<=offset))throw Error('저장 자료의 조회 위치가 올바르지 않습니다.');offset=next;}while(offset!=null);
 if(seen.size!==meta.rowCount)throw Error('저장된 생산자료 전체 행을 읽지 못했습니다.');
 const config={header:meta.headerRow||1};for(const [key,title]of Object.entries({yard:'Yard',hull:'HullNo',pnd:'PND',spec:'품번'})){const columns=meta.columns.filter(c=>c.title.trim()===title);if(columns.length!==1)throw Error('PND 대조 ERP용 '+title+' 열이 누락되거나 중복되었습니다. 해당 열이 있는 ERP 원본이 필요합니다.');config[key]=columns[0].position;}
 const sheet={name:meta.sourceSheet||'Sheet1',date1904:meta.date1904,columns:meta.columns.map(c=>c.position),rows,notices:['팀 공용 생산현황의 마지막 반영 PND입니다. 최신 ERP를 직접 조회한 결과가 아니므로 파일명·반영 시각을 확인하세요.'],reusePreset:{ready:true,config,selected:[...seen],reasons:[],rule:'검증된 2파트 생산현황 원본 열·전체 반영 행 재사용'}};sheet.preview=preparedPreview(sheet);shared.set(key,sheet);return structuredClone(sheet);
}
