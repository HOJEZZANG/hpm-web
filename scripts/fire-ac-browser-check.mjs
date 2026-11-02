// Local synthetic AHU responses only; A/C must never request or display them.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {startTestServer} from './local-test-server.mjs';
import {browser} from './browser-harness.mjs';
const state=await startTestServer(),qa=await browser(process.argv[2],state.url),dir='.wrangler/issue-leave-20261102';await mkdir(dir,{recursive:true});
const fireRequests=()=>state.requests.filter(r=>r.path==='/api/fire-status');
try{
  const t=await qa.tab();await t.wait('document.documentElement.dataset.auth==="anonymous"');
  await t.evaluate('window.beforeAcNavigation=true');await t.call('Page.navigate',{url:state.url+'/?ac-direct=1#/fireAc'});await t.wait('!window.beforeAcNavigation&&window.HpmBusiness&&document.documentElement.dataset.auth==="anonymous"');assert.equal(fireRequests().length,0);
  await t.evaluate(`authUserId.value='owner';authPassword.value=${JSON.stringify(state.password)};void submitAuth()`);await t.wait('window.hpmServerUser?.id==="owner"&&issuesLoaded&&fireAcPage.classList.contains("active")');
  assert.equal(await t.evaluate('location.hash'),'#/fireAc');assert.equal(await t.evaluate('fireAcTitle.textContent'),'A/C 공장 소화기 점검 현황');
  assert.match(await t.evaluate('fireAcPage.textContent'),/준비 중입니다\. 점검 시스템 연동 후 현황을 확인할 수 있습니다\./);
  assert.equal(await t.evaluate('document.querySelectorAll("#fireAcPage input,#fireAcPage select,#fireAcPage button,#fireAcPage a,#fireAcPage table").length'),0);
  assert(await t.evaluate('document.querySelector("#portalNavigation [data-page=fireAc]").getAttribute("aria-current")==="page"'));assert.equal(fireRequests().length,0);
  await t.evaluate('window.beforeFireReload=true');await t.call('Page.reload');await t.wait('!window.beforeFireReload&&window.hpmServerUser&&fireAcPage.classList.contains("active")');assert.equal(fireRequests().length,0);
  for(const theme of ['light','dark'])for(const width of [1366,390,320]){
    await t.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});await t.evaluate(`document.documentElement.dataset.theme='${theme}'`);
    assert(await t.evaluate('document.documentElement.scrollWidth<=innerWidth+2'));await t.shot(`${dir}/fire-ac-${theme}-${width}.png`);
  }
  await t.evaluate('await navigatePortal("fireStatus")');await t.wait('!fireStatusTableWrap.hidden');assert.equal(fireRequests().length,1);
  assert.match(await t.evaluate('fireStatusRows.textContent'),/합성 점검 구역/);assert.match(await t.evaluate('fireStatusSummary.textContent'),/5/);
  const link=await t.evaluate('document.querySelector("#fireStatusPage a.fire-source").href');assert(link.startsWith('https://'));assert.equal(await t.evaluate('document.querySelector("#fireStatusPage a.fire-source").target'),'_blank');
  await t.evaluate('fireStatusMonth.value="1";fireStatusMonth.dispatchEvent(new Event("change",{bubbles:true}))');await t.wait('!fireStatusRequest');assert.match(fireRequests().at(-1).query,/month=1(?:&|$)/);
  const count=fireRequests().length;await t.evaluate('document.querySelector("#portalNavigation [data-page=fireAc]").click()');await t.wait('fireAcPage.classList.contains("active")');assert.equal(fireRequests().length,count);
  assert(await t.evaluate('document.querySelector("#portalNavigation [data-page=fireAc]").classList.contains("active")&&!document.querySelector("#portalNavigation [data-page=fireStatus]").classList.contains("active")'));
  await t.evaluate('history.back()');await t.wait('fireStatusPage.classList.contains("active")');await t.wait('!fireStatusRequest');assert.equal(await t.evaluate('fireStatusMonth.value'),'1');
  assert.deepEqual(qa.errors,[]);await writeFile(dir+'/fire-ac-result.json',JSON.stringify({directEntryAndReload:true,independentActiveMenu:true,noAhRequestsOnAc:true,ahuPreserved:true,exceptions:0}));
  console.log('PASS A/C direct entry/login/reload/menu/back, exact preparation text, no AHU data/API/filters/links, mobile/dark; preserved AHU monthly fetch/table/aggregation/external link.');
}finally{await qa.close();await state.close();}
