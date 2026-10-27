// Verified header/schema presets; never tied to a filename, PC path or company workbook contents.
export const AHU_PRESETS=Object.freeze({
  erp:{sheet:'Sheet1',header:2,columns:{yard:{position:4,title:'Yard'},hull:{position:5,title:'HullNo'},pnd:{position:8,title:'PND'},spec:{position:10,title:'품번'}},equipment:'제조사양관리구분',line:'LINE 5000'},
  plan:{sheet:'ALL',header:6,columns:{yard:{position:2,title:'YARD'},hull:{position:3,title:'호선'},pnd:{position:16,title:'PND'},spec:{position:6,title:'규격'}},number:'NO.'}
});
const headerKey=value=>String(value??'').replace(/\s+/g,'').toLowerCase();
export function applyAhuPreset(side,preview){
  const preset=AHU_PRESETS[side],reasons=[],moved=[],config={header:preset.header},header=preview.rows.find(r=>r.number===preset.header);
  if(!header)return {ready:false,reasons:[`기본 헤더 ${preset.header}행에 내용이 없습니다.`],config,selected:[]};
  function find(title){const matches=preview.columns.filter((c,i)=>headerKey(header.values[i])===headerKey(title));if(matches.length!==1){reasons.push(`${title}: ${matches.length?'중복 제목':'제목 누락'}으로 열 확인 필요`);return null;}return matches[0];}
  for(const [key,expected]of Object.entries(preset.columns)){config[key]=find(expected.title);if(config[key]&&config[key]!==expected.position)moved.push(`${expected.title}: ${expected.position} → ${config[key]}열`);}
  let equipment,line,number;
  if(side==='erp'){equipment=find(preset.equipment);line=find(preset.line);}else{
    number=find(preset.number);const title=preview.rows.filter(r=>r.number<preset.header).flatMap(r=>r.values).some(v=>/^Air\s+Handling\s+Unit\s+생산\s+Sch\.?$/i.test(String(v).trim()));
    if(!title)reasons.push('AHU 전용 생산계획 제목을 확인하지 못했습니다. 혼합 자료의 대상 행을 직접 확인하세요.');
  }
  if(reasons.length)return {ready:false,reasons,config,moved,selected:[]};
  const at=(row,column)=>row.values[preview.columns.indexOf(column)]??'',selected=preview.rows.filter(r=>r.number>preset.header).filter(r=>side==='erp'?(at(r,equipment)==='AHU'||!String(at(r,equipment)).trim()&&at(r,line)==='AHU'):/^\d+$/.test(String(at(r,number)).trim())).map(r=>r.number);
  if(side==='plan'&&preview.rows.some(r=>selected.includes(r.number)&&String(at(r,config.spec)).trim()&&!/^HKA[\s\d-]/i.test(String(at(r,config.spec)).trim())&&!/^\d{3}-[A-Z]{2}-\d{3}(?:-[A-Z])?$/.test(String(at(r,config.spec)).trim())))return {ready:false,config,moved,selected:[],reasons:['확인된 AHU 계획 규격 계열 밖의 행이 있습니다. 혼합 자료 여부와 AHU 대상을 직접 확인하세요.']};
  return {ready:true,config,moved,selected,reasons:[],rule:side==='erp'?'제조사양관리구분 = AHU, 또는 구분 공란이고 LINE 5000 = AHU':'AHU 전용 제목·헤더 확인 + NO.가 숫자인 업무 행',equipment,line,number};
}
