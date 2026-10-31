import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import ExcelJS from 'exceljs/dist/exceljs.min.js';
import worker from '../worker.js';
import {makeEnv,TOKEN} from './support/env.mjs';
import {isoWeek,koreanToday,productionSummary,validateRecord} from '../business/domain.mjs';
import {parseWorkbook,template,createWorkbook,MAX_ROWS} from '../business/excel.mjs';
const base='https://hpmanagement-web.lotusland1995.workers.dev',origin='https://hojezzang.github.io';
async function req(env,path,method='GET',body,token=TOKEN){
  return worker.fetch(new Request(base+(path.startsWith('/api/')?path:'/api/business/'+path),{method,headers:{Origin:origin,...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
}
async function data(r,status=200){assert.equal(r.status,status,await r.clone().text());return r.json();}
function viewer(env){
  const token='b'.repeat(64);env.sqlite.prepare('INSERT INTO portal_accounts(id,name,salt,password_hash,role,status,created_at) VALUES(?,?,?,?,?,?,?)').run('viewer','합성 사용자','unused','unused','user','active',new Date().toISOString());
  env.sqlite.prepare('INSERT INTO portal_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),'viewer','2099-01-01T00:00:00Z');return token;
}
const weekly={date:'2027-01-01',part:'1 PART',product:'합성 제품',manager:'합성 담당',problem:'합성 문제',pnd:'2027-01-02',plan:'계획',action:'실행',remark:'비고'};
async function preview(env,kind='production',bytes){
  const form=new FormData();form.set('kind',kind);form.set('file',new File([bytes||await template(kind)],'합성자료.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  return worker.fetch(new Request(base+'/api/business/imports',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+TOKEN},body:form}),env);
}
test('Korean ISO week handles UTC rollover, ISO years and week 53',()=>{
  assert.equal(koreanToday(new Date('2026-12-31T15:00:00Z')),'2027-01-01');
  for(const [day,key,monday]of [['2021-01-01','2020-W53','2020-12-28'],['2024-12-30','2025-W01','2024-12-30'],['2027-01-01','2026-W53','2026-12-28'],['2027-01-04','2027-W01','2027-01-04']]){
    assert.equal(isoWeek(day).key,key);assert.equal(isoWeek(day).monday,monday);
  }
  assert.throws(()=>isoWeek('2026-02-30'));assert.throws(()=>validateRecord('weekly',{...weekly,date:'bad'}));
});
test('production rules preserve source completion, 7-day inclusivity and denominator',()=>{
  const rows=[{PND:'2026-10-14','현공정':'조립','수량':2,'제조사양관리구분':'AC'},{PND:'2026-10-15','현공정':'조립','수량':1,'제조사양관리구분':'CHILLER'}, {PND:'2026-10-22','현공정':'조립','수량':3},{PND:'2026-10-23','현공정':'대기','수량':1},{PND:'2026-12-01','현공정':'납품준비 완료','수량':1},{PND:'','현공정':'납품준비','수량':2}];
  const s=productionSummary(rows,'2026-10-15');assert.equal(s.delayed.length,1);assert.equal(s.imminent.length,2);assert.equal(s.due,3);assert.equal(s.complete,1);assert.equal(s.quantity,10);assert.equal(s.equipment.AC['조립'],1);
});
test('all new data and file APIs reject browser-only identity; server roles override body',async()=>{
  const env=makeEnv(),token=viewer(env);
  for(const path of ['weekly','safety','people','vehicles','bookings','meals','menus','menus/missing','imports?kind=production','imports/missing/file','production','supplies','orders','search?q=합성'])assert.equal((await req(env,path,'GET',undefined,null)).status,401);
  assert.equal((await req(env,'/api/issues','GET',undefined,null)).status,401);
  assert.equal((await req(env,'/api/photos/issues/x/before/x.png','GET',undefined,null)).status,401);
  assert.equal((await req(env,'vehicles/car','PUT',{number:'합성차량',role:'admin'},token)).status,403);
  assert.equal((await req(env,'notices/n','PUT',{title:'위조',content:'내용',role:'admin'},token)).status,403);
  assert.equal((await req(env,'/api/auth/users','GET',undefined,token)).status,403);
  env.sqlite.prepare("UPDATE portal_accounts SET status='disabled' WHERE id='viewer'").run();const disabled=await req(env,'weekly','GET',undefined,token);assert.equal(disabled.status,403);assert.equal((await disabled.json()).code,'ACCOUNT_DISABLED');
});
test('weekly CRUD, scoped delete, SQL injection as text, stale writes and cross-session visibility',async()=>{
  const env=makeEnv(),other=viewer(env);assert.equal((await data(await req(env,'weekly'))).records.length,0);
  let r=await data(await req(env,'weekly/w','PUT',{...weekly,product:"'); DELETE FROM issues; --"}));assert.equal(r.record.weekStart,'2026-12-27');assert.equal(r.record.owner,'owner');
  assert.equal((await data(await req(env,'weekly?week=2026-12-28','GET',undefined,other))).records.length,1);
  assert.equal((await req(env,'weekly/w','PUT',{...weekly,revision:0})).status,409);
  assert.equal((await req(env,'weekly/w','DELETE',{revision:1},other)).status,403);
  r=await data(await req(env,'weekly/w','PUT',{...weekly,revision:1,remark:'수정'}));assert.equal(r.record.revision,2);
  assert.equal((await req(env,'weekly/w','DELETE',{revision:1})).status,409);
  assert.equal((await data(await req(env,'weekly/w','DELETE',{revision:2}))).deleted,true);
  assert.equal((await data(await req(env,'weekly?week=2027-01-04'))).records.length,0);
});
test('safety persists real results; input validation and D1 failure never report success',async()=>{
  const env=makeEnv(),b={factory:'AC공장 (B1)',inspector:'합성 점검자',date:'2026-10-15',results:['양호','조치필요','양호','해당없음','양호'],abnormal:'합성 이상',action:'합성 조치'};
  assert.equal((await req(env,'safety/check','PUT',{...b,abnormal:''})).status,400);
  await data(await req(env,'safety/check','PUT',b));let records=(await data(await req(env,'safety?week=2026-10-15'))).records;assert.deepEqual(records[0].results,b.results);
  await data(await req(env,'safety/check','PUT',{...b,revision:1,action:'조치 완료'}));records=(await data(await req(env,'safety?week=2026-10-15'))).records;assert.equal(records[0].action,'조치 완료');
  const prepare=env.DB.prepare.bind(env.DB);env.DB.prepare=sql=>{if(sql.startsWith('INSERT INTO safety_checks'))throw new Error('PRIVATE');return prepare(sql);};assert.equal((await req(env,'safety/fail','PUT',b)).status,500);assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM safety_checks').get().n,1);
});
test('booking conflicts are atomic on simultaneous inserts and updates; cancellation keeps history',async()=>{
  const env=makeEnv();await data(await req(env,'vehicles/car','PUT',{number:'합성 차량'}));
  const b={vehicleId:'car',date:'2026-10-15',start:'09:00',end:'12:00',applicant:'합성 신청자',purpose:'합성 용도'};
  const results=await Promise.all([req(env,'bookings/a','PUT',b),req(env,'bookings/b','PUT',b)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  await data(await req(env,'bookings/adjacent','PUT',{...b,start:'12:00',end:'13:00'}));
  assert.equal((await req(env,'bookings/adjacent','PUT',{...b,start:'11:59',end:'13:00',revision:1})).status,409);
  assert.equal((await req(env,'bookings/bad','PUT',{...b,end:'08:00'})).status,400);
  const active=(await data(await req(env,'bookings?week=2026-10-15'))).records.find(r=>r.start==='09:00');
  await data(await req(env,'bookings/'+active.id,'DELETE',{revision:1}));
  await data(await req(env,'bookings/new','PUT',b));const records=(await data(await req(env,'bookings?week=2026-10-15'))).records;assert.equal(records.filter(r=>r.cancelled).length,1);assert.equal(records.length,3);
});
test('meals configure people without seeding, persist revisions and roll back entire stale batch',async()=>{
  const env=makeEnv();assert.equal((await data(await req(env,'people'))).records.length,0);
  await data(await req(env,'people/person','PUT',{name:'합성 인원',department:'합성 부서'}));
  const r={person_id:'person',day:'2026-10-15',breakfast:0,lunch:1,dinner:0,revision:0};
  await data(await req(env,'meals?week=2026-10-15','PUT',{records:[r]}));
  assert.equal((await data(await req(env,'meals?week=2026-10-15'))).records[0].revision,1);
  assert.equal((await req(env,'meals?week=2026-10-15','PUT',{records:[{...r,lunch:0},{...r,day:'2026-10-16'}]})).status,409);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM meals').get().n,1);assert.equal(env.sqlite.prepare('SELECT lunch FROM meals').get().lunch,1);
  await data(await req(env,'meals?week=2026-10-15','PUT',{records:[{...r,revision:1,lunch:0,dinner:1}]}));assert.equal((await data(await req(env,'meals?week=2026-10-15'))).records[0].dinner,1);
});
test('xlsx production/supplies round trip, Korean text, serials, blanks, wrong dates and formulas',async()=>{
  const parsed=await parseWorkbook(new Uint8Array(await template('production')),'production');assert.equal(parsed.rows.length,1);assert.equal(parsed.rows[0].data.Yard,'예시조선소');
  const supplies=await parseWorkbook(new Uint8Array(await template('supplies')),'supplies');assert.equal(supplies.rows[0].data['단가'],1000);
  for(const value of ['2026-02-30','wrong',60]){
    const b=await createWorkbook(['PND','현공정','수량','분류'],[{PND:value,'현공정':'조립','수량':1,'분류':'AC'}]);await assert.rejects(()=>parseWorkbook(new Uint8Array(b),'production'));
  }
  const b=await createWorkbook(['PND','현공정','수량','분류'],[{PND:1,'현공정':'조립','수량':1,'분류':'AC'},{PND:'','현공정':'','수량':0,'분류':'AC'}]);const dates=await parseWorkbook(new Uint8Array(b),'production');assert.equal(dates.rows[0].data.PND,'1900-01-01');assert.equal(dates.warnings.length,1);
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Sheet1');sheet.addRow(['PND','현공정','수량','분류']);sheet.addRow(['2026-10-15','조립',{formula:'1+1'},'AC']);await assert.rejects(()=>book.xlsx.writeBuffer().then(b=>parseWorkbook(new Uint8Array(b),'production')),/수식/);
  await assert.rejects(()=>parseWorkbook(new Uint8Array(2*1024*1024+1),'production'));
  assert.equal((await parseWorkbook(new Uint8Array(await createWorkbook(['PND','현공정','수량','분류'],Array.from({length:MAX_ROWS+1},()=>({'수량':1})))),'production')).rows.length,MAX_ROWS+1);
  await assert.rejects(()=>createWorkbook(['품목코드','품목명','규격','단위','단가'],[{'품목코드':'A','품목명':'장갑','규격':'L','단위':'EA','단가':100},{'품목코드':'A','품목명':'장갑2','규격':'L','단위':'EA','단가':100}]).then(b=>parseWorkbook(new Uint8Array(b),'supplies')),/중복/);
});
test('upload preview is not live; original retained; apply and retry never replace another batch',async()=>{
  const env=makeEnv();const p=await data(await preview(env));assert.equal(p.applyCount,1);assert.equal((await req(env,'production?import='+p.id)).status,409);assert.equal(env.objects.size,1);
  const file=await req(env,'imports/'+p.id+'/file');assert.equal(file.status,200);assert.ok((await file.arrayBuffer()).byteLength>0);
  await data(await req(env,'imports/'+p.id+'/apply','POST'));assert.equal((await data(await req(env,'production?import='+p.id))).records.length,1);
  assert.equal((await data(await req(env,'imports/'+p.id+'/apply','POST'))).retry,true);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM production_rows').get().n,1);
  const b=await createWorkbook(['PND','현공정','수량','분류'],[{PND:'2026-10-15','현공정':'조립','수량':2,'분류':'AC'}]);const second=await data(await preview(env,'production',b));await data(await req(env,'imports/'+second.id+'/apply','POST'));
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM production_rows').get().n,2);assert.equal(env.objects.size,2);
  assert.equal((await req(env,'production?import='+p.id+'&download=1')).headers.get('Content-Type'),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal((await preview(env,'production',b)).status,409);
});
test('supplies cart quantities are validated server-side; snapshots and own/admin downloads',async()=>{
  const env=makeEnv(),token=viewer(env),p=await data(await preview(env,'supplies'));await data(await req(env,'imports/'+p.id+'/apply','POST'));
  const item=(await data(await req(env,'supplies?import='+p.id))).records[0],b={applicant:'합성 신청자',department:'합성 부서',purpose:'합성 용도',lines:[{id:item.id,quantity:2}]};
  assert.equal((await req(env,'orders/o','PUT',{...b,lines:[{id:item.id,quantity:-1}]})).status,400);
  await data(await req(env,'orders/o','PUT',b,token));assert.equal((await data(await req(env,'orders/o','PUT',b,token))).retry,true);
  assert.equal((await data(await req(env,'orders','GET',undefined,token))).records[0].lines[0].item['품목명'],'예시 장갑');
  const exported=await req(env,'orders?download=1');const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await exported.arrayBuffer());assert.equal(workbook.worksheets[0].rowCount,2);
  assert.equal((await req(env,'orders','DELETE',{},token)).status,400);
});
test('manual menu images are R2 objects with authenticated access and no crawler',async()=>{
  const env=makeEnv(),form=new FormData(),png=new Uint8Array([137,80,78,71,13,10,26,10,0]);form.set('file',new File([png],'합성.png',{type:'image/png'}));
  const response=await worker.fetch(new Request(base+'/api/business/menus?week=2026-10-15',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+TOKEN},body:form}),env),r=await data(response);
  assert.equal((await req(env,'menus/'+r.id,'GET',undefined,null)).status,401);const read=await req(env,'menus/'+r.id);assert.equal(read.headers.get('Content-Type'),'image/png');assert.deepEqual(new Uint8Array(await read.arrayBuffer()),png);
});
test('signup cannot reset existing passwords, grants pending only, admin approval and session revocation',async()=>{
  const env=makeEnv(),body={id:'synthetic-user',name:'합성 가입자',password:'001234',role:'admin'};
  const created=await data(await req(env,'/api/auth/register','POST',body,null));assert.equal(created.pending,true);
  const hash=env.sqlite.prepare('SELECT password_hash FROM portal_accounts WHERE id=?').get(body.id).password_hash;
  assert.equal((await req(env,'/api/auth/register','POST',{...body,password:'009876'},null)).status,409);
  assert.equal(env.sqlite.prepare('SELECT password_hash FROM portal_accounts WHERE id=?').get(body.id).password_hash,hash);
  const pending=await req(env,'/api/auth/login','POST',body,null);assert.equal(pending.status,403);assert.equal((await pending.json()).code,'ACCOUNT_PENDING');
  await data(await req(env,'/api/auth/users/'+body.id,'PUT',{status:'active'}));const login=await data(await req(env,'/api/auth/login','POST',body,null));assert.equal(login.user.role,'user');assert.equal(login.token.length,64);
  const stored=env.sqlite.prepare('SELECT token_hash FROM portal_sessions WHERE user_id=?').get(body.id).token_hash;assert.notEqual(stored,login.token);
  await data(await req(env,'/api/auth/me','GET',undefined,login.token));await data(await req(env,'/api/auth/logout','POST',undefined,login.token));assert.equal((await req(env,'/api/auth/me','GET',undefined,login.token)).status,401);
});
test('one-time bootstrap needs configured secret and never grants admin through ordinary signup',async()=>{
  const env=makeEnv(),b={id:'synthetic-admin',name:'합성 관리자',password:'synthetic-only-password',bootstrapSecret:'s'.repeat(32)};
  assert.equal(env.sqlite.prepare("SELECT count(*) AS n FROM portal_bootstrap").get().n,1,'management-created admin atomically closes public setup');
  env.sqlite.exec('DELETE FROM portal_bootstrap'); // Synthetic empty-install bootstrap scenario only.
  assert.equal((await req(env,'/api/auth/bootstrap','POST',b,null)).status,503);env.PORTAL_BOOTSTRAP_SECRET='s'.repeat(32);
  assert.equal((await req(env,'/api/auth/bootstrap','POST',{...b,bootstrapSecret:'wrong'},null)).status,403);
  await data(await req(env,'/api/auth/bootstrap','POST',b,null));assert.equal((await req(env,'/api/auth/bootstrap','POST',{...b,id:'second-admin'},null)).status,409);
});
test('additive business migration and integration leave old issues and calendars intact',async()=>{
  const env=makeEnv();env.sqlite.exec(readFileSync(new URL('../migrations/0003_shared_calendars.sql',import.meta.url),'utf8'));
  await data(await req(env,'/api/issues/old','PUT',{id:'old',title:'기존 합성 문제',yard:'합성 YARD',hullNo:'H1',productNo:'P1',part:'',factory:'',images:[],afterImages:[]}));
  const before=env.sqlite.prepare('SELECT * FROM issues WHERE id=?').get('old');await data(await req(env,'weekly/one','PUT',weekly));assert.deepEqual(env.sqlite.prepare('SELECT * FROM issues WHERE id=?').get('old'),before);
  const read=await data(await req(env,'/api/issues'));assert.equal(read.issues[0].yard,'합성 YARD');assert.equal(read.issues[0].part,'');assert.equal(read.issues[0].factory,'');
});
test('server ownership blocks forged reporter IDs and legacy ownerless record deletion',async()=>{
  const env=makeEnv(),token=viewer(env);
  const r=await data(await req(env,'/api/issues/forged','PUT',{title:'합성',reporterId:'owner',reporter:'위조',images:[],afterImages:[]},token));assert.equal(r.issue.reporterId,'viewer');assert.equal(r.issue.reporter,'합성 사용자');
  env.sqlite.prepare("INSERT INTO issues(id,title,reporter_id,reporter) VALUES('legacy','합성 과거','','과거 등록자')").run();
  await data(await req(env,'/api/issues/legacy','PUT',{title:'수정',reporterId:'viewer',images:[],afterImages:[]},token));assert.equal(env.sqlite.prepare("SELECT reporter_id FROM issues WHERE id='legacy'").get().reporter_id,'');
  assert.equal((await req(env,'/api/issues/legacy','DELETE',undefined,token)).status,403);
});
test('legacy fourth-row supply header, shared strings, 1904 dates, XML/ZIP hard limits',async()=>{
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Sheet1');sheet.addRow(['안내']);sheet.addRow([]);sheet.addRow([]);sheet.addRow(['품목코드','폼목명','규격','단위','단가']);sheet.addRow(['SYNTH-001','한글 & 장갑','L','EA',100]);
  const legacy=await parseWorkbook(new Uint8Array(await book.xlsx.writeBuffer()),'supplies');assert.equal(legacy.rows[0].number,5);assert.equal(legacy.rows[0].data['품목명'],'한글 & 장갑');
  const files=unzipSync(await createWorkbook(['PND','현공정','수량','분류'],[{PND:0,'현공정':'조립','수량':1,'분류':'AC'}]));
  files['xl/workbook.xml']=strToU8(strFromU8(files['xl/workbook.xml']).replace('<sheets>','<workbookPr date1904="1"/><sheets>'));
  assert.equal((await parseWorkbook(zipSync(files),'production')).rows[0].data.PND,'1904-01-01');
  files['xl/workbook.xml']=strToU8(strFromU8(files['xl/workbook.xml']).replace('<workbook ','<!DOCTYPE workbook [<!ENTITY unsafe SYSTEM "https://invalid.example/entity">]><workbook '));
  await assert.rejects(()=>parseWorkbook(zipSync(files),'production'),/DOCTYPE/);
  const bomb=zipSync({'[Content_Types].xml':strToU8('<a/>'),'xl/workbook.xml':strToU8('<a/>'),'xl/worksheets/sheet1.xml':new Uint8Array(13*1024*1024)},{level:1});
  const view=new DataView(bomb.buffer,bomb.byteOffset,bomb.byteLength);for(let p=0;p<bomb.length-46;p++)if(view.getUint32(p,true)===0x02014b50)view.setUint32(p+24,1,true);
  await assert.rejects(()=>parseWorkbook(bomb,'production'),e=>e.status===413);
});
test('notice/config CRUD is admin-only, duplicate vehicles are conflicts, retained orders are excluded from search',async()=>{
  const env=makeEnv(),token=viewer(env);env.sqlite.exec(readFileSync(new URL('../migrations/0003_shared_calendars.sql',import.meta.url),'utf8'));
  await data(await req(env,'vehicles/car','PUT',{number:'합성 001'}));assert.equal((await req(env,'vehicles/duplicate','PUT',{number:'합성 001'})).status,409);
  await data(await req(env,'vehicles/car','PUT',{number:'합성 001',revision:1,active:false}));assert.equal((await data(await req(env,'vehicles'))).records[0].active,false);
  await data(await req(env,'notices/n','PUT',{title:'합성 공지',content:'합성 내용'}));await data(await req(env,'notices/n','PUT',{title:'합성 공지 수정',content:'수정 본문',revision:1}));
  const stamp=new Date().toISOString();env.sqlite.prepare('INSERT INTO supply_orders(id,owner,applicant,department,purpose,lines,created_at) VALUES(?,?,?,?,?,?,?)').run('private','owner','합성신청','부서','비공개신청검색',JSON.stringify([]),stamp);
  assert.equal((await data(await req(env,'search?q=비공개신청검색','GET',undefined,token))).records.length,0);assert.equal((await data(await req(env,'search?q=비공개신청검색'))).records.length,0);
  assert.equal(env.sqlite.prepare('SELECT count(*) n FROM supply_orders').get().n,1);
  assert.equal((await data(await req(env,'search?q=수정'))).records.find(r=>r.type==='notices').label,'합성 공지 수정');
});
test('malformed JSON values and nested lines fail as validation errors without writes',async()=>{
  const env=makeEnv();
  for(const path of ['weekly/a','safety/a','vehicles/a','people/a','bookings/a','orders/a','meals?week=2026-10-15'])for(const b of [null,[],42])assert.equal((await req(env,path,'PUT',b)).status,400,path);
  assert.equal((await req(env,'meals?week=2026-10-15','PUT',{records:[null]})).status,400);
  assert.equal((await req(env,'orders/a','PUT',{applicant:'합성',department:'합성',purpose:'합성',lines:[null]})).status,400);
  assert.equal((await req(env,'people/a','PUT',{name:'합성',active:'false'})).status,400);
  assert.equal((await req(env,'production?download=1')).status,400);
});
