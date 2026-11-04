// Synthetic local SQLite/R2 only. No production API or business writes.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {writeTable} from '../business/ooxml.mjs';
import {parseProductionSheet,normalizeProductionRow} from '../business/production-sheet.mjs';
import {ahuBytes} from '../tests/support/production-parts-fixtures.mjs';
import {koreanToday,addDays} from '../business/domain.mjs';
import {startTestServer} from './local-test-server.mjs';
import {browser} from './browser-harness.mjs';
const dir='.wrangler/pnd-status-20261104',state=await startTestServer(),qa=await browser(process.argv[2],state.url),today=koreanToday();await mkdir(dir,{recursive:true});
function seed(part,large=false){
 const rows=large?Array.from({length:215},(_,i)=>({id:'ROW-'+i,pnd:today,process:i%3===0?'납품준비 [APR]':i%3===1?(part==='part1'?'조립':'조립2[HA2]'):'',quantity:1,device:part==='part1'?'AC':'AHU'})):[
  ['past',addDays(today,-1),'납품준비 [APR]',100],['today',today,'완료',1],['active',addDays(today,-2),part==='part1'?'조립':'조립2[HA2]',1],['blank',today,'',1],['unknown',addDays(today,-3),'확인되지 않은 공정',1],['future',addDays(today,1),'납품준비',999],['missing','','완료',1],['invalid','2026-02-30','완료',1],['spaced',today,'APR',1]
 ].map(([id,pnd,process,quantity])=>({id,pnd,process,quantity,device:part==='part1'?(['past','future'].includes(id)?'AC':'PROV'):(['past','future'].includes(id)?'AHU':'AHU (특수선)')}));
 // Invalid legacy PND is inserted only into this synthetic fixture after parsing.
 const safe=r=>r.id==='invalid'?'':r.pnd,bytes=part==='part1'?writeTable(['PND','현공정','수량','분류','Yard','HullNo'],rows.map(r=>[safe(r),r.process,r.quantity,r.device,r.id==='active'?'선택 B':'선택 A',r.id])):ahuBytes(rows.length,{rows:rows.map(r=>[r.id==='active'?'선택 B':'선택 A',r.id,r.process,safe(r),r.quantity,'ITEM','WO',r.device,'HKA-08SN','',''])});
 const parsed=parseProductionSheet(bytes,()=>{},part),id=randomUUID(),meta={...parsed.meta,version:2,part,sourceReady:true,phase:'ready'},key='synthetic/'+id+'.xlsx',applied=new Date(Date.now()+1000).toISOString();
 state.env.sqlite.prepare("INSERT INTO plan_imports(id,kind,owner,filename,file_key,sha256,row_count,staged_data,created_at,applied_at,status,production_part) VALUES(?,'production','owner',?,?,?,?,?,?,?,'applied',?)").run(id,'합성-현재현황-'+part+'.xlsx',key,createHash('sha256').update(bytes).digest('hex'),rows.length,JSON.stringify(meta),applied,applied,part);
 parsed.rows.forEach((raw,i)=>{const data=normalizeProductionRow(raw,meta);if(rows[i].id==='invalid'){data.PND=rows[i].pnd;data.__cells[meta.columns.findIndex(c=>c.id===meta.mapping.PND)]=rows[i].pnd;}state.env.sqlite.prepare('INSERT INTO production_rows(id,import_id,row_number,data) VALUES(?,?,?,?)').run(id+'_'+raw.number,id,raw.number,JSON.stringify(data));});state.env.objects.set(key,{bytes});return id;
}
seed('part1');seed('part2');
try{
 const t=await qa.tab();await t.wait('document.documentElement.dataset.auth==="anonymous"');await t.evaluate(`authUserId.value='owner';authPassword.value=${JSON.stringify(state.password)};void submitAuth()`);await t.wait('window.hpmServerUser?.id==="owner"&&issuesLoaded');
 await t.call('Emulation.setTimezoneOverride',{timezoneId:'America/Los_Angeles'});
 const ready=()=>t.wait('productionPage.dataset.ready==="true"&&productionPage.getAttribute("aria-busy")==="false"');
 const click=async selector=>{await t.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await ready();};
 const count=()=>t.evaluate('document.querySelector("[data-adherence-counts]").textContent');
 const rate=()=>t.evaluate('document.querySelector("[data-adherence-rate]").textContent');
 const detailCount=()=>t.evaluate('document.querySelectorAll(".production-adherence-detail tbody tr").length');
 async function filter(name,value){await t.evaluate(`const n=document.querySelector('#productionPage [name=${name}]');n.value=${JSON.stringify(value)};document.querySelector('#productionPage [data-filters]').requestSubmit()`);await ready();}
 await t.evaluate('await navigatePortal("production")');await ready();
 const writes=state.requests.filter(r=>r.method!=='GET').length;
 for(const part of ['part1','part2']){
  await click('[data-part='+part+']');assert.equal(await rate(),'50%');assert.equal(await count(),'PND 도래 6건 중 완료 3건 · 완료 미확인 2건');
  assert.equal(await t.evaluate('document.querySelector("[data-kpi=ready] strong").textContent'),'6건');
  assert.equal(await t.evaluate('[...document.querySelectorAll(".production-track [data-device-status=ready] .production-bar-count")].reduce((n,s)=>n+Number(s.textContent),0)'),6);
  await click('[data-kpi=ready]');assert.equal(await t.evaluate('document.querySelectorAll("[data-list] tbody tr").length'),6);assert(await t.evaluate('document.querySelector("[data-list]").textContent.includes("future")'));assert.equal(await count(),'PND 도래 3건 중 완료 3건 · 완료 미확인 0건');
  await click('[data-clear-selection]');assert.equal(await rate(),'50%');
  assert(await t.evaluate('document.querySelector("[data-current]").textContent.includes("합성-현재현황-'+part+'.xlsx")&&document.querySelector("[data-current]").textContent.includes("한국시간")'));
  assert.equal(await t.evaluate('document.querySelector("[data-kpi=overdue] strong").textContent'),part==='part1'?'1':'3');
  await t.evaluate('document.querySelector("[data-adherence-open]").focus()');
  await t.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});await t.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await t.wait('Boolean(document.querySelector(".production-adherence-detail"))');assert.equal(await detailCount(),6);
  assert(await t.evaluate('document.querySelector(".production-adherence-detail").textContent.includes("원본 현재 공정")&&document.querySelector(".production-adherence-detail").textContent.includes("납품준비 [APR]")'));
  for(const [bucket,n]of [['completed',3],['active',1],['unknown',2],['future',1],['excluded',2]]){await click('[data-adherence-bucket='+bucket+']');assert.equal(await detailCount(),n);}
  assert(await t.evaluate('document.querySelector(".production-adherence-detail").textContent.includes("PND 누락")&&document.querySelector(".production-adherence-detail").textContent.includes("PND 날짜 오류")'));
  assert(await t.evaluate('document.querySelector("[data-adherence-guide]").textContent.includes("실제 완료일 기준의 과거 납기 준수 여부를 판정하는 지표가 아닙니다")'));
  await filter('equipment',part==='part1'?'AC':'AHU');assert.equal(await rate(),'100%');assert.equal(await count(),'PND 도래 1건 중 완료 1건 · 완료 미확인 0건');
  await click('[data-clear-filters]');await click('[data-kpi=unknown]');assert.equal(await rate(),'0%');assert.equal(await count(),'PND 도래 2건 중 완료 0건 · 완료 미확인 2건');
  await click('[data-clear-selection]');await filter('Yard','선택 B');assert.equal(await count(),'PND 도래 1건 중 완료 0건 · 완료 미확인 0건');
  await click('[data-clear-filters]');await filter('from',today);await filter('to',today);assert.equal(await count(),'PND 도래 3건 중 완료 2건 · 완료 미확인 1건');
  await click('[data-clear-filters]');await filter('q','future');assert.equal(await rate(),'산정 대상 없음');await click('[data-adherence-open]');await click('[data-adherence-bucket=future]');assert.equal(await detailCount(),1);
  await filter('q','missing');assert.equal(await rate(),'산정 대상 없음');await click('[data-adherence-bucket=excluded]');assert.equal(await detailCount(),1);
  await filter('q','no-match-at-all');assert.equal(await rate(),'산정 대상 없음');assert.equal(await count(),'PND 도래 0건 중 완료 0건 · 완료 미확인 0건');
  await click('[data-clear-filters]');await click('[data-adherence-open]');
  for(const width of [1366,390,320])for(const theme of ['light','dark']){
   await t.call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await t.evaluate(`document.documentElement.dataset.theme='${theme}';document.querySelector('[data-production-adherence]').scrollIntoView({block:'start',behavior:'instant'})`);
   assert(await t.evaluate('(()=>{const c=document.querySelector("[data-adherence-open]").getBoundingClientRect();return c.left>=0&&c.right<=innerWidth+1&&c.width>0})()'));await t.shot(`${dir}/status-${part}-${width}-${theme}.png`);
  }
 }
 await t.call('Emulation.setDeviceMetricsOverride',{width:1366,height:1000,deviceScaleFactor:1,mobile:false});const large=seed('part1',true);await click('[data-part=part1]');await click('[data-refresh-production]');await t.wait(`productionPage.dataset.importId==='${large}'`);
 assert.equal(await count(),'PND 도래 215건 중 완료 72건 · 완료 미확인 71건');assert.equal(await rate(),'33.5%');await click('[data-adherence-open]');assert.equal(await detailCount(),100);await click('[data-adherence-page="1"]');assert.equal(await detailCount(),100);await click('[data-adherence-page="1"]');assert.equal(await detailCount(),15);
 await t.evaluate('await navigatePortal("home");history.back()');await t.wait('location.hash==="#/production"&&Boolean(document.querySelector(".production-adherence-detail"))');await ready();assert.equal(await detailCount(),15);assert.equal(await rate(),'33.5%');
 assert.equal(state.requests.filter(r=>r.method!=='GET').length,writes);assert.deepEqual(qa.errors,[]);
 await writeFile(dir+'/browser-result.json',JSON.stringify({parts:2,dueAndCompletionCountsMatchDetails:true,sharedProcessRules:true,futureAndDateExclusions:true,emptyAndZeroDistinct:true,filtersSelectionsAndHistory:true,pagination:215,koreanDate:true,widths:[1366,390,320],themes:['light','dark'],exceptions:0,businessWrites:0}));
 console.log('PASS both parts: common completion; due/today/future/unknown/missing/invalid/zero targets; exact numerator, denominator and lists; filters/selections; keyboard; 215-row pagination/history; saved file/time retained; Korean day independent of local timezone; light/dark and narrow layouts; no business writes.');
}finally{await qa.close();await state.close();}
