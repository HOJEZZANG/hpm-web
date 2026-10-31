// Real local workerd/D1, synthetic data and credentials only.
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'.wrangler/build/worker.js',compatibilityDate:'2026-09-15',d1Databases:['DB'],r2Buckets:['PHOTOS'],bindings:{PORTAL_BOOTSTRAP_SECRET:'synthetic-weekly-bootstrap-key-2026'}}));
try{
  const db=await mf.getD1Database('DB');
  for(const file of ['0001_cloudflare_schema.sql','0003_shared_calendars.sql','0004_part1_business.sql','0005_server_identity.sql','0006_employee_access.sql','0007_password_policy.sql']){
    const sql=readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8').replace(/--.*$/gm,'').trim();
    for(const s of sql.split(/;\s*(?=(?:CREATE|ALTER)\b)/i).map(s=>s.trim().replace(/;$/,'')).filter(Boolean))await db.prepare(s).run();
  }
  let token;
  async function req(path,method='GET',body,status=200){const r=await mf.dispatchFetch('http://local.test/api/'+path,{method,headers:{Origin:'https://hojezzang.github.io',...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.equal(r.status,status,await r.clone().text());return r.json();}
  const account={id:'weekly-admin',name:'합成 관리자',password:'synthetic-weekly-password',bootstrapSecret:'synthetic-weekly-bootstrap-key-2026'};
  await req('auth/bootstrap','POST',account);token=(await req('auth/login','POST',account)).token;
  const base={part:'2 PART',product:'합성 제품',manager:'합성 담당',problem:'현황 원문',remark:'비고 원문',plan:'기존 계획',action:'기존 실행',pnd:'  협의 중  ',key:'2026-W44',monday:'2026-10-26'};
  for(const [id,date,day]of [['sat','2026-10-31','2026-10-31'],['sun','2026-11-01','2026-11-01'],['unknown',undefined,'2026-W44'],['invalid','2026-02-30','2026-02-30'],['day-only',undefined,'2026-11-01']])await db.prepare('INSERT INTO weekly_issues(id,owner,data,day,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(id,account.id,JSON.stringify({...base,...(date?{date}:{})}),day,'2026-10-01','2026-10-01').run();
  const sat=await req('business/weekly?week=2026-10-31'),sun=await req('business/weekly?week=2026-11-01');
  assert.deepEqual(sat.records.map(r=>r.id),['sat']);assert.deepEqual(sun.records.map(r=>r.id).sort(),['day-only','sun']);assert.deepEqual(sat.legacyRecords.map(r=>r.id).sort(),['invalid','unknown']);
  let r=await req('business/weekly/sat','PUT',{revision:1,project:'검색 표본 프로젝트'});assert.equal(r.record.pnd,base.pnd);assert.equal(r.record.plan,base.plan);assert.equal(r.record.action,base.action);assert.equal(r.record.planAction,'계획: 기존 계획\n실행: 기존 실행');
  r=await req('business/weekly/sat','PUT',{revision:2,remark:'비고 수정',planAction:r.record.planAction});assert.equal(r.record.pnd,base.pnd);assert.equal(r.record.planAction,'계획: 기존 계획\n실행: 기존 실행');
  r=await req('business/weekly/sat','PUT',{revision:3,pnd:'2026-11-03'});assert.equal(r.record.legacyPnd,base.pnd);assert.equal(r.record.pnd,'2026-11-03');
  r=await req('business/weekly/unknown','PUT',{revision:1,remark:'기준일 없이 수정'});assert.equal(r.record.unresolvedWeek,true);assert.equal(r.record.date,undefined);assert.equal(r.record.legacyDay,'2026-W44');assert.equal(r.record.key,base.key);
  await db.prepare('INSERT INTO weekly_issues(id,owner,data,day,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind('different-raw',account.id,JSON.stringify({...base,date:'기존 날짜 원문'}),'기존 SQL 주간 원문','2026-10-01','2026-10-01').run();
  r=await req('business/weekly/different-raw','PUT',{revision:1,remark:'다른 항목 수정'});assert.equal(r.record.date,'기존 날짜 원문');assert.equal(r.record.legacyDay,'기존 SQL 주간 원문');assert.equal((await db.prepare('SELECT day FROM weekly_issues WHERE id=?').bind('different-raw').first()).day,'기존 SQL 주간 원문');
  r=await req('business/weekly/different-raw','PUT',{revision:2,date:'2026-10-31'});assert.equal(r.record.legacyDate,'기존 날짜 원문');assert.equal(r.record.legacySqlDay,'기존 SQL 주간 원문');
  r=await req('business/weekly/new','PUT',{date:'2027-01-01',part:'1 PART',product:'합성 신규',manager:'담당',problem:'현황',planAction:'자유 입력',project:'',pnd:'2027-01-02'});assert.equal(r.record.weekStart,'2026-12-27');assert.equal(r.record.weekEnd,'2027-01-02');assert.equal(r.record.pnd,'2027-01-02');assert.equal(r.record.key,undefined);
  assert.equal((await req('business/weekly?week=2027-01-02')).records.length,1);assert.equal((await req('business/weekly?week=2027-01-03')).records.length,0);
  assert.equal((await req('business/search?q='+encodeURIComponent('검색 표본 프로젝트'))).records[0].date,'2026-10-31');
  await req('business/weekly/sat','PUT',{revision:1,remark:'동시 변경'},409);token=null;await req('business/weekly?week=2026-10-31','GET',undefined,401);
  console.log('PASS real local workerd/D1 weekly: Sunday split/ISO dates, SQL date validation, separate unresolved records, project search, raw PND/legacy fields, stable combined text, canonical PND, year boundary, optional fields, revisions and authentication. No remote writes or migrations.');
}finally{await mf.dispose();}
