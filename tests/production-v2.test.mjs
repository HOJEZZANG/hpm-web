// Synthetic-only XLSX and D1/R2 protocol tests; no production connection.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import worker from '../worker.js';
import {makeEnv,TOKEN} from './support/env.mjs';
import {writeTable,readTable} from '../business/ooxml.mjs';
import {parseProductionSheet,validateMetadata,normalizeProductionRow} from '../business/production-sheet.mjs';
import {productionLimits as L,byteLength} from '../business/production-limits.mjs';
import {productionSummary} from '../business/domain.mjs';
const base='https://hpmanagement-web.lotusland1995.workers.dev/api/business/',origin='https://hojezzang.github.io';
const headers=['PND','현공정','수량','분류','Yard'];
const sha=b=>createHash('sha256').update(b).digest('hex');
async function req(env,path,method='GET',body,token=TOKEN){return worker.fetch(new Request(base+path,{method,headers:{Origin:origin,...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':body instanceof Uint8Array?'application/octet-stream':'application/json'})},...(body===undefined?{}:{body:body instanceof Uint8Array?body:JSON.stringify(body)})}),env);}
async function ok(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}
async function start(env,bytes,plan,id=crypto.randomUUID()){await ok(await req(env,'imports/start','POST',{id,sha256:sha(bytes),filename:'합성.xlsx',size:bytes.length,meta:plan.meta}));return id;}
function chunks(rows){const result=[];for(let i=0;i<rows.length;){const part=[];let bytes=32;while(i<rows.length&&part.length<20){const size=byteLength(rows[i])+1;if(part.length&&bytes+size>L.chunk)break;part.push(rows[i++]);bytes+=size;}result.push(part);}return result;}
async function upload(env,bytes,plan){const id=await start(env,bytes,plan);await ok(await req(env,'imports/'+id+'/file','PUT',bytes));for(const rows of chunks(plan.rows))await ok(await req(env,'imports/'+id+'/chunk','POST',{rows}));await ok(await req(env,'imports/'+id+'/ready','POST'));await ok(await req(env,'imports/'+id+'/apply','POST'));return id;}

test('position IDs preserve duplicate/blank/additional headers, Korean values and column order; only required ambiguity needs a choice',()=>{
  const bytes=writeTable([...headers,'PND','','추가','추가'],[['2026-10-23','조립',2,'AC',' 한글 원본 ','2026-10-24','빈 제목의 값','<img src=x onerror=alert(1)>','원본2']]);
  const p=parseProductionSheet(bytes);assert.equal(p.meta.columns.length,9);assert.deepEqual(p.info.candidates.PND,['c1','c6']);assert.throws(()=>validateMetadata(p.meta),/중복된 필수/);
  p.meta.mapping.PND='c6';validateMetadata(p.meta);const row=normalizeProductionRow(p.rows[0],p.meta);assert.equal(row.PND,'2026-10-24');assert.equal(row.Yard,'한글 원본');assert.equal(row.__cells[4],' 한글 원본 ');assert.equal(row.__cells[6],'빈 제목의 값');assert.equal(row.__cells[7],'<img src=x onerror=alert(1)>');
  const exported=writeTable(p.meta.columns,p.rows.map(r=>r.values)),r=readTable(exported,'production',{preserveText:true});assert.deepEqual(p.meta.columns.map(c=>r.get(1,c.position)),[...headers,'PND','','추가','추가']);assert.equal(r.get(2,9),'원본2');
});

test('blank cells and formatting-only far-away ranges do not create huge row/column arrays',()=>{
  const source=unzipSync(writeTable([...headers,'완전 빈 열'],[['2026-10-23','조립',1,'AC','한글','']]));let xml=strFromU8(source['xl/worksheets/sheet1.xml']);
  xml=xml.replace('<sheetViews>','<dimension ref="A1:XFD1048576"/><sheetViews>').replace('</sheetData>','<row r="1048576"><c r="XFD1048576" s="1"/></row></sheetData>');source['xl/worksheets/sheet1.xml']=strToU8(xml);
  const p=parseProductionSheet(zipSync(source));assert.equal(p.rows.length,1);assert.equal(p.meta.columns.length,6,'a nonempty title is preserved even with no values');assert.equal(p.meta.columns.at(-1).position,6);assert.equal(p.rows[0].number,2);
  const gap=parseProductionSheet(writeTable([{title:'PND',position:1},{title:'현공정',position:2},{title:'수량',position:3},{title:'분류',position:4},{title:'끝',position:80}],[['', '조립',1,'AC','추가']]));assert.equal(gap.meta.columns.at(-1).id,'c80');assert.equal(readTable(writeTable(gap.meta.columns,gap.rows.map(r=>r.values)),'production').get(2,80),'추가');
});

test('required fields, dates, 1904 serials, cached formulas, row/file budgets and forged mappings are independently checked',()=>{
  assert.throws(()=>parseProductionSheet(writeTable(['PND','현공정'],[['2026-10-23','조립']])),/필수 열/);
  for(const value of ['2026-02-30','잘못된 날짜',60]){const p=parseProductionSheet(writeTable(headers,[[value,'조립',1,'AC','한글']]));assert.throws(()=>normalizeProductionRow(p.rows[0],p.meta));}
  const b=unzipSync(writeTable(headers,[[0,'조립',1,'AC','한글']]));b['xl/workbook.xml']=strToU8(strFromU8(b['xl/workbook.xml']).replace('<sheets>','<workbookPr date1904="1"/><sheets>'));b['xl/worksheets/sheet1.xml']=strToU8(strFromU8(b['xl/worksheets/sheet1.xml']).replace('<c r="C2"><v>1</v></c>','<c r="C2"><f>1+1</f><v>2</v></c>'));
  const p=parseProductionSheet(zipSync(b));assert.equal(normalizeProductionRow(p.rows[0],p.meta).PND,'1904-01-01');assert.equal(normalizeProductionRow(p.rows[0],p.meta)['수량'],2);assert.deepEqual(p.rows[0].formulas,[[2,'1+1']]);
  p.meta.equipment='Yard';assert.throws(()=>validateMetadata(p.meta));assert.throws(()=>parseProductionSheet(new Uint8Array(L.file+1)),/MiB/);
});

test('staging remains invisible; lost responses/retries are idempotent; incomplete/changed rows do not overwrite existing plans',async()=>{
  const env=makeEnv(),bytes=writeTable(headers,[['2026-10-23','조립',1,'AC','한글'],['','가공',2,'CHILLER','한글2']]),p=parseProductionSheet(bytes),id=await start(env,bytes,p);
  assert.equal((await req(env,'imports/'+id+'/chunk','POST',{rows:p.rows})).status,409);
  const tampered=bytes.slice();tampered[20]^=1;assert.equal((await req(env,'imports/'+id+'/file','PUT',tampered)).status,409);assert.equal(env.objects.size,0);
  await ok(await req(env,'imports/'+id+'/file','PUT',bytes));await ok(await req(env,'imports/'+id+'/file','PUT',bytes));assert.equal(env.objects.size,1);
  const part={rows:[p.rows[0]]};await ok(await req(env,'imports/'+id+'/chunk','POST',part));await ok(await req(env,'imports/'+id+'/chunk','POST',part));
  assert.equal((await req(env,'imports/'+id+'/ready','POST')).status,409);assert.equal((await req(env,'production?import='+id)).status,409);assert.equal(env.sqlite.prepare('SELECT count(*) n FROM production_rows').get().n,1);
  const changed={...p.rows[0],values:[...p.rows[0].values]};changed.values[2]=99;assert.equal((await req(env,'imports/'+id+'/chunk','POST',{rows:[changed,p.rows[1]]})).status,409);assert.equal(JSON.parse(env.sqlite.prepare('SELECT data FROM production_rows').get().data)['수량'],1);assert.equal(env.sqlite.prepare('SELECT count(*) n FROM production_rows').get().n,1,'conflicting chunk rolls back even its new rows');
  const invalid={...p.rows[1],values:[...p.rows[1].values]};invalid.values[2]=-1;assert.equal((await req(env,'imports/'+id+'/chunk','POST',{rows:[invalid]})).status,400);
  const realBatch=env.DB.batch;env.DB.batch=async()=>{throw Error('synthetic transfer/storage failure');};assert.equal((await req(env,'imports/'+id+'/chunk','POST',{rows:[p.rows[1]]})).status,500);env.DB.batch=realBatch;
  assert.equal((await ok(await req(env,'imports/'+id))).staged,1);await ok(await req(env,'imports/'+id+'/chunk','POST',{rows:p.rows}));await ok(await req(env,'imports/'+id+'/ready','POST'));await ok(await req(env,'imports/'+id+'/ready','POST'));
  await ok(await req(env,'imports/'+id+'/apply','POST'));assert.equal((await ok(await req(env,'imports/'+id+'/apply','POST'))).retry,true);assert.equal((await ok(await req(env,'production?import='+id))).records.length,2);
  const secondBytes=writeTable(headers,[['2026-10-25','조립',3,'AC','새 계획']]);await upload(env,secondBytes,parseProductionSheet(secondBytes));assert.equal(env.sqlite.prepare('SELECT count(*) n FROM production_rows').get().n,3);assert.equal(env.objects.size,2);assert.equal((await req(env,'imports/start','POST',{id:crypto.randomUUID(),sha256:sha(bytes),filename:'동일.xlsx',size:bytes.length,meta:p.meta})).status,409);
  assert.equal((await req(env,'imports/'+id+'/file','GET',undefined,null)).status,401);assert.equal((await req(env,'imports/start','POST',{},null)).status,401);
});

test('atomic counters roll back budget failures; server rejects ordinary users for every staging mutation and private preview/file',async()=>{
  const env=makeEnv(),bytes=writeTable(headers,[['2026-10-23','조립',1,'AC','한글'],['','가공',2,'AC','추가']]),p=parseProductionSheet(bytes);p.meta.rowCount=1;const id=await start(env,bytes,p);await ok(await req(env,'imports/'+id+'/file','PUT',bytes));
  assert.equal((await req(env,'imports/'+id+'/chunk','POST',{rows:p.rows})).status,413);assert.equal(env.sqlite.prepare('SELECT count(*) n FROM production_rows').get().n,0);assert.equal(JSON.parse(env.sqlite.prepare('SELECT staged_data FROM plan_imports').get().staged_data).stagedCount,0);assert.equal(env.objects.size,1);
  const token='b'.repeat(64);env.sqlite.prepare('INSERT INTO portal_accounts(id,name,salt,password_hash,role,status,created_at) VALUES(?,?,?,?,?,?,?)').run('viewer','합성 사용자','unused','unused','user','active',new Date().toISOString());env.sqlite.prepare('INSERT INTO portal_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(sha(Buffer.from(token)),'viewer','2099-01-01T00:00:00Z');
  for(const [path,method,body] of [['imports/start','POST',{}],['imports/'+id+'/file','PUT',bytes],['imports/'+id+'/chunk','POST',{rows:[p.rows[0]]}],['imports/'+id+'/ready','POST'],['imports/'+id+'/apply','POST'],['imports/'+id,'GET'],['imports/'+id+'/rows','GET'],['imports/'+id+'/file','GET']])assert.equal((await req(env,path,method,body,token)).status,403,path);
});

test('more than 500 rows, 40 columns and 2MiB are parsed, chunk-stored, paged and exported without lost or duplicate rows',async()=>{
  const startTime=performance.now(),env=makeEnv(),extra=Array.from({length:50},(_,i)=>'추가열'+i),rows=Array.from({length:620},(_,i)=>['2026-10-23','조립',i,'AC','한글'+i,...extra.map(()=>randomBytes(85).toString('hex'))]);
  const bytes=writeTable([...headers,...extra],rows);assert(bytes.length>2*1024*1024);const p=parseProductionSheet(bytes);validateMetadata(p.meta);assert.equal(p.rows.length,620);assert.equal(p.meta.columns.length,55);
  const id=await upload(env,bytes,p);let offset=0,records=[];do{const r=await ok(await req(env,'production?import='+id+'&offset='+offset));records.push(...r.records);offset=r.nextOffset;}while(offset!=null);assert.equal(records.length,620);assert.equal(new Set(records.map(r=>r.id)).size,620);assert.equal(records.at(-1)['수량'],619);
  let raw=[],at=0;do{const r=await ok(await req(env,'imports/'+id+'/rows?offset='+at));raw.push(...r.records);at=r.nextOffset;}while(at!=null);assert.deepEqual(raw.at(-1).values,rows.at(-1));assert.deepEqual(new Uint8Array(await (await req(env,'imports/'+id+'/file')).arrayBuffer()),bytes);
  const round=parseProductionSheet(writeTable(p.meta.columns,raw.map(r=>r.values)));assert.equal(round.rows.length,620);assert.deepEqual(round.rows[619].values,rows[619]);console.log(`Synthetic large XLSX: ${bytes.length} bytes, 620 rows, 55 columns; parse/protocol/export ${Math.round(performance.now()-startTime)}ms (local Node, not production CPU measurement).`);
});

test('PND adherence uses only explicit actual completion dates, reports exclusions and never infers from scheduled/process dates',()=>{
  const row={PND:'2026-10-23','현공정':'납품준비','수량':1,'분류':'AC','생산완료예정일':'2026-10-20','최신공정완료일':'2026-10-20','FAT':'2026-10-20'};
  assert.equal(productionSummary([row],'2026-10-28').adherence.status,'unavailable');
  const s=productionSummary([{...row,'실제완료일':'2026-10-23'},{...row,'실제완료일':'2026-10-24'},{...row,'실제완료일':''},{...row,'현공정':'조립','실제완료일':''},{...row,'실제완료일':'2026-02-30'},{...row,PND:'','실제완료일':'2026-10-23'}],'2026-10-28');
  assert.equal(s.adherence.rate,50);assert.equal(s.adherence.onTime,1);assert.equal(s.adherence.eligible,2);assert.equal(s.adherence.excluded,4);assert.equal(Object.values(s.adherence.reasons).reduce((a,b)=>a+b,0),4);
  assert.equal(productionSummary([{...row,'실제완료일':''}]).adherence.status,'empty');
  assert.equal(productionSummary([{...row,'실제완료일':'2026-10-23','최종완료일':'2026-10-22'}]).adherence.status,'unavailable');
  const malicious=productionSummary([{...row,'분류':'__proto__','현공정':'constructor'},{...row,'분류':'AC / CHILLER'}]);assert.equal(malicious.equipment.__proto__.constructor,1);assert.equal(Object.keys(malicious.equipment).length,2);
});

test('latest is shared, ignores staging, pins every page to one applied import and retains all old rows/originals',async()=>{
  const env=makeEnv();assert.equal((await ok(await req(env,'imports/latest?kind=production'))).record,null);assert.equal((await ok(await req(env,'production'))).importId,null);
  const bytes=writeTable(headers,Array.from({length:205},(_,i)=>['2026-10-23','조립',i,'AC','합성'+i])),plan=parseProductionSheet(bytes),first=await upload(env,bytes,plan);
  const page=await ok(await req(env,'production'));assert.equal(page.importId,first);assert.equal(page.records.length,200);assert.equal(page.nextOffset,200);
  const newer=writeTable(headers,[['2026-10-25','납품준비',2,'DECK','새 합성']]),p=parseProductionSheet(newer),second=await start(env,newer,p);
  assert.equal((await ok(await req(env,'imports/latest?kind=production'))).record.id,first);
  await ok(await req(env,'imports/'+second+'/file','PUT',newer));await ok(await req(env,'imports/'+second+'/chunk','POST',{rows:p.rows}));await ok(await req(env,'imports/'+second+'/ready','POST'));
  env.objects.delete('business/imports/'+second+'.xlsx');assert.equal((await req(env,'imports/'+second+'/apply','POST')).status,409);assert.equal((await ok(await req(env,'imports/latest?kind=production'))).record.id,first);
  env.objects.set('business/imports/'+second+'.xlsx',{bytes:newer});await ok(await req(env,'imports/'+second+'/apply','POST'));
  assert.equal((await ok(await req(env,'production'))).importId,second);const rest=await ok(await req(env,'production?import='+first+'&offset=200'));assert.equal(rest.importId,first);assert.equal(rest.records.length,5);assert.equal(rest.records[4]['수량'],204);
  assert.equal(env.sqlite.prepare('SELECT count(*) n FROM production_rows').get().n,206);assert.equal((await req(env,'imports/'+first+'/file')).status,200);
  const bad=(await req(env,'imports/latest?kind=production','GET',undefined,null));assert.equal(bad.status,401);
});

test('explicit completion titles recover preserved cells and dates while ambiguous or planned titles stay unavailable',async()=>{
  const env=makeEnv(),bytes=writeTable([...headers,'생산 완료일'],[['2026-10-23','납품준비',1,'AC','합성',46318]]),p=parseProductionSheet(bytes),id=await upload(env,bytes,p);
  env.sqlite.prepare("UPDATE production_rows SET data=json_remove(data,'$.실제완료일') WHERE import_id=?").run(id);
  const r=await ok(await req(env,'production'));assert.equal(r.completionFieldState,'present');assert.match(r.records[0]['실제완료일'],/^\d{4}-\d{2}-\d{2}$/);
  const b=writeTable([...headers,'실제완료일','최종완료일'],[['2026-10-23','조립',1,'AC','합성','2026-10-22','2026-10-21']]),plan=parseProductionSheet(b);assert.equal(plan.meta.mapping['실제완료일'],undefined);
  const other=await upload(env,b,plan),ambiguous=await ok(await req(env,'production?import='+other));assert.equal(ambiguous.completionFieldState,'ambiguous');assert.equal(productionSummary(ambiguous.records,undefined,{completionFieldState:ambiguous.completionFieldState}).adherence.status,'unavailable');
});
