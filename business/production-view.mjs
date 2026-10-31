import {koreanToday,addDays,productionEquipment} from './domain.mjs';
import {weeklyDate} from './weekly-data.mjs';
export const processStateLabels={active:'진행 중',ready:'납품준비·완료',unknown:'공정 미분류'};
const activeCodes=new Set(['AC1','AC2','PC1','PC2','DK2','DBP','PPT','PEL','PA1','AEL','AA1','APT']);
const activeNames=new Set(['대기','자재대기','생산대기','가공','취부','용접','조립','결선','페인트','도장','검사','시운전','FAT','HYDTEST']);
const productionPnd=row=>weeklyDate(String(row.PND??'').trim());
// Preserve original names/codes. Unknown values are never evidence of completion.
export function productionProcessState(value){
  const p=String(value??'').normalize('NFKC').replace(/\s/g,'').toUpperCase();
  if(/^(?:납품준비(?:완료)?(?:\[APR\])?|APR)$/.test(p))return 'ready';
  const code=p.match(/\[([A-Z0-9]+)\]$/)?.[1];
  return !p.includes('납품준비')&&(activeCodes.has(code)||activeNames.has(p))?'active':'unknown';
}
export function productionCounts(rows,today=koreanToday()){
  const s={total:rows.length,active:0,ready:0,unknown:0,overdue:0,upcoming:0,missingPnd:0,invalidPnd:0},last=addDays(today,7);
  for(const r of rows){const state=productionProcessState(r['현공정']),raw=String(r.PND??'').trim(),day=weeklyDate(raw);s[state]++;
    if(!raw)s.missingPnd++;else if(!day)s.invalidPnd++;
    if(state==='active'&&day){if(day<today)s.overdue++;if(day>=today&&day<=last)s.upcoming++;}
  }
  return s;
}
export function productionView(rows,filters={},equipment='',selection={},today=koreanToday()){
  const q=String(filters.q||'').trim().toLowerCase();
  const base=rows.filter(r=>{const day=productionPnd(r);return (!q||Object.entries(r).some(([k,v])=>!k.startsWith('__')&&String(v).toLowerCase().includes(q)))&&(!filters.equipment||productionEquipment(r,equipment)===filters.equipment)&&['Yard','현공정','작업장'].every(k=>!filters[k]||r[k]===filters[k])&&(!filters.from||day&&day>=filters.from)&&(!filters.to||day&&day<=filters.to);});
  const devices=new Map();for(const r of base){const name=productionEquipment(r,equipment);if(!devices.has(name))devices.set(name,[]);devices.get(name).push(r);}
  const groups=[...devices].map(([name,values])=>{const steps=new Map();for(const r of values){const p=String(r['현공정']??'');steps.set(p,(steps.get(p)||0)+1);}return {name,...productionCounts(values,today),steps:[...steps].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'ko'))};}).sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name,'ko'));
  const selected={equipment:selection.equipment||'',process:selection.process??null,status:selection.status||'all',risk:selection.risk||'all'};
  if(!devices.has(selected.equipment)){selected.equipment='';selected.process=null;}
  if(selected.process!==null&&!devices.get(selected.equipment)?.some(r=>String(r['현공정']??'')===selected.process))selected.process=null;
  const context=base.filter(r=>(!selected.equipment||productionEquipment(r,equipment)===selected.equipment)&&(selected.process===null||String(r['현공정']??'')===selected.process));
  const last=addDays(today,7),records=context.filter(r=>{const state=productionProcessState(r['현공정']),day=productionPnd(r);return (selected.status==='all'||state===selected.status)&&(selected.risk==='all'||state==='active'&&day&&(selected.risk==='overdue'?day<today:day>=today&&day<=last));});
  return {records,summary:productionCounts(context,today),groups,selection:selected,baseCount:base.length,today};
}
