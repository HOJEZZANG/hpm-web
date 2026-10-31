// Weekly issues only: date-only values never pass through the browser timezone.
export function weeklyDate(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'1900-01-01'||value>'9998-12-31')return '';
  const d=new Date(value+'T00:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===value?value:'';
}
export function pndDate(value) {
  if(typeof value!=='string')return '';
  const raw=value.trim(),m=raw.match(/^(\d{4})([-./])(\d{1,2})\2(\d{1,2})\.?$/),k=raw.match(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/);
  const parts=m?[m[1],m[3],m[4]]:k?k.slice(1):null;
  return parts?weeklyDate(`${parts[0]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`):'';
}
export function weeklyRange(day) {
  if(!weeklyDate(day))throw new RangeError('기준일을 확인하세요.');
  const d=new Date(day+'T00:00:00Z'),start=new Date(+d-d.getUTCDay()*86400000).toISOString().slice(0,10),end=new Date(Date.parse(start+'T00:00:00Z')+6*86400000).toISOString().slice(0,10);
  return {weekStart:start,weekEnd:end,weekBasis:'seoul-sunday-v1'};
}
export function meetingDate(day) {
  if(!weeklyDate(day))throw new RangeError('회의일을 확인하세요.');
  const d=new Date(day+'T00:00:00Z');return new Date(+d+((3-d.getUTCDay()+7)%7)*86400000).toISOString().slice(0,10);
}
export function meetingRange(day) {
  const end=meetingDate(day),start=new Date(Date.parse(end+'T00:00:00Z')-6*86400000).toISOString().slice(0,10);
  return {meetingDate:end,weekStart:start,weekEnd:end,weekBasis:'seoul-wednesday-v1'};
}
export function weekLabel(range) {
  if(!range?.weekStart||!range?.weekEnd)return '기준일 확인 필요';
  const {weekStart:start,weekEnd:end}=range;
  return start.replaceAll('-','.')+' ~ '+(start.slice(0,4)===end.slice(0,4)?end.slice(5):end).replaceAll('-','.');
}
export const combinedPlan=record=>Object.hasOwn(record,'planAction')?record.planAction:[record.plan?`계획: ${record.plan}`:'',record.action?`실행: ${record.action}`:''].filter(Boolean).join('\n');
export const weeklyAnchor=row=>weeklyDate(row.date)||weeklyDate(row.day);
export function weeklyView(record,day='') {
  const anchor=weeklyAnchor({...record,day});
  return {...record,referenceDate:anchor,...(anchor?meetingRange(anchor):{meetingDate:'',weekStart:'',weekEnd:'',weekBasis:''}),planAction:combinedPlan(record),pndDate:pndDate(record.pnd),unresolvedWeek:!anchor,legacyDay:anchor?'':day};
}
// Both data.date and day were written from the actual reference date by the old
// server. ISO key/monday/created_at are never used to invent a missing date.
const sqlDate=value=>`(typeof(${value})='text' AND ${value} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND ${value}>='1900-01-01' AND ${value}<='9998-12-31' AND date(${value},'+0 days')=${value})`;
export const weeklyAnchorSql=`CASE WHEN ${sqlDate("json_extract(data,'$.date')")} THEN json_extract(data,'$.date') WHEN ${sqlDate('day')} THEN day ELSE NULL END`;
