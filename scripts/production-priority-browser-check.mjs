// Real Chrome, isolated synthetic SQLite/R2 and independent authentication sessions. No production requests.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {startTestServer} from './local-test-server.mjs';
import {browser} from './browser-harness.mjs';
import {ahuBytes} from '../tests/support/production-parts-fixtures.mjs';
import {ahuPresetFixture} from '../tests/support/ahu-pnd-fixtures.mjs';
import {koreanToday,addDays} from '../business/domain.mjs';
const dir='.wrangler/production-priority-20261123',state=await startTestServer(),qa=await browser(process.argv[2],state.url),today=koreanToday();await mkdir(dir,{recursive:true});
const row=(hull,offset,process,quantity=1)=>['STX',hull,process,offset===null?'':typeof offset==='string'?offset:addDays(today,offset),quantity,'HKA008SN/ITEM-'+hull,'WO-'+hull,'AHU','HKA-08SN','',''];
const bytes=ahuBytes(0,{rows:[row('0001',-9,'조립2[HA2]',3),row('0002',-1,'조립2[HA2]'),row('0003',0,'조립2[HA2]',2),row('0004',6,'조립2[HA2]',4),row('0005',7,'조립2[HA2]',5),row('0006',-5,'완료',6),row('0007',-4,'',7),row('0008','2026-02-30','조립2[HA2]'),row('0009',null,'조립2[HA2]'),row('0010',2,'새 공정',2)]});
try{
 const a=await qa.tab(),b=await qa.tab();
 async function login(t){await t.evaluate(`authUserId.value='owner';authPassword.value=${JSON.stringify(state.password)};void submitAuth()`);await t.wait('window.hpmServerUser?.id==="owner"&&issuesLoaded');}
 await login(a);await login(b);state.failPlanReads=true;await a.evaluate('await navigatePortal("production")');await a.wait('document.querySelector("[data-production-progress]")?.textContent.includes("조회 실패")');assert.equal(await a.evaluate('document.querySelector("[data-priority-count]")'),null);state.failPlanReads=false;
 const settled=t=>t.wait('productionPage.getAttribute("aria-busy")==="false"');
 async function click(t,selector){await t.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await settled(t);}
 await click(a,'[data-part=part2]');
 await a.evaluate(`(()=>{const dt=new DataTransfer();dt.items.add(new File([Uint8Array.from(atob(${JSON.stringify(Buffer.from(bytes).toString('base64'))}),c=>c.charCodeAt(0))],'ERP-공유.xlsx'));const input=document.querySelector('#productionPage [data-file]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await a.wait('!document.querySelector("#productionPage [data-apply]").disabled');await click(a,'#productionPage [data-apply]');await a.wait('document.querySelector("[data-priority-count=overdue]")?.textContent==="2건"');
 const id=await a.evaluate('productionPage.dataset.importId');assert.equal(await a.evaluate('document.querySelector("[data-current]").textContent.includes("기준일 미제공")'),true);assert(await a.evaluate('document.querySelector("[data-current]").textContent.includes("반영자")'));
 assert(await a.evaluate(`(()=>{const r=productionPage;const nodes=['[data-current]','[data-filters]','[data-production-priority]','[data-summary]','[data-process]'].map(s=>r.querySelector(s));return nodes.every((n,i)=>!i||Boolean(nodes[i-1].compareDocumentPosition(n)&Node.DOCUMENT_POSITION_FOLLOWING))})()`));
 for(const key of ['overdue','upcoming','unknown','dates']){await click(a,'[data-priority='+key+']');assert.equal(await a.evaluate('document.querySelector("[data-priority-list-count]").textContent'),'2건');assert.equal(await a.evaluate('document.querySelectorAll("[data-priority-list] tbody tr").length'),2);}
 await click(a,'[data-priority=overdue]');assert.equal(await a.evaluate('document.querySelector("[data-priority-list] tbody tr").children[1].textContent'),'0001');
 state.env.sqlite.prepare('INSERT INTO issues(id,yard,hull_no,product_no,title,description,action_detail,status) VALUES(?,?,?,?,?,?,?,?)').run('linked-issue','KSB','0001','HKA-08SN','기존 공정 문제점','원인 확정 아님','확인 중','접수');
 await click(a,'[data-production-related="0"]');await a.wait('Boolean(document.querySelector(".production-related-dialog[open]"))');assert(await a.evaluate('document.querySelector(".production-related-dialog").textContent.includes("야드 별칭·호선·프로젝트/제품 일치")'));await click(a,'[data-close-related]');
 const before=await a.evaluate('document.querySelector("[data-production-priority]").innerHTML');state.failPlanReads=true;await click(a,'#productionPage [data-refresh-production]');assert.equal(await a.evaluate('document.querySelector("[data-production-priority]").innerHTML'),before);state.failPlanReads=false;
 await b.evaluate('await navigatePortal("production")');await click(b,'[data-part=part2]');assert.equal(await b.evaluate('productionPage.dataset.importId'),id);assert.equal(await b.evaluate('document.querySelector("[data-priority-count=overdue]").textContent'),'2건');assert.equal(await b.evaluate('document.querySelector("#productionPage [data-file]").files.length'),0);
 // Only shared raw rows are fetched for reuse; the original workbook is not downloaded or parsed again.
 await a.evaluate('await navigatePortal("ahuPnd")');await a.wait('ahuPndPage.dataset.ready==="true"');
 await a.evaluate(`(()=>{const select=document.querySelector('[data-reuse-source=erp]');select.value=[...select.options].find(o=>o.textContent.includes('팀 공용'))?.value;document.querySelector('[data-pnd-reuse=erp]').click()})()`);await a.wait('document.querySelector("[data-pnd-message]").textContent.includes("자료 재사용 완료")');assert.equal(await a.evaluate('document.querySelector("[data-pnd-targets]").textContent.includes("ERP 10행")'),true);
 assert.equal(state.requests.filter(r=>r.path.endsWith('/file')&&r.method==='GET').length,0);
 const plan=await ahuPresetFixture('plan','xlsx',sheet=>{for(let r=7;r<=9;r++)sheet.getCell(r,2).value='KSB';});
 await a.evaluate(`(()=>{const dt=new DataTransfer();dt.items.add(new File([Uint8Array.from(atob(${JSON.stringify(Buffer.from(plan.bytes).toString('base64'))}),c=>c.charCodeAt(0))],'생산계획-기준.xlsx'));const input=document.querySelector('[data-file-side=plan]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);await a.wait('document.querySelector("[data-pnd-targets]").textContent.includes("생산계획 3행")');
 await a.evaluate('document.querySelector("[data-pnd-compare]").click()');await a.wait('!document.querySelector("[data-pnd-results]").hidden');assert(await a.evaluate('document.querySelector("[data-pnd-last]").textContent.includes("ERP-공유.xlsx")&&document.querySelector("[data-pnd-last]").textContent.includes("생산계획-기준.xlsx")'));
 // Reusing a plan draft keeps the ERP source and its distinct role intact.
 await a.evaluate('document.querySelector("[data-reuse-source=plan]").value="0";document.querySelector("[data-pnd-reuse=plan]").click()');await a.wait('ahuPndPage.getAttribute("aria-busy")==="false"');assert(await a.evaluate('document.querySelector("[data-pnd-source=erp] [data-file-name]").textContent.includes("ERP-공유.xlsx")'));
 await a.evaluate('await navigatePortal("production")');await settled(a);await click(a,'[data-part=part2]');
 for(const width of [1366,390,320])for(const theme of ['light','dark']){await a.call('Emulation.setDeviceMetricsOverride',{width,height:1050,deviceScaleFactor:1,mobile:false});await a.evaluate(`document.documentElement.dataset.theme='${theme}';document.querySelector('[data-production-priority]').scrollIntoView({block:'start',behavior:'instant'})`);assert(await a.evaluate('document.querySelector("[data-production-priority]").getBoundingClientRect().right<=innerWidth+1'));await a.shot(`${dir}/priority-${width}-${theme}.png`);}
 assert.deepEqual(qa.errors,[]);await writeFile(dir+'/browser-result.json',JSON.stringify({cardsAndListsMatch:true,KSTDates:true,independentSessions:true,sourceMetadata:true,failedReadPreserved:true,sharedRawReuse:true,erpAndBaselineSeparated:true,relatedReadOnly:true,widths:[1366,390,320],themes:['light','dark'],exceptions:0}));console.log('PASS production priority, shared session reads, source metadata, source reuse, role separation, failed reads, record links and responsive light/dark layouts.');
}finally{await qa.close();await state.close();}
