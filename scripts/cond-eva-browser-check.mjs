// Synthetic source and HPM SQLite only; every upstream request is intercepted.
import assert from 'node:assert/strict';import {mkdir,writeFile} from 'node:fs/promises';
import {sourceEnv,READ_TOKEN} from '../tests/support/cond-eva-fixtures.mjs';
import {readOnlyProduction} from '../integrations/cond-eva/source-worker/hpm-readonly.mjs';
const source={fetch:readOnlyProduction};
import {startTestServer} from './local-test-server.mjs';import {browser} from './browser-harness.mjs';
const dir='.wrangler/cond-eva-20261117/browser';await mkdir(dir,{recursive:true});
const state=await startTestServer(),upstream=sourceEnv({count:135}),nativeFetch=globalThis.fetch,requests=[];let failure=null,delay=0;
globalThis.fetch=async(input,init={})=>{
 const url=new URL(typeof input==='string'?input:input.url||input.href);
 if(url.origin==='https://hiair-cond-v9.kwy1010.workers.dev'){
  assert.equal(url.pathname,'/api/hpm/production-status');assert.equal(init.method,'GET');requests.push({path:url.pathname,method:init.method});
  if(delay)await new Promise(r=>setTimeout(r,delay));
  if(failure==='network')throw Error(READ_TOKEN);
  if(failure==='partial')return new Response(JSON.stringify({schemaVersion:1,total:136,items:[],hasMore:false,nextCursor:null,revision:'partial',queriedAt:new Date().toISOString()}));
  if(failure==='auth')return new Response(READ_TOKEN,{status:401});
  return source.fetch(new Request(input,init),upstream);
 }
 assert.equal(url.origin,state.url,'QA blocks all other server-side hosts');return nativeFetch(input,init);
};
const qa=await browser(process.argv[2],state.url);
try{
 const t=await qa.tab();await t.call('Emulation.setDeviceMetricsOverride',{width:1366,height:950,deviceScaleFactor:1,mobile:false});await t.wait('document.documentElement.dataset.auth==="anonymous"');
 await t.evaluate('document.querySelector("[data-page=condEva]").click()');assert.equal(requests.length,0);
 await t.evaluate(`authUserId.value='owner';authPassword.value=${JSON.stringify(state.password)};void submitAuth()`);await t.wait('window.hpmServerUser?.id==="owner"&&issuesLoaded');
 const menu=await t.evaluate('[...document.querySelectorAll("#productionMenu>.menu-item")].map(n=>n.dataset.page||n.dataset.service)');assert.equal(menu.indexOf('condEva'),menu.indexOf('pressure')+1);assert.equal(menu.indexOf('ahuPnd'),menu.indexOf('condEva')+1);
 await t.evaluate('document.querySelector("[data-page=condEva]").focus()');await t.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});await t.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await t.wait('condEvaPage.dataset.ready==="true"&&condEvaPage.getAttribute("aria-busy")==="false"');
 assert.equal(await t.evaluate('location.hash'),'#/condEva');assert(await t.evaluate('document.querySelector("[data-page=condEva]").getAttribute("aria-current")==="page"'));
 assert(await t.evaluate('condEvaPage.textContent.includes("연동 설정이 필요")&&condEvaPage.querySelector("[data-cond-results]").hidden'));
 assert.equal(requests.length,0);state.env.HPM_COND_EVA_READ_TOKEN=READ_TOKEN;
 const refresh=async()=>{await t.evaluate('document.querySelector("[data-cond-refresh]").click()');await t.wait('condEvaPage.getAttribute("aria-busy")==="false"');};
 await refresh();await t.wait('!document.querySelector("[data-cond-results]").hidden');
 const first=await t.evaluate('document.querySelector("[data-cond-time]").textContent');assert(first.includes('마지막 조회 성공:')&&first.includes('원본 데이터 최종 수정:'));
 assert.equal(await t.evaluate('document.querySelectorAll("[data-cond-table] tbody tr").length'),100);assert(await t.evaluate('condEvaPage.textContent.includes("전체 135건")'));
 const text=await t.evaluate('condEvaPage.textContent');assert(text.includes('SHELL 요청일')&&text.includes('COND 완료일')&&text.includes('EVA 완료일')&&text.includes('미등록'));
 assert(await t.evaluate('![...condEvaPage.querySelectorAll("button")].some(b=>/저장|수정|삭제|검사 신청|메일|ERP/.test(b.textContent))'));
 await t.evaluate('document.querySelector("[data-cond-next]").click()');assert.equal(await t.evaluate('document.querySelectorAll("[data-cond-table] tbody tr").length'),35);
 for(const query of ['000000','호선 0','프로젝트 0','장비 0']){
  await t.evaluate(`const q=condEvaPage.querySelector('[name=q]');q.value=${JSON.stringify(query)};q.dispatchEvent(new Event('input',{bubbles:true}))`);assert(await t.evaluate('document.querySelectorAll("[data-cond-table] tbody tr").length>0'));
 }
 await t.evaluate('condEvaPage.querySelector("[name=q]").value="000000";condEvaPage.querySelector("form").requestSubmit()');assert.equal(await t.evaluate('document.querySelectorAll("[data-cond-table] tbody tr").length'),1);
 assert.equal(await t.evaluate('document.querySelector("[data-cond-time]").textContent'),first);
 await t.evaluate('document.querySelector("[data-cond-clear]").click()');
 for(const kind of ['network','partial','auth']){failure=kind;await refresh();assert.equal(await t.evaluate('document.querySelector("[data-cond-time]").textContent'),first);assert(await t.evaluate('document.querySelector("[data-cond-status]").textContent.includes("마지막 성공 결과를 유지")'));assert.equal(await t.evaluate('document.querySelectorAll("[data-cond-table] tbody tr").length'),100);}
 failure=null;upstream.sqlite.prepare("UPDATE production_orders SET equipment=?,updated_at='2026-11-17 05:00:00' WHERE work_order='000000'").run('<img src=x onerror=alert(1)>');await refresh();assert.equal(await t.evaluate('document.querySelectorAll("[data-cond-table] img").length'),0);assert(await t.evaluate('document.querySelector("[data-cond-table]").textContent.includes("<img src=x")'));
 for(const width of [1366,390,320])for(const theme of ['light','dark']){
  await t.call('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:false});await t.evaluate(`document.documentElement.dataset.theme='${theme}';scrollTo(0,0)`);
  assert(await t.evaluate('document.documentElement.scrollWidth<=innerWidth+2'));await t.shot(`${dir}/cond-${width}-${theme}.png`);
 }
 await t.call('Emulation.setDeviceMetricsOverride',{width:1366,height:950,deviceScaleFactor:1,mobile:false});
 const before=await t.evaluate('performance.timeOrigin');await t.call('Page.reload');await t.wait(`performance.timeOrigin!==${before}&&window.hpmServerUser?.id==='owner'&&document.querySelector('#condEvaPage[data-ready=true]')`);assert.equal(await t.evaluate('location.hash'),'#/condEva');
 const requestCount=requests.length;delay=400;await t.evaluate('document.querySelector("[data-cond-refresh]").click();void logoutPortal()');await t.wait('window.hpmServerUser===null');await new Promise(r=>setTimeout(r,550));assert(await t.evaluate('!document.querySelector("[data-cond-results]")'));delay=0;
 assert(!JSON.stringify(await t.evaluate('document.documentElement.outerHTML')).includes(READ_TOKEN));assert(upstream.sql.every(sql=>/^SELECT\b/i.test(sql.trim())));assert.deepEqual(qa.errors,[]);
 await writeFile(dir+'/report.json',JSON.stringify({menu,sourceRequests:requests.length,requestCountBeforeLogout:requestCount,rows:135,sourceSqlOnlySelect:true,failuresKeptLastResult:true,secretInBrowser:false,javascriptErrors:qa.errors},null,2));
 console.log('PASS COND/EVA browser: exact menu position/current selection, setup state, 135 rows/search/date summary/paging, refresh and failed/partial/auth result retention, safe text, logout isolation, mobile/dark; source SELECT only.');
}finally{await qa.close();globalThis.fetch=nativeFetch;await state.close();state.env.sqlite.close();upstream.sqlite.close();}
