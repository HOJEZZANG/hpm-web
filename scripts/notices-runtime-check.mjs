// Real workerd/D1 locally, synthetic users and content only.
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'.wrangler/notices-build/worker.js',compatibilityDate:'2026-09-15',d1Databases:['DB'],r2Buckets:['PHOTOS']}));
try{
 const db=await mf.getD1Database('DB');
 for(const file of ['0001_cloudflare_schema.sql','0003_shared_calendars.sql','0004_part1_business.sql','0005_server_identity.sql','0006_employee_access.sql','0007_password_policy.sql','0008_production_parts.sql']){
  const sql=readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8').replace(/--.*$/gm,'').trim();
  for(const statement of sql.split(/;\s*(?=(?:CREATE|ALTER|UPDATE|DROP)\b)/i).map(s=>s.trim().replace(/;$/,'')).filter(Boolean))await db.prepare(statement).run();
 }
 const tokens={};for(const id of ['first','second','reader']){const token=createHash('sha256').update('runtime-'+id).digest('hex');tokens[id]=token;await db.prepare('INSERT INTO portal_accounts(id,name,salt,password_hash,role,status,created_at) VALUES(?,?,?,?,?,?,?)').bind(id,'합성 '+id,'unused','unused',id==='reader'?'user':'admin','active',new Date().toISOString()).run();await db.prepare('INSERT INTO portal_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(createHash('sha256').update(token).digest('hex'),id,'2099-01-01T00:00:00Z').run();}
 async function req(path,method='GET',body,who='first',status=200){const r=await mf.dispatchFetch('http://local.test/api/business/notices'+path,{method,headers:{Origin:'https://hojezzang.github.io',Authorization:'Bearer '+tokens[who],...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.equal(r.status,status,await r.clone().text());return r.json();}
 const initial={title:'합성 공지',content:'원문',mutationId:'create'};await req('/n','PUT',initial);await req('/n','PUT',initial);
 const edit={title:'제목 변경',content:'<script>본문</script>',revision:1,mutationId:'edit'};
 await db.prepare("CREATE TRIGGER synthetic_notice_fail BEFORE INSERT ON portal_audit WHEN json_extract(NEW.details,'$.noticeKind')='updated' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_FAILURE'); END").run();
 await req('/n','PUT',edit,'second',500);assert.equal((await db.prepare('SELECT revision FROM notices WHERE id=?').bind('n').first()).revision,1);assert.equal((await req('/n/history')).records.length,0);
 await db.prepare('DROP TRIGGER synthetic_notice_fail').run();
 await Promise.all([req('/n','PUT',edit,'second'),req('/n','PUT',edit,'second')]);
 const listed=(await req('','GET',undefined,'reader')).records[0];assert.equal(listed.authorName,'합성 first');assert.equal(listed.lastEditorName,'합성 second');assert.equal(listed.revision,2);
 const h=await req('/n/history','GET',undefined,'reader');assert.equal(h.records.length,1);assert.equal(h.records[0].changes.length,2);assert.equal(h.records[0].editorName,'합성 second');
 await req('/n','PUT',{title:listed.title,content:listed.content,revision:2,mutationId:'noop'},'second');assert.equal((await req('/n/history')).records.length,1);assert.equal((await db.prepare('SELECT count(*) n FROM portal_audit').first()).n,2);
 await req('/n','PUT',{...edit,revision:2,mutationId:'forged'},'reader',403);await req('/n/history','DELETE',{},'reader',405);
 const created=listed.createdAt;
 const dated=await req('/n','PUT',{title:listed.title,content:listed.content,noticeDate:'2026-01-15',revision:2,mutationId:'date-change'},'second');
 assert.equal(dated.record.noticeDate,'2026-01-15');assert.equal(dated.record.createdAt,created);assert.equal(dated.record.authorName,'합성 first');
 assert.equal((await req('/n/history')).records[0].changes[0].field,'noticeDate');
 await req('/n','DELETE',{revision:3},'reader',403);await req('/n','DELETE',{revision:2},'first',409);
 const deletion={revision:3,mutationId:'delete-runtime'};
 await db.prepare("CREATE TRIGGER synthetic_delete_fail BEFORE INSERT ON portal_audit WHEN json_extract(NEW.details,'$.noticeKind')='deleted' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_DELETE_FAILURE'); END").run();
 await req('/n','DELETE',deletion,'first',500);assert.equal((await req('')).records.length,1);
 await db.prepare('DROP TRIGGER synthetic_delete_fail').run();
 await Promise.all([req('/n','DELETE',deletion),req('/n','DELETE',deletion)]);
 assert.equal((await req('')).records.length,0);
 assert.equal((await db.prepare("SELECT count(*) n FROM portal_audit WHERE json_extract(details,'$.noticeKind')='deleted'").first()).n,1);
 console.log('PASS real local D1: creator reuse/snapshots; atomic save/history rollback; concurrent response retries exactly once; no-op exclusion; cross-user reads and write/history permissions.');
}finally{await mf.dispose();}
