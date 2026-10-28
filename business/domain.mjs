// Shared pure business rules. Dates without times are Korean calendar dates.
export class BusinessError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function ensure(condition, message, status = 400) { if (!condition) throw new BusinessError(status, message); }
export function text(value, label, max = 2000, required = false) {
  ensure(typeof value === 'string' && value.length <= max, `${label}: 문자열 ${max}자 이내로 입력하세요.`);
  const result = value.trim(); ensure(!required || result.length > 0, `${label}을(를) 입력하세요.`); return result;
}
export function date(value, label = '날짜', optional = false) {
  if (optional && (value === '' || value == null)) return '';
  ensure(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1900-01-01' && value <= '9998-12-31', `${label} 형식을 확인하세요.`);
  const d = new Date(value + 'T00:00:00Z'); ensure(Number.isFinite(+d) && d.toISOString().slice(0,10) === value, `${label}이(가) 유효하지 않습니다.`); return value;
}
export const koreanToday = (now = new Date()) => new Date(+now + 9*3600000).toISOString().slice(0,10);
export const addDays = (day, n) => { date(day); return new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10); };
export function isoWeek(day = koreanToday()) {
  date(day); const d = new Date(day+'T00:00:00Z'); const weekday = d.getUTCDay() || 7;
  const monday = addDays(day, 1-weekday); d.setUTCDate(d.getUTCDate()+4-weekday);
  const year = d.getUTCFullYear(), week = Math.ceil(((+d-Date.UTC(year,0,1))/86400000+1)/7);
  return {year, week, monday, key: `${year}-W${String(week).padStart(2,'0')}`};
}
export const factories = [...Array.from({length:5},(_,i)=>`AC공장 (B${i+1})`),...Array.from({length:5},(_,i)=>`AHU공장 (C${i+1})`)];
export const safetyLabels = ['소화기 및 소화전 상태','작업자 보호구(안전모/안전화)','전기 설비 및 누전/배선 상태','작업장 정리정돈 및 청결','비상구 및 안전 통로 확보'];
export function validateRecord(type, b) {
  ensure(b && typeof b === 'object' && !Array.isArray(b), '입력 형식을 확인하세요.');
  const s = (key, label, required=false, max=2000) => text(b[key] ?? '', label, max, required);
  if(['people','vehicles'].includes(type))ensure(b.active===undefined||typeof b.active==='boolean','사용 여부는 참/거짓 값이어야 합니다.');
  if (type === 'weekly') {
    ensure(['1 PART','2 PART','3 PART'].includes(b.part), '파트를 선택하세요.');
    const day = date(b.date, '주차 기준일');
    return {date:day, ...isoWeek(day), part:b.part, product:s('product','제품',true,200), problem:s('problem','문제점',true), manager:s('manager','담당자',true,100), pnd:s('pnd','PND',false,200), plan:s('plan','계획'), action:s('action','실행'), remark:s('remark','특이사항')};
  }
  if (type === 'safety') {
    ensure(factories.includes(b.factory), '공장을 선택하세요.');
    ensure(Array.isArray(b.results) && b.results.length === 5 && b.results.every(x=>['양호','조치필요','해당없음'].includes(x)), '5개 점검 결과를 모두 선택하세요.');
    const r={factory:b.factory, inspector:s('inspector','점검자',true,100),date:date(b.date,'점검일'),results:b.results,abnormal:s('abnormal','이상내용'),action:s('action','조치내용')};
    ensure(!r.results.includes('조치필요') || r.abnormal, '조치필요 항목의 이상내용을 입력하세요.'); return r;
  }
  if (type === 'people') return {name:s('name','관리 인원 이름',true,100),department:s('department','부서',false,100),active:b.active!==false};
  if (type === 'vehicles') return {number:s('number','차량번호',true,30),description:s('description','설명',false,200),active:b.active!==false};
  if (type === 'notices') return {title:s('title','제목',true,200),content:s('content','공지내용',true,5000)};
  throw new BusinessError(404,'지원하지 않는 업무입니다.');
}
// Only explicit final completion headers are evidence; individual process/FAT dates are not.
export const isProductionCompletionTitle=value=>['실제완료일','실제완료일자','생산완료일','생산완료일자','최종완료일','최종완료일자'].includes(String(value??'').replace(/\s/g,''));
export function productionEquipment(row,column){
  const raw=String(row[column]??'').trim();return raw?(/^(AC|PROV|DECK|IGG|CHILLER)$/i.test(raw)?raw.toUpperCase():raw):'미분류';
}
export function productionSummary(rows, today = koreanToday(), options = {}) {
  let quantity=0, pndCount=0, due=0, complete=0; const delayed=[], imminent=[], equipment=Object.create(null); const pnds=[];
  const eqColumn=options.equipment||['제조사양관리구분','분류','LINE 5000'].find(k=>rows.some(r=>Object.hasOwn(r,k)));
  const reasons={missingPnd:0,invalidPnd:0,notCompleted:0,missingCompletion:0,invalidCompletion:0,ambiguousCompletion:0};
  let onTime=0,eligible=0,hasCompletion=options.completionFieldState==='present',hasAmbiguity=false;
  const valid=value=>{try{return date(value);}catch{return '';}};
  for (const row of rows) {
    quantity += Number(row['수량'] || 0); const pnd=valid(row.PND), done=String(row['현공정']||'').includes('납품준비');
    if(pnd){pndCount++;pnds.push(pnd);if(pnd<=today||done){due++;if(done)complete++;}if(!done&&pnd<today)delayed.push(row);if(!done&&pnd>=today&&pnd<=addDays(today,7))imminent.push(row);}
    const name=productionEquipment(row,eqColumn),process=row['현공정']||'미정';equipment[name] ||= Object.create(null);equipment[name][process]=(equipment[name][process]||0)+1;
    const fields=Object.keys(row).filter(isProductionCompletionTitle),ambiguous=options.completionFieldState==='ambiguous'||fields.length>1;
    hasCompletion ||= fields.length>0;hasAmbiguity ||= ambiguous;const raw=fields.length===1?row[fields[0]]:'',actual=valid(raw);
    if(!row.PND)reasons.missingPnd++;
    else if(!pnd)reasons.invalidPnd++;
    else if(ambiguous)reasons.ambiguousCompletion++;
    else if(raw!==''&&raw!=null&&!actual)reasons.invalidCompletion++;
    else if(!actual){if(done)reasons.missingCompletion++;else reasons.notCompleted++;}
    else {eligible++;if(actual<=pnd)onTime++;}
  }
  const status=!rows.length?'empty':!hasCompletion||options.completionFieldState==='ambiguous'||(!eligible&&hasAmbiguity)?'unavailable':eligible?'available':'empty';
  const adherence={status,onTime,eligible,late:eligible-onTime,excluded:rows.length-eligible,reasons,rate:eligible?onTime/eligible*100:null,reason:status==='unavailable'?(hasAmbiguity?'실제 완료일 열이 여러 개여서 판정할 수 없습니다.':'실제 완료일 근거가 없습니다. 현재 공정과 PND만으로는 산정할 수 없습니다.'):status==='empty'?'판정 가능한 완료 건이 없습니다.':''};
  pnds.sort(); return {count:rows.length,quantity,pndCount,due,complete,rate:due?complete/due*100:0,adherence,delayed,imminent,equipment,pndStart:pnds[0]||'',pndEnd:pnds.at(-1)||''};
}
export const productionColumns=['PND','제조사양관리구분','프로젝트상태','초기호선','Yard','HullNo','분류','LINE 5000','현공정','작업장','수량','구동방식','FAT','Work Order','작업지시일','ALIGN.완료일자','생산도접수일','SHELL PIPE 절단요청일','COND PIPE 절단완료일','실제완료일'];
export const supplyColumns=['품목코드','품목명','규격','단위','단가','모델번호'];
export const dateColumns=['작업지시일','PND','FAT','ALIGN.완료일자','생산도접수일','SHELL PIPE 절단요청일','COND PIPE 절단완료일'];
