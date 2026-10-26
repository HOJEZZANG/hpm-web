// Pure comparison rules. No network, storage, local timezone or inferred AHU/yard aliases.
export const AHU_LIMITS = Object.freeze({file:10*1024*1024,expanded:32*1024*1024,rows:20000,cells:250000,columns:256,text:16*1024*1024});
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
  const groups=new Map(),orphans=[];
  for(const [side,rows]of [['erp',erp],['plan',plan]])for(const original of rows){
    const row={...original,yard:identity(original.yard),hull:identity(original.hull)};
    const yard=side==='plan'&&Object.hasOwn(aliases,row.yard)?aliases[row.yard]:row.yard;
    if(!yard||!row.hull||row.keyIssue){orphans.push({yard,hull:row.hull,erp:side==='erp'?[row]:[],plan:side==='plan'?[row]:[],keyReason:row.keyIssue||[!yard?'야드 누락':'',!row.hull?'호선번호 누락':''].filter(Boolean).join(' / ')});continue;}
    const key=JSON.stringify([yard,row.hull]);if(!groups.has(key))groups.set(key,{yard,hull:row.hull,erp:[],plan:[]});groups.get(key)[side].push(row);
  }
  const results=[...groups.values(),...orphans].map((group,id)=>{
    const reasons=[];if(group.keyReason)reasons.push(group.keyReason);
    if(group.erp.length>1||group.plan.length>1)reasons.push(`중복 확인 필요 (ERP ${group.erp.length}행 / 생산계획 ${group.plan.length}행)`);
    if(!group.erp.length)reasons.push('ERP에 해당 항목 없음 (생산계획에만 있음)');if(!group.plan.length)reasons.push('생산계획에 해당 항목 없음 (ERP에만 있음)');
    for(const [side,rows]of [['ERP',group.erp],['생산계획',group.plan]])for(const row of rows)if(row.date.reason)reasons.push(`${side} ${row.row}행: ${row.date.reason}`);
    let status='review',label=group.erp.length>1||group.plan.length>1?'중복 확인 필요':'확인 필요',diff=null;
    if(!reasons.length){diff=group.plan[0].date.day-group.erp[0].date.day;status=diff<0?'advanced':diff>0?'delayed':'same';label=diff<0?`${-diff}일 당겨짐`:diff>0?`${diff}일 지연`:'일치';}
    return {...group,id,status,label,diff,reasons,erpPnd:group.erp.map(r=>r.date.iso||String(r.pnd??'')||'(빈 날짜)').join(' / '),planPnd:group.plan.map(r=>r.date.iso||String(r.pnd??'')||'(빈 날짜)').join(' / ')};
  });
  const rank={advanced:0,delayed:1,review:2,same:3};
  return results.sort((a,b)=>rank[a.status]-rank[b.status]||(a.status==='advanced'?a.diff-b.diff:0)||a.yard.localeCompare(b.yard,'ko')||a.hull.localeCompare(b.hull,'ko')||a.id-b.id);
}
export function filterResults(rows,search='',status=''){
  const q=search.trim().toLocaleLowerCase();return rows.filter(r=>(!status||r.status===status)&&(!q||(r.yard+' '+r.hull).toLocaleLowerCase().includes(q)));
}
export const sourceLabel=row=>`${row.file} / ${row.sheet} / ${row.row}행 (야드: ${row.yard}, 호선: ${row.hull}, PND 원본: ${row.pnd??''})`;
export function exportRows(rows){
  let size=0;return rows.map(r=>{const values=[r.yard,r.hull,r.erpPnd,r.planPnd,r.diff??'',r.label,r.reasons.join(' / '),r.erp.map(sourceLabel).join('\n'),r.plan.map(sourceLabel).join('\n'),AHU_NOTICE];
    for(const value of values){if(String(value).length>32767)throw Error('다운로드 셀의 32,767자 한계를 초과했습니다. 중복 원본 위치를 확인하고 자료를 나누세요.');size+=String(value).length*2;}
    if(size>32*1024*1024)throw Error('다운로드 텍스트 32MiB 한계를 초과했습니다. 결과를 필터링하여 나누어 받으세요.');return values;});
}
export const exportColumns=['야드','호선번호','ERP PND','생산계획 PND','PND 차이 (일, 생산계획-ERP)','비교 결과','확인 사유','ERP 원본 위치','생산계획 원본 위치','비교 기준'];
