// Dry-run by default. --apply inserts only IDs absent in the preview, never updates.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {planCalendarImport} from '../calendar-data.mjs';
const file=process.argv.find((arg,index)=>index>1&&!arg.startsWith('--'));
if(!file)throw new Error('Usage: node scripts/import-calendars.mjs <backup.json> [--apply]');
const backup=JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const base='https://hpmanagement-web.lotusland1995.workers.dev';
async function api(path,body){
  const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Origin:'https://hojezzang.github.io',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});
  const result=await response.json();if(!response.ok||result.ok!==true)throw new Error('API '+response.status+': '+(result.error||'request failed'));return result;
}
const before={as:(await api('/api/as-events')).events,team:(await api('/api/team-events')).events};
const plan=planCalendarImport(backup,before);
console.log(JSON.stringify({dryRun:true,report:plan.report},null,2));
if(process.argv.includes('--apply')){
  const payload={app:'AS출장_팀캘린더',version:1,asEvents:[],teamEvents:[]};
  for(const type of ['as','team'])payload[type+'Events']=backup[type+'Events'].filter(event=>plan.report[type].newIds.includes(event.id));
  const preview=await api('/api/calendars/import?mode=preview',payload);
  console.log(JSON.stringify({serverPreview:preview.report}));
  const result=await api('/api/calendars/import?mode=apply',payload);
  console.log(JSON.stringify({applied:result.report},null,2));
  const after={as:(await api('/api/as-events')).events,team:(await api('/api/team-events')).events};
  for(const type of ['as','team']){
    const rows=new Map(after[type].map(row=>[row.id,row]));
    for(const event of before[type])assert.deepEqual(rows.get(event.id),event,'Existing record changed: '+event.id);
  }
  const repeated=await api('/api/calendars/import?mode=preview',backup);
  assert.equal(repeated.report.as.newIds.length+repeated.report.team.newIds.length,0,'All approved new IDs must exist after import');
  console.log(JSON.stringify({verifiedCounts:{as:after.as.length,team:after.team.length},repeatPreview:repeated.report,preservedExisting:true}));
}
