import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';
import worker from '../worker.js';
import {makeEnv,TOKEN} from './support/env.mjs';
const request=(env,id,body)=>worker.fetch(new Request('https://hpmanagement-web.lotusland1995.workers.dev/api/issues/'+id,{method:'PUT',headers:{Authorization:'Bearer '+TOKEN,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
const save=async(env,id,body)=>{const response=await request(env,id,body),result=await response.json();assert.equal(response.status,200,result.error);return result.issue;};

test('minimal input generates server metadata and title without requiring action or photos; retries do not duplicate history',async()=>{
  const env=makeEnv(),start=Date.now(),draft={description:'  합성 최소\n 문제  ',createdAt:'2099-01-01T00:00:00Z',updatedAt:'2099-01-01T00:00:00Z',registerDate:'2099-01-01',reporter:'위조',reporterId:'forged'};
  const record=await save(env,'minimal',draft);assert.equal(record.title,'합성 최소 문제');assert.equal(record.reporterId,'owner');assert.equal(record.reporter,'등록자');assert(Date.parse(record.createdAt)>=start&&Date.parse(record.createdAt)<=Date.now());assert.equal(record.registerDate,new Date(Date.now()+9*3600000).toISOString().slice(0,10));assert.equal(record.status,'접수');assert.equal(record.actionDetail,'');assert.deepEqual(record.images,[]);assert.deepEqual(record.afterImages,[]);assert.equal(record.history.length,1);assert.equal(record.history[0].actor,'등록자');assert.equal(record.history[0].at,record.createdAt);
  const retry=await save(env,'minimal',draft);assert.deepEqual(retry.history,record.history);assert.equal(retry.createdAt,record.createdAt);
});
test('partial edits preserve every omitted legacy value, free text specs, old title, owner, dates and history prefix',async()=>{
  const env=makeEnv(true),hidden={title:'원래 제목',registerDate:'2020-01-01',process:'조립1',projectNo:'기존 통합 정보',issueType:'기존 유형',priority:'',dueDate:'기존 미지정 날짜',deliveryDate:'',completedDate:'',finder:'기존 발견자',feedbackOwner:'기존 담당',causeFeedback:'기존 원인',verifier:'기존 확인자',prevention:'기존 예방',followupFlag:true,part:'기존 파트',factory:'기존 공장',productNo:'  P-00001 / 原文  ',remark:'기존 비고',yard:'중복 야드',hullNo:'001'};
  await save(env,'legacy',{description:'기존 내용',productNo:hidden.productNo});
  const columns={title:'title',registerDate:'register_date',process:'process',projectNo:'project_no',issueType:'issue_type',priority:'priority',dueDate:'due_date',deliveryDate:'delivery_date',completedDate:'completed_date',finder:'finder',feedbackOwner:'feedback_owner',causeFeedback:'cause_feedback',verifier:'verifier',prevention:'prevention',followupFlag:'followup_flag',part:'part',factory:'factory',productNo:'product_no',remark:'remark',yard:'yard',hullNo:'hull_no'};
  for(const [field,column]of Object.entries(columns))env.sqlite.prepare(`UPDATE issues SET ${column}=? WHERE id=?`).run(field==='followupFlag'?1:hidden[field],'legacy');
  const previous={...env.sqlite.prepare("SELECT * FROM issues WHERE id='legacy'").get()};
  await save(env,'legacy',{description:'변경한 내용',actionDetail:'나중 조치',reporter:'탈취',reporterId:'forged',registerDate:'2099-01-01',createdAt:'2099-01-01T00:00:00Z',history:[{at:'2099-01-01',actor:'위조',note:'가짜'}]});const after={...env.sqlite.prepare("SELECT * FROM issues WHERE id='legacy'").get()};
  for(const column of Object.keys(previous))if(!['description','action_detail','updated_at','history','payload'].includes(column))assert.equal(after[column],previous[column],column);
  assert.deepEqual(JSON.parse(after.history).slice(0,-1),JSON.parse(previous.history));const last=JSON.parse(after.history).at(-1);assert.equal(last.actor,'등록자');assert.match(last.note,/조치내용 변경/);assert(!after.history.includes('위조'));assert.equal(JSON.parse(after.payload).productNo,hidden.productNo);
});
test('after photos use their retained category and never infer a closed status; stale writers cannot overwrite newer hidden values',async()=>{
  const env=makeEnv();await save(env,'photos',{description:'사진 없는 등록'});const key='issues/photos/after/synthetic.png';env.objects.set(key,{bytes:new Uint8Array([137,80,78,71,13,10,26,10]),type:'image/png'});
  const record=await save(env,'photos',{afterImages:[key],actionDetail:'나중 추가'});assert.equal(record.status,'접수');assert(record.afterImages[0].includes('/after/'));assert.equal(record.images.length,0);
  const original=env.DB.batch.bind(env.DB);let interleaved=false;
  env.DB.batch=async statements=>{if(!interleaved){interleaved=true;env.sqlite.prepare('UPDATE issues SET priority=?,description=?,updated_at=?,history=? WHERE id=?').run('다른 PC 우선순위','다른 PC 본문','newer-time',JSON.stringify([...record.history,{actor:'다른 작업자',note:'동시 변경',at:'2026-10-29T12:00:00Z'}]),'photos');}return original(statements);};
  const response=await request(env,'photos',{description:'덮어쓰면 안 됨',productNo:'덮어쓰면 안 됨'});assert.equal(response.status,409);const saved=env.sqlite.prepare("SELECT * FROM issues WHERE id='photos'").get();assert.equal(saved.priority,'다른 PC 우선순위');assert.equal(saved.description,'다른 PC 본문');assert.equal(saved.product_no,'');assert(env.objects.has(key));assert.equal(JSON.parse(saved.history).at(-1).actor,'다른 작업자');
});
test('issue form has only the requested fields and product specs keep their existing storage key',()=>{
  const html=readFileSync('index.html','utf8'),form=html.match(/<form class="issue-entry-form"[\s\S]*?<\/form>/)[0];
  for(const id of ['title','registerDate','projectNo','process','issueType','priority','finder','feedbackOwner','verifier','issueExtra_part','issueExtra_factory','causeFeedback','prevention','followupFlag','dueDate','deliveryDate','completedDate','issueAdditional','historyTimeline'])assert(!new RegExp('id="'+id+'"').test(form),id);
  assert(form.includes('제품 규격'));assert(form.includes('예: HKA-08SN'));assert(form.includes('id="issueExtra_productNo"'));assert.deepEqual([...parseHTML(form).document.querySelectorAll('[required]')].map(n=>n.id),['description']);
});
