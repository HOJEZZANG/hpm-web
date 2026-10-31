import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import worker from '../worker.js';
import {makeEnv,TOKEN} from './support/env.mjs';
import {weeklyRange,weekLabel,pndDate,weeklyDate,combinedPlan,weeklyAnchorSql,weeklyAnchor} from '../business/weekly-data.mjs';
import {isoWeek,koreanToday} from '../business/domain.mjs';
const record={date:'2026-10-31',part:'2 PART',project:'합성 프로젝트',product:'합성 제품',manager:'합성 담당',problem:'현황',planAction:'통합 조치',remark:'',pnd:''};
async function req(env,path,method='GET',body,token=TOKEN){const r=await worker.fetch(new Request('https://hpmanagement-web.lotusland1995.workers.dev/api/business/'+path,{method,headers:{Origin:'https://hojezzang.github.io',...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env);return {status:r.status,...await r.json()};}
function seed(env,id,data,day=data.date||''){env.sqlite.prepare('INSERT INTO weekly_issues(id,owner,data,day,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,'owner',JSON.stringify(data),day,'2026-10-01','2026-10-01');}
const stored=(env,id)=>JSON.parse(env.sqlite.prepare('SELECT data FROM weekly_issues WHERE id=?').get(id).data);

test('weekly date-only Sunday/Saturday, month/year boundaries and Korea rollover',()=>{
  for(const [day,start,end,label]of [
    ['2026-10-25','2026-10-25','2026-10-31','2026.10.25 ~ 10.31'],['2026-10-31','2026-10-25','2026-10-31','2026.10.25 ~ 10.31'],
    ['2026-11-01','2026-11-01','2026-11-07','2026.11.01 ~ 11.07'],['2026-10-01','2026-09-27','2026-10-03','2026.09.27 ~ 10.03'],
    ['2027-01-01','2026-12-27','2027-01-02','2026.12.27 ~ 2027.01.02'],['2027-01-03','2027-01-03','2027-01-09','2027.01.03 ~ 01.09'],
    ['2024-02-29','2024-02-25','2024-03-02','2024.02.25 ~ 03.02']]){
    const r=weeklyRange(day);assert.equal(r.weekStart,start);assert.equal(r.weekEnd,end);assert.equal(weekLabel(r),label);
  }
  assert.equal(koreanToday(new Date('2026-10-31T14:59:59Z')),'2026-10-31');assert.equal(koreanToday(new Date('2026-10-31T15:00:00Z')),'2026-11-01');
  for(const zone of ['UTC','Asia/Seoul','America/Los_Angeles','Pacific/Kiritimati']){const old=process.env.TZ;try{process.env.TZ=zone;assert.equal(weeklyRange('2027-01-01').weekStart,'2026-12-27');assert.equal(pndDate('2026-10-31'),'2026-10-31');}finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}}
  assert.throws(()=>weeklyRange('2026-02-30'));assert.equal(isoWeek('2026-11-01').monday,'2026-10-26');
});
test('PND accepts only complete unambiguous calendar dates',()=>{
  for(const v of ['2026-10-31','2026.10.31','2026/10/31',' 2026.10.31. ','2026년 10월 31일'])assert.equal(pndDate(v),'2026-10-31');
  for(const v of ['10/31/2026','31/10/2026','10월 말','2026-02-30','2026/10-31','2026-10-31T23:00:00Z','26-10-31','20261031','',null])assert.equal(pndDate(v),'');
  assert.equal(weeklyDate('2026-2-1'),'');
});
test('new CRUD, optional project/PND/remarks, canonical date and stable combined text',async()=>{
  const env=makeEnv();let result=await req(env,'weekly/new','PUT',{...record,pnd:'2026-11-01'});assert.equal(result.status,200);assert.equal(result.record.pnd,'2026-11-01');assert.equal(result.record.weekStart,'2026-10-25');assert.equal(stored(env,'new').key,undefined);
  for(let i=1;i<=3;i++){result=await req(env,'weekly/new','PUT',{revision:i,planAction:result.record.planAction,project:'프로젝트 수정'});assert.equal(result.status,200);assert.equal(result.record.planAction,'통합 조치');}
  const rows=await req(env,'weekly?week=2026-10-25');assert.equal(rows.records[0].project,'프로젝트 수정');assert.equal(rows.records[0].pnd,'2026-11-01');
  assert.equal((await req(env,'weekly/optional','PUT',{...record,project:'',pnd:'',remark:''})).status,200);
  assert.equal((await req(env,'weekly/bad','PUT',{...record,pnd:'내일'})).status,400);
  assert.equal((await req(env,'weekly/bad','PUT',{...record,pnd:'2026-02-30'})).status,400);
});
test('legacy free text/whitespace, plan/action, ISO metadata and unknown properties survive edits',async()=>{
  const env=makeEnv(),old={...record,project:undefined,planAction:undefined,pnd:'  다음 주 협의  ',problem:' 현황 원문\n ',remark:' 비고 원문 ',plan:' 계획 원문 ',action:' 실행 원문 ',...isoWeek(record.date),extra:{keep:1}};
  delete old.project;delete old.planAction;seed(env,'old',old);
  let rows=await req(env,'weekly?week=2026-10-31');assert.equal(rows.records[0].pndDate,'');assert.equal(rows.records[0].planAction,'계획:  계획 원문 \n실행:  실행 원문 ');
  for(let revision=1;revision<=3;revision++){
    const r=await req(env,'weekly/old','PUT',{revision,project:'추가 프로젝트'});assert.equal(r.status,200);
    for(const key of ['pnd','problem','remark','plan','action','key','monday','year','week','extra'])assert.deepEqual(stored(env,'old')[key],old[key]);
    assert.equal(r.record.planAction,combinedPlan(old));
  }
  const canonical=await req(env,'weekly/old','PUT',{revision:4,pnd:'2026-11-02',planAction:'계획: 원문 유지\n실행: 변경'});assert.equal(canonical.record.legacyPnd,old.pnd);assert.equal(canonical.record.pnd,'2026-11-02');assert.equal(stored(env,'old').plan,old.plan);assert.equal(stored(env,'old').action,old.action);
  assert.equal((await req(env,'weekly/old','PUT',{revision:5,plan:''})).status,409);assert.equal(stored(env,'old').plan,old.plan);
  assert.equal((await req(env,'weekly/old','PUT',{revision:5,pnd:'',planAction:''})).status,200);assert.equal(stored(env,'old').legacyPnd,old.pnd);assert.equal(stored(env,'old').planAction,'');assert.equal(stored(env,'old').action,old.action);
});
test('clear legacy dates are shown as dates but unrelated edits preserve their original text',async()=>{
  const env=makeEnv();seed(env,'dated',{...record,pnd:' 2026.11.02. '});const r=await req(env,'weekly/dated','PUT',{revision:1,remark:'수정'});assert.equal(r.record.pndDate,'2026-11-02');assert.equal(stored(env,'dated').pnd,' 2026.11.02. ');
});
test('incomplete historical fields do not become new mandatory input; SQL dates can recover invalid JSON dates',async()=>{
  const env=makeEnv();seed(env,'sparse',{key:'2026-W44',problem:'',pnd:'원문만 남음'},'2026-W44');
  const a=await req(env,'weekly/sparse','PUT',{revision:1,remark:'비고만 수정'});assert.equal(a.status,200);assert.equal(a.record.unresolvedWeek,true);assert.equal(stored(env,'sparse').problem,'');assert.equal(stored(env,'sparse').part,undefined);assert.equal(stored(env,'sparse').pnd,'원문만 남음');
  seed(env,'recover',{...record,date:'2026-02-30'},'2026-10-31');
  const b=await req(env,'weekly/recover','PUT',{revision:1,project:'프로젝트만 수정'});assert.equal(b.status,200);assert.equal(b.record.referenceDate,'2026-10-31');assert.equal(b.record.legacyDate,'2026-02-30');assert.equal(b.record.weekStart,'2026-10-25');
});
test('old ISO records split by actual reference date; missing dates stay separate without invented dates',async()=>{
  const env=makeEnv(),days=['2026-10-24','2026-10-25','2026-10-26','2026-10-31','2026-11-01','2026-11-02','2026-12-26','2026-12-27','2027-01-01','2027-01-02','2027-01-03','2027-01-04'];
  for(const day of days)seed(env,day,{...record,date:day,...isoWeek(day)});
  seed(env,'sql-only',{...record,date:undefined,key:'2026-W44'},'2026-11-01');
  seed(env,'json-only',{...record,date:'2026-10-31',...isoWeek('2026-10-31')},'');
  seed(env,'conflict',{...record,date:'2026-10-24'},'2026-10-25');
  const unknown={...record,date:undefined,key:'2026-W44',monday:'2026-10-26'};seed(env,'unknown',unknown,'2026-W44');
  seed(env,'invalid',{...unknown,date:'2026-02-30'},'2026-02-30');
  for(const [day,ids]of [['2026-10-25',['2026-10-25','2026-10-26','2026-10-31','json-only']],['2026-10-31',['2026-10-25','2026-10-26','2026-10-31','json-only']],['2026-11-01',['2026-11-01','2026-11-02','sql-only']],['2027-01-01',['2026-12-27','2027-01-01','2027-01-02']],['2027-01-03',['2027-01-03','2027-01-04']]]){
    const r=await req(env,'weekly?week='+day);assert.equal(r.status,200);assert.deepEqual(r.records.map(x=>x.id).sort(),ids.sort());assert.deepEqual(r.legacyRecords.map(x=>x.id).sort(),['invalid','unknown']);
  }
  const edited=await req(env,'weekly/unknown','PUT',{revision:1,remark:'기준일 지정 없이 비고 수정'});assert.equal(edited.status,200);assert.equal(edited.record.unresolvedWeek,true);assert.equal(stored(env,'unknown').date,undefined);assert.equal(stored(env,'unknown').key,'2026-W44');assert.equal(stored(env,'unknown').monday,'2026-10-26');
  for(const row of env.sqlite.prepare(`SELECT *,(${weeklyAnchorSql}) AS anchor FROM weekly_issues`).all())assert.equal(row.anchor||'',weeklyAnchor({...JSON.parse(row.data),day:row.day}));
});
test('project search returns actual date and original product, with authentication/ownership/revision intact',async()=>{
  const env=makeEnv();env.sqlite.exec(readFileSync(new URL('../migrations/0003_shared_calendars.sql',import.meta.url),'utf8'));assert.equal((await req(env,'weekly/one','PUT',record)).status,200);const r=await req(env,'search?q='+encodeURIComponent('합성 프로젝트'));assert.equal(r.status,200);assert.equal(r.records[0].label,'합성 프로젝트 / 합성 제품');assert.equal(r.records[0].date,'2026-10-31');
  assert.equal((await req(env,'weekly','GET',undefined,null)).status,401);assert.equal((await req(env,'weekly/one','PUT',{revision:0,project:'충돌'})).status,409);
  const token='b'.repeat(64);env.sqlite.prepare('INSERT INTO portal_accounts(id,name,salt,password_hash,role,status,created_at) VALUES(?,?,?,?,?,?,?)').run('other','합성 사용자','unused','unused','user','active','2026-10-31');env.sqlite.prepare('INSERT INTO portal_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),'other','2099-01-01');
  assert.equal((await req(env,'weekly/one','PUT',{revision:1,project:'타인'},token)).status,403);assert.equal((await req(env,'weekly/one','DELETE',{revision:1},token)).status,403);
});
