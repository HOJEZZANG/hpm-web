import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../worker.js';
import {makeEnv,TOKEN} from './support/env.mjs';
import {ahuBytes} from './support/production-parts-fixtures.mjs';
import {writeTable} from '../business/ooxml.mjs';
import {parseProductionSheet,normalizeProductionRow,validateMetadata} from '../business/production-sheet.mjs';
import {ahuView,ahuProcessState} from '../business/production-view.mjs';
import {productionWorkbook} from '../business/production-export.mjs';
import ExcelJS from 'exceljs/dist/exceljs.min.js';
const sha=b=>createHash('sha256').update(b).digest('hex'),firstBytes=()=>writeTable(['PND','현공정','수량','분류','Yard'],[['2026-10-31','조립',2,'AC','합성 1파트']]);
async function req(env,path,method='GET',body,token=TOKEN){return worker.fetch(new Request('https://hpmanagement-web.lotusland1995.workers.dev/api/business/'+path,{method,headers:{Origin:'https://hojezzang.github.io',...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':body instanceof Uint8Array?'application/octet-stream':'application/json'})},...(body===undefined?{}:{body:body instanceof Uint8Array?body:JSON.stringify(body)})}),env);}
async function ok(r){assert.equal(r.status,200,await r.clone().text());return r.json();}
async function stage(env,bytes,part='part2',ready=true){const p=parseProductionSheet(bytes,()=>{},part),id=crypto.randomUUID(),path='imports/'+id;await ok(await req(env,'imports/start','POST',{id,part,sha256:sha(bytes),filename:'양식.xlsx',size:bytes.length,meta:p.meta}));await ok(await req(env,path+'/file?part='+part,'PUT',bytes));for(let i=0;i<p.rows.length;i+=20)await ok(await req(env,path+'/chunk?part='+part,'POST',{rows:p.rows.slice(i,i+20)}));if(ready)await ok(await req(env,path+'/ready?part='+part,'POST'));return {id,p,path:path+'?part='+part};}
const apply=(env,id,part)=>okRequest(env,'imports/'+id+'/apply?part='+part,'POST');async function okRequest(...a){return ok(await req(...a));}

test('AHU primary sheet/header discovery preserves equipment rows, zeroes and quantities; changed or ambiguous headers and cross-part equipment are blocked',()=>{
 const p=parseProductionSheet(ahuBytes(),()=>{},'part2');validateMetadata(p.meta);assert.equal(p.meta.headerRow,2);assert.equal(p.rows.length,3);const rows=p.rows.map(r=>normalizeProductionRow(r,p.meta));assert.equal(rows[0].HullNo,'00001');assert.equal(rows[0]['Work Order'],'000000');assert.equal(rows.reduce((s,r)=>s+r['수량'],0),4);assert.equal(new Set(rows.map(r=>r.HullNo)).size,2);
 assert.throws(()=>parseProductionSheet(firstBytes(),()=>{},'part2'),/AHU/);assert.throws(()=>parseProductionSheet(ahuBytes()),/필수 열/);
 const changed=structuredClone(p.meta);changed.columns[0].title='다른 열';assert.throws(()=>validateMetadata(changed),/Yard/);
 const disguised=parseProductionSheet(writeTable(['PND','현공정','수량','LINE 5000'],[['2026-10-31','완료',1,'AHU']]));assert.throws(()=>normalizeProductionRow(disguised.rows[0],disguised.meta),/2파트/);
});
test('AHU excludes subtotal and repeated headers without deduplicating multiple equipment on one hull; uncertain process/date values stay original',async()=>{
 const row=['합성','0001','신규 공정','날짜 확인',2,'0008','00001','AHU','0008-A','',''],b=ahuBytes(0,{rows:[row,['합계','','','',2,'','','','','',''],['Yard','HullNo','현공정','PND','수량','품번','Work Order','LINE 5000','규격','최종완료일','최신공정완료일'],row]});
 const p=parseProductionSheet(b,()=>{},'part2');assert.equal(p.rows.length,2);assert.equal(p.meta.excluded.summary,1);assert.equal(p.meta.excluded.headers,1);const rows=p.rows.map(r=>normalizeProductionRow(r,p.meta));assert.equal(rows[0].PND,'날짜 확인');assert.equal(ahuProcessState('신규 공정'),'unknown');const v=ahuView(rows,{}, {},'2026-10-31');assert.equal(v.summary.unknown,2);assert.equal(v.summary.invalidPnd,2);assert.equal(v.summary.overdue,0);
 const book=new ExcelJS.Workbook();await book.xlsx.load(productionWorkbook(p.meta.columns,p.rows.map(r=>r.values)));assert.equal(book.worksheets[0].getCell('D2').value,'날짜 확인');assert.equal(book.worksheets[0].getCell('B2').value,'0001');
});
test('parts share independent latest snapshots across sessions, every ID/raw source endpoint rejects cross-part scope, history and sources survive',async()=>{
 const env=makeEnv(),one=await stage(env,firstBytes(),'part1');await apply(env,one.id,'part1');const firstSnapshot=env.sqlite.prepare('SELECT * FROM production_rows WHERE import_id=?').all(one.id),sourceKey=env.sqlite.prepare('SELECT file_key FROM plan_imports WHERE id=?').get(one.id).file_key;
 assert.equal((await okRequest(env,'imports/latest?kind=production&part=part2')).record,null);assert.equal((await okRequest(env,'production?part=part2')).records.length,0);
 const two=await stage(env,ahuBytes());await apply(env,two.id,'part2');assert.equal((await okRequest(env,'production?part=part1')).importId,one.id);assert.equal((await okRequest(env,'production?part=part2')).importId,two.id);assert.equal((await okRequest(env,'imports/latest?kind=production&part=part2')).record.row_count,3);
 for(const suffix of ['', '/rows','/file','/apply'])assert.equal((await req(env,'imports/'+two.id+suffix+'?part=part1',suffix==='/apply'?'POST':'GET')).status,404);
 assert.equal((await req(env,'production?part=part1&import='+two.id)).status,404);assert.equal((await req(env,'production?part=other')).status,400);assert.equal((await req(env,'imports/latest?kind=production&part=')).status,400);
 assert.deepEqual(env.sqlite.prepare('SELECT * FROM production_rows WHERE import_id=?').all(one.id),firstSnapshot);assert(env.objects.has(sourceKey));assert.equal(env.objects.size,2);assert.equal((await okRequest(env,'imports?kind=production&part=part1')).records.length,1);
 env.sqlite.exec(readFileSync(new URL('../migrations/0003_shared_calendars.sql',import.meta.url),'utf8'));const search=(await okRequest(env,'search?q='+encodeURIComponent('합성'))).records.filter(r=>r.type==='production');assert.deepEqual(new Set(search.map(r=>r.part)),new Set(['part1','part2']));
});
test('rolling deployment compatibility assigns old production inserts to part 1; explicit invalid or contradictory parts are rejected',async()=>{
 const env=makeEnv();env.sqlite.prepare('INSERT INTO plan_imports(id,kind,owner,filename,file_key,sha256,row_count,staged_data,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run('old-worker','production','owner','source.xlsx','retained/old','old-hash',1,'{}','2026-10-31');assert.equal(env.sqlite.prepare('SELECT production_part FROM plan_imports WHERE id=?').get('old-worker').production_part,'part1');
 const bytes=ahuBytes(),p=parseProductionSheet(bytes,()=>{},'part2'),body={id:crypto.randomUUID(),part:'part2',sha256:sha(bytes),filename:'source.xlsx',size:bytes.length,meta:p.meta};assert.equal((await req(env,'imports/start?part=part1','POST',body)).status,400);assert.equal((await req(env,'imports/start','POST',{...body,part:null})).status,400);
});
test('source/body forgery, interrupted staging, R2 loss, duplicate and concurrent apply requests retain the last good snapshot per part',async()=>{
 const env=makeEnv(),old=await stage(env,ahuBytes());await apply(env,old.id,'part2');
 const b=ahuBytes(4),next=await stage(env,b,'part2',false);assert.equal((await req(env,'imports/'+next.id+'/apply?part=part2','POST')).status,409);assert.equal((await okRequest(env,'production?part=part2')).importId,old.id);
 env.sqlite.prepare("UPDATE production_rows SET data=json_set(data,'$.수량',999) WHERE import_id=? AND row_number=3").run(next.id);assert.equal((await req(env,'imports/'+next.id+'/ready?part=part2','POST')).status,409);
 env.sqlite.prepare('UPDATE production_rows SET data=? WHERE import_id=? AND row_number=3').run(JSON.stringify(normalizeProductionRow(next.p.rows[0],next.p.meta)),next.id);await okRequest(env,'imports/'+next.id+'/ready?part=part2','POST');
 const key=env.sqlite.prepare('SELECT file_key FROM plan_imports WHERE id=?').get(next.id).file_key,object=env.objects.get(key);env.objects.delete(key);assert.equal((await req(env,'imports/'+next.id+'/apply?part=part2','POST')).status,409);assert.equal((await okRequest(env,'production?part=part2')).importId,old.id);env.objects.set(key,object);
 await Promise.all([apply(env,next.id,'part2'),apply(env,next.id,'part2')]);assert.equal((await okRequest(env,'production?part=part2')).importId,next.id);assert.equal(env.sqlite.prepare("SELECT count(*) n FROM plan_imports WHERE status='applied'").get().n,2);
 assert.equal((await req(env,'imports/start','POST',{id:crypto.randomUUID(),part:'part2',sha256:sha(b),filename:'다른이름.xlsx',size:b.length,meta:next.p.meta})).status,409);assert.equal(env.objects.size,2);
 const id=crypto.randomUUID();await okRequest(env,'imports/start','POST',{id,part:'part2',sha256:sha(firstBytes()),filename:'AHU.xlsx',size:firstBytes().length,meta:next.p.meta});assert.equal((await req(env,'imports/'+id+'/file?part=part2','PUT',firstBytes())).status,400);assert.equal(env.objects.size,2);
});
test('part-scoped mutations and private staging remain administrator-only and anonymous requests stay blocked',async()=>{
 const env=makeEnv(),staged=await stage(env,ahuBytes(),'part2',false),token='b'.repeat(64);env.sqlite.prepare('INSERT INTO portal_accounts(id,name,salt,password_hash,role,status,created_at) VALUES(?,?,?,?,?,?,?)').run('viewer','합성','unused','unused','user','active',new Date().toISOString());env.sqlite.prepare('INSERT INTO portal_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(sha(token),'viewer','2099-01-01T00:00:00Z');
 for(const [path,method,body]of [['imports/start','POST',{}],['imports/'+staged.id,'GET'],['imports/'+staged.id+'/rows','GET'],['imports/'+staged.id+'/file','GET'],['imports/'+staged.id+'/file','PUT',ahuBytes()],['imports/'+staged.id+'/chunk','POST',{}],['imports/'+staged.id+'/ready','POST'],['imports/'+staged.id+'/apply','POST']]){assert.equal((await req(env,path+'?part=part2',method,body,token)).status,403);assert.equal((await req(env,path+'?part=part2',method,body,null)).status,401);}
});
test('migration maps only existing production imports and retains all legacy rows, source keys and other business fields',()=>{
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../migrations/0001_cloudflare_schema.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('../migrations/0004_part1_business.sql',import.meta.url),'utf8'));for(const [id,kind]of [['one','production'],['two','supplies']])db.prepare('INSERT INTO plan_imports(id,kind,owner,filename,file_key,sha256,row_count,staged_data,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,kind,'owner','source.xlsx','retained/'+id,'hash-'+id,1,'{}','2026-10-31');const before=db.prepare('SELECT * FROM plan_imports ORDER BY id').all();db.exec(readFileSync(new URL('../migrations/0008_production_parts.sql',import.meta.url),'utf8'));const after=db.prepare('SELECT * FROM plan_imports ORDER BY id').all();assert.deepEqual(after.map(({production_part,...r})=>r),before.map(r=>({...r})));assert.equal(after[0].production_part,'part1');assert.equal(after[1].production_part,null);assert.throws(()=>db.exec("UPDATE plan_imports SET production_part='part2' WHERE id='one'"),/immutable/);db.close();
});
