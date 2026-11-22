export const processFields=[['shell_request_date','SHELL 요청일'],['cond_completion_date','COND 완료일'],['eva_completion_date','EVA 완료일'],...['FU','WD','TP','EXP','MT','HYDRO'].map(s=>[s.toLowerCase(),s])];
export function validDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const stamp=new Date(value+'T00:00:00Z');return Number.isFinite(stamp.valueOf())&&stamp.toISOString().slice(0,10)===value;
}
export function filterOrders(items,query=''){
  const words=query.trim().toLocaleLowerCase('ko-KR').split(/\s+/).filter(Boolean);
  return items.filter(row=>{const text=['hull','work_order','project','equipment'].map(k=>row[k]||'').join(' ').toLocaleLowerCase('ko-KR');return words.every(word=>text.includes(word));});
}
export function summary(items){return processFields.map(([field,label])=>{const registered=items.filter(row=>validDate(row[field])).length;return {field,label,registered,total:items.length,rate:items.length?registered/items.length*100:null,invalid:items.filter(row=>row[field]!=null&&String(row[field]).trim()!==''&&!validDate(row[field])).length};});}
export function koreaTime(value){return value?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false}):'미제공';}
