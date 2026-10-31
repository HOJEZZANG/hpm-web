// Browser presentation only: keep each part's verified process rules unchanged.
import {productionView,ahuView} from '../production-view.mjs';
import {productionEquipment} from '../domain.mjs';
export function productionDisplay(view,part,equipment){
  const rows=view.records,shown=part==='part2'?ahuView(rows,{}, {},view.today):productionView(rows,{},equipment,{},view.today);
  const quantity=values=>values.reduce((sum,r)=>sum+(Number.isFinite(Number(r['수량']))?Number(r['수량']):0),0);
  const groups=shown.groups.map(g=>{
    const records=rows.filter(r=>productionEquipment(r,part==='part2'?'LINE 5000':equipment)===g.name),steps=new Map();
    for(const r of records){const name=String(r['현공정']??'');steps.set(name,(steps.get(name)||0)+1);}
    return {...g,quantity:quantity(records),steps:[...steps].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'ko'))};
  }).sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name,'ko'));
  return {summary:{...shown.summary,quantity:quantity(rows)},groups};
}
