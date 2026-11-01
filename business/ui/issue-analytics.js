// Pure browser calculations over authorized issue records; no inferred completion dates.
const closed=new Set(['조치완료','종결']);
export const issueCompleted=record=>closed.has(record.status);
export function day(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return null;const ms=Date.UTC(+value.slice(0,4),+value.slice(5,7)-1,+value.slice(8,10));return new Date(ms).toISOString().slice(0,10)===value?ms/86400000:null;}
export function issueLeadEvidence(record,today){
  const reasons=[],start=day(record.occurDate),end=day(record.completedDate);
  if(start===null)reasons.push(record.occurDate?'발생일 오류':'발생일 누락');
  if(end===null)reasons.push(record.completedDate?'실제 완료일 오류':'실제 완료일 누락');
  if(start!==null&&end!==null&&end<start)reasons.push('완료일이 발생일 이전');
  if(end!==null&&end>day(today))reasons.push('실제 완료일이 오늘 이후');
  return {record,days:reasons.length?null:end-start,reasons};
}
export function analyzeIssues(records,filters={},today=new Date(Date.now()+9*3600000).toISOString().slice(0,10)){
  if(filters.start&&filters.end&&filters.start>filters.end)throw Error('종료일은 시작일 이후여야 합니다.');
  const items=records.filter(r=>(!filters.start&&!filters.end||day(r.occurDate)!==null&&(!filters.start||r.occurDate>=filters.start)&&(!filters.end||r.occurDate<=filters.end))&&['product','process','responsibleDept'].every(key=>!filters[key]||filters[key]==='전체'||(r[key]||'미분류')===filters[key]));
  const completed=items.filter(r=>closed.has(r.status)),open=items.filter(r=>!closed.has(r.status)),now=day(today),warnings=open.filter(r=>day(r.processPnd)!==null&&day(r.processPnd)-now<=7),overdue=warnings.filter(r=>day(r.processPnd)<now);
  const leadEvidence=completed.map(record=>issueLeadEvidence(record,today)),leadIncluded=leadEvidence.filter(r=>!r.reasons.length),leadExcludedRows=leadEvidence.filter(r=>r.reasons.length),leads=leadIncluded.map(r=>r.days);
  const grouped=key=>items.reduce((out,r)=>{const name=String(r[key]||'미분류');out[name]=(out[name]||0)+1;return out;},{}),trend=items.filter(r=>day(r.occurDate)!==null).reduce((out,r)=>{const name=r.occurDate.slice(0,7);out[name]=(out[name]||0)+1;return out;},{});
  return {items,total:items.length,completed:completed.length,open:open.length,warnings,overdue:overdue.length,completedRows:completed,openRows:open,overdueRows:overdue,leadIncluded,leadExcludedRows,followupRows:items.filter(r=>r.followupFlag===true),closeRate:items.length?Math.round(completed.length/items.length*100):null,lead:leads.length?Math.round(leads.reduce((a,b)=>a+b,0)/leads.length*10)/10:null,leadCount:leads.length,leadExcluded:completed.length-leads.length,followups:items.filter(r=>r.followupFlag===true).length,reviews:items.filter(r=>r.followupFlag===true||String(r.prevention||'').trim()),groups:Object.fromEntries(['product','process','responsibleDept','issueType','status'].map(key=>[key,grouped(key)])),trend,missingOccur:items.filter(r=>day(r.occurDate)===null).length};
}
export function issueCardEvidence(data,card,mode=''){
  const wrap=rows=>rows.map(record=>({record,days:null,reasons:[]}));
  if(card==='total')return {title:'조회 건수',rows:wrap(data.items),summary:'현재 공통 조회 조건의 전체 문제점입니다.',tabs:[]};
  if(card==='open')return {title:'미완료',rows:wrap(data.openRows),summary:'조치완료·종결 상태를 제외합니다.',tabs:[]};
  if(card==='overdue')return {title:'PND 경과 미완료',rows:wrap(data.overdueRows),summary:'미완료 중 유효한 공정 PND가 한국 날짜 기준 오늘 이전인 건입니다. PND 당일은 제외합니다.',tabs:[]};
  if(card==='completion')return {title:mode==='all'?'완료율 · 전체 분모':'완료율 · 완료 문제점',rows:wrap(mode==='all'?data.items:data.completedRows),summary:`완료 ${data.completed}건 / 조회 ${data.total}건 · ${data.closeRate===null?'산정 대상 없음':data.closeRate+'%'}. 완료 상태는 조치완료·종결입니다.`,tabs:[['completed','완료',data.completed],['all','전체 분모',data.total]],mode:mode==='all'?'all':'completed'};
  if(card==='lead')return {title:mode==='excluded'?'평균 처리 리드타임 · 완료 중 제외':mode==='open'?'평균 처리 리드타임 · 미완료 제외':'평균 처리 리드타임 · 평균 계산 포함',rows:mode==='excluded'?data.leadExcludedRows:mode==='open'?wrap(data.openRows).map(r=>({...r,reasons:['미완료 상태 · 평균 계산 대상 아님']})):data.leadIncluded,summary:`평균 ${data.lead===null?'산정 대상 없음':data.lead+'일'} · 포함 ${data.leadCount}건 · 완료 중 제외 ${data.leadExcluded}건 · 미완료 ${data.open}건은 계산 대상이 아닙니다. 실제 완료일 − 발생일의 달력 일수 평균입니다.`,tabs:[['included','평균 계산 포함',data.leadCount],['excluded','완료 중 제외',data.leadExcluded],['open','미완료 제외',data.open]],mode:['excluded','open'].includes(mode)?mode:'included'};
  if(card==='followup')return {title:'선반영 표시',rows:wrap(data.followupRows),summary:'기존 선반영 체크값이 true인 기록만 표시합니다. 등록 내용만 제공하며 반복 발생이나 효과를 추정하지 않습니다.',tabs:[]};
  throw Error('지원하지 않는 요약 카드입니다.');
}
