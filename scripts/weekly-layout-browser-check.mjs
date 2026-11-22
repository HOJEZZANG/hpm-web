// Focused weekly table QA using only isolated synthetic records.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {startTestServer} from './local-test-server.mjs';
import {browser} from './browser-harness.mjs';
const dir='.wrangler/weekly-layout-20261122';await mkdir(dir,{recursive:true});
const state=await startTestServer(),qa=await browser(process.argv[2],state.url);
const fixtures=Array.from({length:24},(_,i)=>({id:'layout-'+i,date:'2026-11-18',part:i<18?'1 PART':'2 PART',project:i%2?'ASP24071805':'HHI P175',product:i%2?'IGG CHILLER':'LOOSE(CONSTANT FLOW V/V, SOL V/V, THERMOSTAT 2EA)',manager:i%2?'권우영':'윤원근',pnd:i%4===0?'2026-11-30':i%4===1?'2026.12.02.':i%4===2?'':'납기 협의 중',problem:(i===10?Array.from({length:160},(_,n)=>`장문 현황 ${n+1}: 제작 및 자재 입고 확인, 조립 진행과 납품 일정 협의 완료.`).join('\n'):'HHI P175 CONSTANT FLOW V/V, SOL V/V, THERMOSTAT 2EA 납품팀 인계 완료\n11/30일까지 도장공정 마무리 목표')+`\nSTATUS_END_${i}`,remark:i%2?'자재 미입고 리스트 확인 필요':'목재 포장 완료',plan:'기존 계획 보존',action:'기존 실행 보존'}));
for(const r of fixtures)state.env.sqlite.prepare('INSERT INTO weekly_issues(id,owner,data,day,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(r.id,'owner',JSON.stringify(r),r.date,'2026-11-18','2026-11-18');
try{
 const t=await qa.tab();
 const view=async(width,height=900)=>t.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
 const click=async selector=>{await t.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);const p=await t.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await t.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await t.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});};
 const filter=async(key,value)=>t.evaluate(`(()=>{const c=document.querySelector('[data-weekly-filter="${key}"]');c.value=${JSON.stringify(value)};c.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 const ids=()=>t.evaluate('[...document.querySelectorAll("#weeklyPage [data-list] [data-detail]")].map(b=>b.dataset.detail).sort()');
 const count=async expected=>{assert.equal((await ids()).length,expected);assert.equal(await t.evaluate('document.querySelector("[data-result-count]").textContent'),`검색 결과 ${expected}건 / 전체 24건`);};
 const reset=()=>t.evaluate('document.querySelector("[data-weekly-reset]").click()');
 await view(1920,1080);await t.evaluate(`openLoginModal('login');authUserId.value='owner';authPassword.value=${JSON.stringify(state.password)};submitAuth()`);await t.wait('window.hpmServerUser?.id==="owner"');
 await t.evaluate('navigatePortal("weekly")');await t.wait('document.querySelector("#weeklyPage").dataset.ready==="true"');
 await t.evaluate('document.querySelector("#weeklyPage [name=week]").value="2026-11-18";document.querySelector("#weeklyPage [name=week]").dispatchEvent(new Event("change"))');await t.wait('document.querySelector("[data-result-count]").textContent.includes("전체 24건")');
 assert.deepEqual(await t.evaluate('[...document.querySelectorAll(".weekly-column-title")].map(n=>n.textContent)'),['파트','프로젝트명','제품','현황','담당자','PND','비고']);
 assert.equal(await t.evaluate('document.querySelectorAll("#weeklyPage [data-list] thead tr").length'),1);await count(24);
 // Actual keyboard insertion must retain the original header input and focus.
 await t.evaluate('window.__header=document.querySelector("[data-weekly-filter=project]");__header.focus()');
 for(const text of ['h','h','i']){await t.call('Input.insertText',{text});assert(await t.evaluate('document.activeElement===__header&&__header===document.querySelector("[data-weekly-filter=project]")'));}
 await count(12);assert.equal(await t.evaluate('__header.selectionStart'),3);
 await filter('part','1 PART');await count(9);await filter('manager','윤원근');await count(9);await filter('product','constant flow');await count(9);await filter('problem','인계 완료');await filter('remark','목재');await count(8);
 await filter('pndMode','range');await filter('pndFrom','2026-11-30');await filter('pndTo','2026-11-30');await count(5);
 await filter('pndFrom','2026-12-02');await count(0);await reset();await count(24);
 await filter('pndMode','range');await filter('pndFrom','2026-12-02');await filter('pndTo','2026-12-02');await count(6);
 await filter('pndMode','empty');await count(6);await filter('pndMode','text');await count(6);await reset();
 await t.evaluate('const f=document.querySelector("#weeklyPage form");f.elements.product.value="작성 중 제품";f.elements.planAction.value="작성 중 계획·실행";f.dispatchEvent(new Event("input",{bubbles:true}))');
 const layout=[];
 for(const width of [1920,1366]){
   await view(width,width===1920?1080:900);
   for(const mode of ['normal','collapsed','meeting']){
     if(mode==='collapsed')await click('#menuToggle');if(mode==='meeting')await click('#weeklyPage [data-meeting]');
     const metrics=await t.evaluate(`(()=>{const w=document.querySelector('.weekly-table-scroll'),table=w.querySelector('table'),cell=table.querySelector('[data-column=problem]');return {bodyOverflow:document.documentElement.scrollWidth>innerWidth+2,table:table.getBoundingClientRect().width,status:cell.getBoundingClientRect().width,font:getComputedStyle(cell).fontSize,wrap:getComputedStyle(cell).whiteSpace,sidebar:getComputedStyle(portalSidebar).display,main:document.querySelector('.portal-main').getBoundingClientRect().width,part:getComputedStyle(table.querySelector('[data-column=part]')).whiteSpace,date:getComputedStyle(table.querySelector('.weekly-date')).whiteSpace}})()`);
     assert(!metrics.bodyOverflow);assert(metrics.status/metrics.table>=.4&&metrics.status/metrics.table<=.5);assert.equal(metrics.font,mode==='meeting'?'15px':'14px');assert.equal(metrics.part,'nowrap');assert.equal(metrics.date,'nowrap');
     if(mode==='collapsed')assert.equal(metrics.sidebar,'none');
     const sticky=await t.evaluate(`(()=>{const w=document.querySelector('.weekly-table-scroll');w.scrollTop=350;const h=w.querySelector('th').getBoundingClientRect(),r=w.getBoundingClientRect();return Math.abs(h.top-r.top)<3&&w.scrollHeight>w.clientHeight})()`);assert(sticky,'sticky header '+width+' '+mode);
     await t.evaluate('document.querySelector(".weekly-table-scroll").scrollTop=0;window.scrollTo(0,0)');await t.shot(`${dir}/${width}-${mode}.png`);layout.push({width,mode,...metrics});
     if(mode==='meeting'){await t.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await click('#menuToggle');}
   }
 }
 // Selected date, all filter values, and the dirty editor survive both toggles.
 await filter('part','1 PART');await filter('manager','윤원근');await filter('pndMode','range');await filter('pndFrom','2026-11-30');await filter('pndTo','2026-11-30');const before=await ids();
 await click('#menuToggle');await click('#weeklyPage [data-meeting]');assert.deepEqual(await ids(),before);await filter('remark','목재');assert.deepEqual(await ids(),before);await click('#weeklyPage [data-meeting]');await click('#menuToggle');
 assert.equal(await t.evaluate('document.querySelector("#weeklyPage [name=week]").value'),'2026-11-18');assert.equal(await t.evaluate('document.querySelector("#weeklyPage form").elements.product.value'),'작성 중 제품');assert.equal(await t.evaluate('document.querySelector("#weeklyPage form").elements.planAction.value'),'작성 중 계획·실행');
 // Mobile overlay works independently of the desktop collapsed preference.
 await click('#menuToggle');await view(390,844);await click('#menuToggle');assert(await t.evaluate('document.body.classList.contains("sidebar-open")'));await click('#menuBackdrop');assert(!await t.evaluate('document.body.classList.contains("sidebar-open")'));await view(1920,1080);assert(await t.evaluate('document.body.classList.contains("sidebar-collapsed")'));await click('#menuToggle');
 // Detail/edit and one-record deletion are still reachable from the compact controls.
 await reset();await t.evaluate('document.querySelector("#weeklyPage form").reset();document.querySelector("#weeklyPage form").dataset.dirty="false"');
 await click('[data-detail="layout-0"]');assert(await t.evaluate('document.querySelector("#weeklyPage dialog").textContent.includes("기존 계획 보존")'));await click('[data-close-detail]');
 await t.evaluate('document.querySelector("[data-edit=layout-0]").closest("details").open=true');await click('[data-edit="layout-0"]');assert.equal(await t.evaluate('document.querySelector("#weeklyPage form").elements.planAction.value'),'계획: 기존 계획 보존\n실행: 기존 실행 보존');
 // Print from both layouts, including offscreen rows and a row longer than one page.
 await filter('part','1 PART');await t.evaluate('window.print=()=>{}');
 const pdfs=[];
 for(const mode of ['normal','meeting']){
   if(mode==='meeting')await click('#weeklyPage [data-meeting]');await t.evaluate('document.querySelector("[data-weekly-print]").click()');
   assert.equal(await t.evaluate('document.querySelectorAll("#weeklyPrintSheet tbody tr").length'),18);
   assert(await t.evaluate('document.querySelector("#weeklyPrintSheet").textContent.includes("STATUS_END_10")'));assert(!await t.evaluate('document.querySelector("#weeklyPrintSheet").textContent.includes("STATUS_END_18")'));
   assert.deepEqual(await t.evaluate('[...document.querySelectorAll("#weeklyPrintSheet th")].map(n=>n.textContent)'),['파트','프로젝트명','제품','현황','담당자','PND','비고']);
   await t.call('Emulation.setEmulatedMedia',{media:'print'});const pdf=await t.call('Page.printToPDF',{printBackground:true,preferCSSPageSize:true});await writeFile(`${dir}/${mode}.pdf`,Buffer.from(pdf.data,'base64'));pdfs.push(`${dir}/${mode}.pdf`);
   await t.call('Emulation.setEmulatedMedia',{media:'screen'});await t.evaluate('window.dispatchEvent(new Event("afterprint"))');
 }
 await click('#weeklyPage [data-meeting]');await filter('project','아무 결과 없음');await t.evaluate('document.querySelector("[data-weekly-print]").click()');assert.equal(await t.evaluate('document.querySelectorAll("#weeklyPrintSheet tbody tr").length'),1);assert(await t.evaluate('document.querySelector("#weeklyPrintSheet").textContent.includes("검색 결과 0건 / 전체 24건")'));await t.evaluate('window.dispatchEvent(new Event("afterprint"))');
 await reset();await t.evaluate('document.querySelector("[data-delete=layout-23]").closest("details").open=true');await click('[data-delete="layout-23"]');await t.wait('document.querySelector("[data-result-count]").textContent.includes("전체 23건")');assert.equal(state.env.sqlite.prepare("SELECT count(*) AS n FROM weekly_issues WHERE id='layout-23'").get().n,0);
 for(const width of [390,320]){await view(width,844);assert(await t.evaluate('document.documentElement.scrollWidth<=innerWidth+2'));await t.shot(`${dir}/${width}-mobile.png`);}
 assert.deepEqual(qa.errors,[]);await writeFile(`${dir}/browser-report.json`,JSON.stringify({layout,pdfs,rows:24,printed:18,focusPreserved:true,combinedFilters:true,draftPreserved:true,sticky:true,mobile:true,productionWrites:0},null,2));
 console.log('PASS weekly filters/focus/count/reset/date modes, seven columns/status 44%/14–15px, sticky headers, desktop menu and mobile overlay, state/draft persistence, detail/edit/delete, filtered full print with 160-line status. Synthetic local data only.');
}finally{await qa.close();await state.close();}
