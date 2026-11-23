import {calendarDate} from './ahu-pnd.mjs';
// Only a date explicitly labelled by the source is a basis date. Never use a filename or upload time.
export function productionSourceDate(rows,date1904=false){
 const dates=new Set();
 for(const row of rows.filter(r=>r.number<=10))for(let i=0;i<row.values.length;i++){
  const raw=String(row.values[i]??'').trim(),match=/^(?:자료\s*기준일|작성\s*기준일|기준일)\s*[:：]?\s*(.*)$/.exec(raw);
  if(!match)continue;const value=match[1]||row.values[i+1],date=calendarDate(value,date1904);if(date.iso)dates.add(date.iso);
 }
 return dates.size===1?[...dates][0]:'';
}
