// Shared validation and import planning. No network, storage or generated IDs.
export const calendarFields = {
  as: 'id startDate endDate yard hullNo asType asDetail workerInfo carInfo memo createdById createdByName createdAt updatedAt'.split(' '),
  team: 'id startDate endDate startTime endTime teamType title members location detail createdById createdByName createdAt updatedAt'.split(' '),
};
const metadata = ['createdById','createdByName','createdAt','updatedAt'];
export function validCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value+'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===value;
}
export function normalizeCalendar(type, body, id=body?.id) {
  if (!calendarFields[type] || !body || typeof body!=='object' || Array.isArray(body) ||
      typeof id!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id) || (body.id!==undefined && body.id!==id)) throw new Error('일정 ID 또는 데이터 형식이 올바르지 않습니다.');
  const input={...body,startDate:body.startDate||body.date||'',endDate:body.endDate||body.startDate||body.date||''};
  if(type==='as') input.asDetail=body.asDetail||body.workDetail||'';
  const event={};
  for(const name of calendarFields[type]) {
    const value=input[name]??'';
    if(typeof value!=='string'||value.length>20000) throw new Error('일정의 '+name+' 값을 확인하세요.');
    event[name]=value;
  }
  event.id=id;
  if(!validCalendarDate(event.startDate)||!validCalendarDate(event.endDate)||event.endDate<event.startDate) throw new Error('시작일과 종료일을 올바르게 입력하세요.');
  const required=type==='as'?['yard','asType','carInfo']:['teamType','title'];
  if(required.some(name=>!event[name].trim())) throw new Error('일정 필수 항목을 입력하세요.');
  if(type==='team') {
    for(const name of ['startTime','endTime']) if(event[name]&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(event[name])) throw new Error('시간 형식이 올바르지 않습니다.');
    if(!!event.startTime!==!!event.endTime||(event.startDate===event.endDate&&event.startTime&&event.endTime<=event.startTime)) throw new Error('종료시간은 시작시간보다 늦어야 합니다.');
  }
  for(const name of ['createdAt','updatedAt']) if(event[name]) {
    if(!Number.isFinite(Date.parse(event[name]))) throw new Error('일정 시각이 올바르지 않습니다.');
    event[name]=new Date(event[name]).toISOString();
  }
  return event;
}
export function calendarDifferences(type, source, current) {
  return calendarFields[type].filter(name=>name!=='id' && (!metadata.includes(name)||source[name]) && source[name]!==current[name]);
}
export function planCalendarImport(backup, current) {
  if(!backup||typeof backup!=='object'||Array.isArray(backup)||
    (backup.app!==undefined&&backup.app!=='AS출장_팀캘린더')||(backup.version!==undefined&&backup.version!==1)||
    !Array.isArray(backup.asEvents)||!Array.isArray(backup.teamEvents)) throw new Error('AS출장·팀 일정 백업 JSON 형식을 확인하세요.');
  if(backup.asEvents.length+backup.teamEvents.length>500) throw new Error('한 번에 최대 500개의 일정을 가져올 수 있습니다.');
  const report={},candidates=[];
  for(const type of ['as','team']) {
    const input=backup[type+'Events'];
    const rows=input.map((row,index)=>{
      try{return normalizeCalendar(type,row);}catch(error){throw new Error(type+' '+(index+1)+'번째 항목: '+error.message);}
    });
    const existing=new Map(current[type].map(row=>[row.id,normalizeCalendar(type,row)]));
    const unique=new Map(),ambiguous=new Set();let fileDuplicates=0;
    for(const row of rows) {
      const previous=unique.get(row.id);
      if(previous) {
        if(calendarDifferences(type,row,previous).length||calendarDifferences(type,previous,row).length) ambiguous.add(row.id);
        else fileDuplicates++;
      } else unique.set(row.id,row);
    }
    const entry=report[type]={input:input.length,current:current[type].length,newIds:[],duplicateIds:[],conflicts:[],fileDuplicates};
    for(const row of unique.values()) {
      if(ambiguous.has(row.id)){entry.conflicts.push({id:row.id,reason:'file',fields:[]});continue;}
      const old=existing.get(row.id);
      if(!old){entry.newIds.push(row.id);candidates.push({type,event:row});continue;}
      const fields=calendarDifferences(type,row,old);
      if(fields.length)entry.conflicts.push({id:row.id,reason:'existing',fields});else entry.duplicateIds.push(row.id);
    }
  }
  return {report,candidates};
}
export function calendarBackup(current, exportedAt=new Date().toISOString()) {
  return {app:'AS출장_팀캘린더',version:1,exportedAt,asEvents:current.as,teamEvents:current.team};
}
