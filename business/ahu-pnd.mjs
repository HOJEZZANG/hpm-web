// Pure comparison rules. No network, storage, local timezone or inferred yard aliases.
import {normalizeAhuModel,confirmedYardConflict} from './ahu-models.mjs';
export const AHU_LIMITS = Object.freeze({file:10*1024*1024,expanded:32*1024*1024,rows:20000,cells:250000,columns:256,text:16*1024*1024,candidates:250000});
export const AHU_NOTICE = 'ERP PND 대비 생산계획 PND 기준입니다. 두 자료의 날짜 차이이며 실제 납기 지연 판정이나 과거 대비 변경 이력이 아닙니다.';
const DAY=86400000;
export function calendarDate(value,date1904=false){
  if(value===''||value==null)return {iso:'',reason:'빈 날짜'};
  let y,m,d;
  if(typeof value==='number'){
    if(Number.isInteger(value)&&/^\d{8}$/.test(String(value)))return calendarDate(String(value),date1904);
    const serial=Math.floor(value);
    if(!Number.isFinite(value)||serial<(date1904?0:1)||serial>2958465||!date1904&&serial===60)return {iso:'',reason:'잘못된 Excel 날짜'};
    const time=Date.UTC(date1904?1904:1899,date1904?0:11,date1904?1:31)+(serial-(!date1904&&serial>60?1:0))*DAY;
    const iso=new Date(time).toISOString().slice(0,10);
    return /^\d{4}-/.test(iso)&&iso<='9999-12-31'?{iso,day:time/DAY}:{iso:'',reason:'날짜 범위 초과'};
  }
  const s=String(value).trim();if(!s)return {iso:'',reason:'빈 날짜'};
  const match=/^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})(?:(?:T| )\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(s);
  if(match)[,y,,m,d]=match;else if(/^\d{8}$/.test(s)){y=s.slice(0,4);m=s.slice(4,6);d=s.slice(6,8);}else return {iso:'',reason:'날짜 형식 오류 (연-월-일 필요)'};
  const time=Date.UTC(+y,+m-1,+d),date=new Date(time);
  if(+y<1900||+y>9999||date.getUTCFullYear()!==+y||date.getUTCMonth()!==+m-1||date.getUTCDate()!==+d)return {iso:'',reason:'존재하지 않거나 범위를 벗어난 날짜'};
  return {iso:`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`,day:time/DAY};
}
export const identity=value=>String(value??'').trim();
export function comparePnd(erp,plan,aliases={}){
  const sources={erp:erp.map((r,i)=>prepare(r,'erp',i)),plan:plan.map((r,i)=>prepare(r,'plan',i))},indexes={erp:index(sources.erp),plan:index(sources.plan)},used=new Set(),results=[];
  let edges=0,examined=0;const eligibility=new Map();
  function prepare(r,side,i){const yard=identity(r.yard);return {...r,side,sourceId:side+':'+i,yard,hull:identity(r.hull),spec:String(r.spec??''),model:normalizeAhuModel(r.spec,side),matchYard:side==='plan'&&Object.hasOwn(aliases,yard)?identity(aliases[yard]):yard};}
  function pairKey(r){return r.hull&&r.model.key?JSON.stringify([r.hull,r.model.key]):'';}
  function index(rows){const out={yard:new Map(),hull:new Map(),model:new Map(),pair:new Map()};for(const r of rows)for(const [key,value]of [['yard',r.matchYard],['hull',r.hull],['model',r.model.key],['pair',pairKey(r)]])if(value){if(!out[key].has(value))out[key].set(value,[]);out[key].get(value).push(r);}return out;}
  function conflict(a,b){return confirmedYardConflict(a.side==='erp'?a.yard:b.yard,a.side==='plan'?a.yard:b.yard,aliases);}
  function eligible(r){if(eligibility.has(r.sourceId))return eligibility.get(r.sourceId);if(r.keyIssue||!pairKey(r))return [];const bucket=indexes[r.side==='erp'?'plan':'erp'].pair.get(pairKey(r))||[];examined+=bucket.length;if(examined>AHU_LIMITS.candidates)throw Error('호선·규격 후보 관계 250,000개 한계를 초과했습니다. AHU 대상 행을 좁혀 재비교하세요.');const choices=bucket.filter(other=>!other.keyIssue&&!conflict(r,other));eligibility.set(r.sourceId,choices);return choices;}
  function candidates(r,confirmedId=''){
    const opposite=indexes[r.side==='erp'?'plan':'erp'],found=new Map();
    for(const [key,value]of [['yard',r.matchYard],['hull',r.hull],['model',r.model.key]])for(const other of value?opposite[key].get(value)||[]:[])found.set(other.sourceId,other);
    edges+=found.size;if(edges>AHU_LIMITS.candidates)throw Error('OR 후보 관계 250,000개 한계를 초과했습니다. AHU 대상 행을 좁혀 재비교하세요. 후보를 조용히 생략하지 않습니다.');
    return [...found.values()].map(other=>{
      const yard=Boolean(r.matchYard&&r.matchYard===other.matchYard),hull=Boolean(r.hull&&r.hull===other.hull),spec=Boolean(r.model.key&&r.model.key===other.model.key),yardConflict=conflict(r,other),notes=[];
      if(r.hull&&other.hull&&!hull)notes.push('호선 다름: 자동 연결 제외');if(!r.hull||!other.hull)notes.push('호선 누락');
      if(!r.model.key||!other.model.key)notes.push('규격 누락 또는 미확인 형식');else if(!spec)notes.push('규격 다름');
      if(yardConflict)notes.push('확인된 서로 다른 조선소 코드');if(r.keyIssue||other.keyIssue)notes.push('식별자 확인 필요');
      const matches=[yard?'야드':'',hull?'호선':'',spec?'규격':''].filter(Boolean);
      return {source:other,matches,yard,hull,spec,yardConflict,eligible:hull&&spec&&!yardConflict&&!r.keyIssue&&!other.keyIssue,reason:matches.join('·')+' 일치'+(notes.length?' / '+notes.join(' / '):other.sourceId===confirmedId?' / 일대일 유일성 확인':' / 유일성 확인 필요')};
    }).sort((a,b)=>Number(b.hull&&b.spec)-Number(a.hull&&a.spec)||Number(b.hull)-Number(a.hull)||Number(b.spec)-Number(a.spec)||a.source.row-b.source.row);
  }
  function make(erows,prows,linked,list=[],extra=[]){
    const rows=[...erows,...prows],first=prows[0]||erows[0],reasons=[...extra];
    for(const row of rows){if(!row.hull)reasons.push(`${row.side==='erp'?'ERP':'생산계획'} 호선번호 누락`);if(!row.model.key)reasons.push(row.model.reason);if(row.keyIssue)reasons.push(row.keyIssue);if(row.date?.reason)reasons.push(`${row.side==='erp'?'ERP':'생산계획'} ${row.row}행: ${row.date.reason}`);}
    let status='review',label='확인 필요',diff=null;
    if(linked&&!reasons.length){diff=prows[0].date.day-erows[0].date.day;status=diff<0?'advanced':diff>0?'delayed':'same';label=diff<0?`${-diff}일 당겨짐`:diff>0?`${diff}일 지연`:'일치';}
    const ep=erows[0],pp=prows[0],basis=!linked?'자동 연결 보류':ep.yard===pp.yard?'호선·규격·야드 일치':ep.matchYard&&ep.matchYard===pp.matchYard?'호선·규격 일치 / 확인한 야드 별칭':!ep.yard||!pp.yard?'호선·규격 일치 / 야드 누락':'호선·규격 일치 / 야드 표기 다름';
    return {id:results.length,yard:first.yard,hull:first.hull,erp:erows,plan:prows,linked,status,label,diff,reasons:[...new Set(reasons)],linkBasis:basis,candidates:list,candidateCount:list.length,eligibleCount:list.filter(c=>c.eligible).length,erpYard:ep?.yard||'',planYard:pp?.yard||'',erpHull:ep?.hull||'',planHull:pp?.hull||'',erpSpec:ep?.spec||'',planSpec:pp?.spec||'',erpModel:ep?.model.model||'',erpNormalized:ep?.model.value||'',planNormalized:pp?.model.value||'',erpPnd:ep?(ep.date.iso||String(ep.pnd??'')||'(빈 날짜)'):'',planPnd:pp?(pp.date.iso||String(pp.pnd??'')||'(빈 날짜)'):''};
  }
  for(const e of sources.erp){const choices=eligible(e);if(choices.length!==1)continue;const p=choices[0];if(eligible(p).length!==1||used.has(e.sourceId)||used.has(p.sourceId))continue;used.add(e.sourceId);used.add(p.sourceId);results.push(make([e],[p],true,candidates(e,p.sourceId)));}
  for(const side of ['erp','plan'])for(const row of sources[side]){
    if(used.has(row.sourceId))continue;const list=candidates(row),choices=eligible(row),reasons=[];
    if(!list.length)reasons.push(side==='erp'?'생산계획에 해당 항목 없음 (ERP에만 있음)':'ERP에 해당 항목 없음 (생산계획에만 있음)');
    else if(choices.length>1||choices.length===1&&eligible(choices[0]).length>1)reasons.push('중복·복수 후보: 호선·규격이 같은 대상의 일대일 유일성 확인 필요');
    else if(list.some(c=>c.yardConflict&&c.hull&&c.spec))reasons.push('확인된 서로 다른 조선소 코드: 자동 연결하지 않음');
    else reasons.push('OR 후보는 있으나 호선·규격이 모두 같은 유일한 연결을 확인하지 못함');
    results.push(make(side==='erp'?[row]:[],side==='plan'?[row]:[],false,list,reasons));
  }
  const rank={advanced:0,delayed:1,review:2,same:3};
  return results.sort((a,b)=>rank[a.status]-rank[b.status]||(a.status==='advanced'?a.diff-b.diff:0)||a.yard.localeCompare(b.yard,'ko')||a.hull.localeCompare(b.hull,'ko')||a.id-b.id);
}
export function filterResults(rows,search='',status=''){
  const q=search.trim().toLocaleLowerCase();return rows.filter(r=>(!status||r.status===status)&&(!q||[r.yard,r.hull,r.erpYard,r.planYard,r.erpHull,r.planHull,r.erpSpec,r.planSpec,r.erpNormalized,r.planNormalized,r.linkBasis].join(' ').toLocaleLowerCase().includes(q)));
}
export const sourceLabel=row=>`${row.file} / ${row.sheet} / ${row.row}행 (야드: ${row.yard}, 호선: ${row.hull}, 규격/품번: ${row.spec??''}, 비교값: ${row.model?.value||''}, PND 원본: ${row.pnd??''})${row.notices?.length?' · '+row.notices.join(' / '):''}`;
export function exportRows(rows){
  let size=0;return rows.map(r=>{const values=[r.yard,r.hull,r.erpPnd,r.planPnd,r.diff??'',r.label,r.reasons.join(' / '),r.erp.map(sourceLabel).join('\n'),r.plan.map(sourceLabel).join('\n'),AHU_NOTICE,r.erpYard,r.planYard,r.erpHull,r.planHull,r.planSpec,r.erpSpec,r.erpModel,r.planNormalized,r.erpNormalized,r.linkBasis,r.candidateCount,r.eligibleCount,r.candidates.map(c=>sourceLabel(c.source)+' · '+c.reason).join('\n')];
    for(const value of values){if(String(value).length>32767)throw Error('다운로드 셀의 32,767자 한계를 초과했습니다. 중복 원본 위치를 확인하고 자료를 나누세요.');size+=String(value).length*2;}
    if(size>32*1024*1024)throw Error('다운로드 텍스트 32MiB 한계를 초과했습니다. 결과를 필터링하여 나누어 받으세요.');return values;});
}
export const exportColumns=['대표 야드','대표 호선번호','ERP PND','생산계획 PND','PND 차이 (일, 생산계획-ERP)','비교 결과','확인 사유','ERP 원본 위치','생산계획 원본 위치','비교 기준','ERP 원본 야드','생산계획 원본 야드','ERP 호선번호','생산계획 호선번호','생산계획 규격 원본','ERP 품번 원본','ERP 모델 부분','생산계획 정규화 비교값','ERP 정규화 비교값','연결 근거','OR 후보 수','호선·규격 후보 수','후보 원본 및 일치/제외 사유'];
