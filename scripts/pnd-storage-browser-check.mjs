// Real IndexedDB and browser restart in an isolated synthetic profile only.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import ExcelJS from 'exceljs/dist/exceljs.min.js';
import {ahuPresetFixture} from '../tests/support/ahu-pnd-fixtures.mjs';
import {passwordHash} from '../business/auth.mjs';
import {startTestServer} from './local-test-server.mjs';
import {browser} from './browser-harness.mjs';
const state=await startTestServer(),dir='.wrangler/pnd-cache-20261111';await mkdir(dir,{recursive:true});
state.env.sqlite.prepare('INSERT INTO portal_accounts(id,name,salt,password_hash,role,status,created_at) VALUES(?,?,?,?,?,?,?)').run('second','합성 다른 계정','synthetic',await passwordHash(state.password,'synthetic'),'user','active',new Date().toISOString());
const make=async(side,changed=false)=>{
 const f=await ahuPresetFixture(side,'xlsx',sheet=>{
  const isErp=side==='erp',header=isErp?2:6;
  sheet.spliceRows(header+1,sheet.rowCount-header);
  for(let i=0;i<135;i++){
   const isHsh=i===0,r=header+i+1,hull=isHsh?'QA-HULL-01':String(i).padStart(5,'0');
   const yard=isHsh?(isErp?'HSH':'HSHI'):'SHI';
   const erpDate=isHsh?(changed?'2027-02-26':'2027-02-18'):['2026-11-15','2026-11-25','2026-11-20'][i%3];
   const cells=isErp?[[4,yard],[5,hull],[8,erpDate],[10,isHsh?'HKA-10SO':'HKA008SN/TEST'],[20,'AHU'],[23,'AHU'],[30,'UNRELATED_WORKBOOK_CELL_DO_NOT_SAVE']]
    :[[1,i+1],[2,yard],[3,hull],[6,isHsh?'HKA-10SO':'HKA-08SN'],[16,isHsh?'2027-02-24':'2026-11-20']];
   for(const [c,v]of cells)sheet.getCell(r,c).value=v;
  }
 });
 f.filename=(changed?'새_':'이전_')+side+'.xlsx';
 const path=resolve(dir,f.filename);await writeFile(path,f.bytes);return {...f,path};
};
const erp=await make('erp'),plan=await make('plan'),newErp=await make('erp',true);
let qa=await browser(process.argv[2],state.url,{persistent:true,keepProfile:true}),t;
async function login(id='owner'){
 await t.wait('document.documentElement.dataset.auth==="anonymous"');await t.evaluate(`authUserId.value='${id}';authPassword.value=${JSON.stringify(state.password)};void submitAuth()`);await t.wait(`window.hpmServerUser?.id==='${id}'&&issuesLoaded`);await t.evaluate('await navigatePortal("ahuPnd")');await t.wait('ahuPndPage.dataset.ready==="true"');
 await importStorage();
}
const importStorage=()=>t.evaluate('window.pndStore=await import("/business/ui/pnd-storage.js?v=20261111-yard")');
const settled=()=>t.wait('ahuPndPage.getAttribute("aria-busy")!=="true"');
async function upload(side,file){const {root}=await t.call('DOM.getDocument'),{nodeId}=await t.call('DOM.querySelector',{nodeId:root.nodeId,selector:`[data-file-side=${side}]`});await t.call('DOM.setFileInputFiles',{nodeId,files:[file.path]});await settled();}
async function click(selector){await t.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await settled();}
const saved=()=>t.evaluate('await pndStore.loadPndSnapshot(hpmServerUser.id,"part2").then(x=>x&&({id:x.snapshot.snapshotId,time:x.snapshot.comparedAt,rows:x.snapshot.rows.length,files:x.snapshot.files,view:x.view,packed:JSON.stringify(x.snapshot)}))');
const stamp=()=>t.evaluate('ahuPndPage.dataset.comparedAt');
async function reload(){const origin=await t.evaluate('performance.timeOrigin');await t.call('Page.reload');await t.wait('performance.timeOrigin!=='+origin+'&&window.hpmServerUser?.id==="owner"&&ahuPndPage.dataset.ready==="true"');}
async function filters(search,status){await t.evaluate(`document.querySelector('[data-pnd-search]').value=${JSON.stringify(search)};document.querySelector('[data-pnd-search]').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-pnd-status]').value=${JSON.stringify(status)};document.querySelector('[data-pnd-status]').dispatchEvent(new Event('change',{bubbles:true}))`);await t.wait(`await pndStore.loadPndSnapshot(hpmServerUser.id,'part2').then(x=>x.view.search===${JSON.stringify(search)}&&x.view.status===${JSON.stringify(status)})`);}
async function exportValues(kind='all'){
 await t.evaluate('window.pndExportBytes=null;if(!window.pndCaptureExport){window.pndCaptureExport=true;const create=URL.createObjectURL;URL.createObjectURL=blob=>{blob.arrayBuffer().then(b=>window.pndExportBytes=Array.from(new Uint8Array(b)));return create(blob)};HTMLAnchorElement.prototype.click=function(){window.pndDownloadName=this.download};}');
 await click('[data-pnd-export='+kind+']');await t.wait('pndExportBytes?.length>0');const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Uint8Array.from(await t.evaluate('pndExportBytes')));return workbook.worksheets[0].getSheetValues();
}
try{
 t=await qa.tab();await login();assert.equal(await saved(),null);assert(await t.evaluate('document.querySelector("[data-pnd-results]").hidden'));
 await upload('erp',erp);await upload('plan',plan);await click('[data-pnd-compare]');await t.wait('Boolean(ahuPndPage.dataset.comparedAt)');
 const fresh=await saved();
 assert.equal(JSON.parse(fresh.packed).algorithm,'erp-minus-plan-v2');
 assert(await t.evaluate('[...document.querySelectorAll("[data-result-id]")].some(r=>["QA-HULL-01","6일 당겨짐","HSH/HSHI 동일 야드 적용"].every(s=>r.textContent.includes(s)))'));
 const hshExport=(await exportValues()).find(cells=>cells?.[2]==='QA-HULL-01');
 assert.deepEqual([hshExport[3],hshExport[4],hshExport[5],hshExport[6],hshExport[11],hshExport[12]],['2027-02-24','2027-02-18',-6,'6일 당겨짐','HSH','HSHI']);
 assert.match(hshExport[20],/HSH\/HSHI 동일 야드 적용/);
 // Seed the previous release's stored decision and reopen the same browser database.
 await t.evaluate(`{
  const {snapshot}=await pndStore.loadPndSnapshot(hpmServerUser.id,'part2');
  snapshot.algorithm='erp-minus-plan-v1';
  const row=snapshot.rows.find(r=>r.hull==='QA-HULL-01');
  row.status='review';row.diff=null;row.label='연결 확인 필요';row.linkBasis='야드 명칭 확인 전 자동 연결 보류';
  row.reasons=['야드 명칭 또는 별칭 연결을 직접 확인하세요.'];row.eligibleCount=0;
  for(const candidate of row.candidates){candidate.eligible=false;candidate.reason='호선·규격 일치 / 일대일 유일성 확인 / 야드 명칭 확인 필요';}
  await pndStore.savePndSnapshot(snapshot);
 }`);
 const first=await saved(),time=first.time;await reload();await importStorage();
 assert.equal((await saved()).packed,first.packed);assert.equal(time,fresh.time);
 assert(await t.evaluate('document.querySelector("[data-pnd-old-rule]").textContent.includes("ERP와 생산계획표 파일을 다시 첨부")'));
 assert(await t.evaluate('[...document.querySelectorAll("[data-result-id]")].some(r=>r.textContent.includes("QA-HULL-01")&&r.textContent.includes("야드 명칭 확인 전 자동 연결 보류"))'));
 assert.equal(first.rows,135);assert(!first.packed.includes('UNRELATED_WORKBOOK_CELL_DO_NOT_SAVE'));assert(!first.packed.includes('"bytes"'));assert.equal(await stamp(),time);
 await filters('','');assert.equal(await t.evaluate('document.querySelectorAll("[data-result-id]").length'),100);await click('[data-result-page=next]');assert.equal(await t.evaluate('document.querySelectorAll("[data-result-id]").length'),35);const allValues=await exportValues();assert.equal(allValues.length,137);
 await filters('0000','delayed');assert.equal(await t.evaluate('document.querySelectorAll("[data-result-id]").length'),3);const filteredValues=await exportValues('filtered');assert.equal(filteredValues.length,5);assert.equal(await stamp(),time);
 await t.evaluate('await navigatePortal("home");await navigatePortal("ahuPnd")');await t.wait('Boolean(ahuPndPage.dataset.comparedAt)');assert.equal(await stamp(),time);
 await reload();await importStorage();assert.equal(await stamp(),time);assert.equal(await t.evaluate('document.querySelectorAll("[data-result-id]").length'),3);assert(await t.evaluate('[...document.querySelectorAll("[data-file-side]")].every(n=>n.files.length===0)&&[...document.querySelectorAll("[data-file-name]")].every(n=>n.textContent.includes("선택한 파일 없음"))'));assert(await t.evaluate('document.querySelector("[data-pnd-last]").textContent.includes("마지막 비교 결과")&&document.querySelector("[data-pnd-last]").textContent.includes("원본 파일은 복원하지 않았습니다")'));
 assert.deepEqual(await exportValues(),allValues);assert.deepEqual(await exportValues('filtered'),filteredValues);
 const profile=qa.profile;assert.deepEqual(qa.errors,[]);await qa.close();qa=await browser(process.argv[2],state.url,{profile,persistent:true});t=await qa.tab();await login();assert.equal(await stamp(),time);assert.deepEqual(await exportValues(),allValues);assert.equal((await saved()).rows,135);
 await click('[data-pnd-part=part1]');assert(await t.evaluate('document.querySelector("[data-pnd-last]").hidden&&document.querySelector("#pnd-part-workspace").hidden'));await click('[data-pnd-part=part2]');assert.equal(await stamp(),time);
 await t.evaluate('const x=await pndStore.loadPndSnapshot(hpmServerUser.id,"part2");const other=structuredClone(x.snapshot);other.part="part1";other.key=JSON.stringify([hpmServerUser.id,"part1"]);other.snapshotId=crypto.randomUUID();await pndStore.savePndSnapshot(other);');assert.equal(await t.evaluate('(await pndStore.loadPndSnapshot(hpmServerUser.id,"part1")).snapshot.part'),'part1');assert.equal((await saved()).id,first.id);
 await upload('erp',newErp);assert.equal(await stamp(),time);assert(await t.evaluate('document.querySelector("[data-pnd-previous]").textContent==="새 파일 비교 전 · 아래는 이전 결과입니다"'));assert(await t.evaluate('document.querySelector("[data-pnd-last]").textContent.includes("이전_erp.xlsx")&&!document.querySelector("[data-pnd-last]").textContent.includes("새_erp.xlsx")'));assert.deepEqual(await exportValues(),allValues);
 await click('[data-pnd-compare]');assert.equal(await stamp(),time);assert.equal((await saved()).id,first.id);assert(await t.evaluate('document.querySelector("[data-pnd-message]").classList.contains("error")'));
 await upload('plan',plan);await t.evaluate('window.pndRealPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==="views")throw new DOMException("Synthetic quota failure","QuotaExceededError");return pndRealPut.apply(this,args)}');await click('[data-pnd-compare]');await t.evaluate('IDBObjectStore.prototype.put=pndRealPut');assert.equal((await saved()).id,first.id);assert.equal(await stamp(),time);assert(await t.evaluate('document.querySelector("[data-pnd-message]").textContent.includes("저장 공간")'));assert.deepEqual(await exportValues(),allValues);
 await t.evaluate('window.pndPost=Worker.prototype.postMessage;Worker.prototype.postMessage=function(m,...args){if(m.type==="compare"){setTimeout(()=>{try{pndPost.call(this,m,...args)}catch{}},1000);return;}return pndPost.call(this,m,...args)}');await t.evaluate('document.querySelector("[data-pnd-compare]").click()');await t.wait('!document.querySelector("[data-pnd-cancel]").hidden');await t.evaluate('document.querySelector("[data-pnd-cancel]").click();Worker.prototype.postMessage=pndPost');await settled();assert.equal((await saved()).id,first.id);assert.equal(await stamp(),time);
 await upload('erp',newErp);await upload('plan',plan);await click('[data-pnd-compare]');const second=await saved();assert.notEqual(second.id,first.id);assert.notEqual(second.time,time);assert.equal(second.files.erp,'새_erp.xlsx');assert(!await t.evaluate('Boolean(document.querySelector("[data-pnd-previous],[data-pnd-old-rule]"))'));assert.notDeepEqual(await exportValues(),allValues);
 const updatedHsh=JSON.parse(second.packed).rows.find(r=>r.hull==='QA-HULL-01');assert.equal(updatedHsh.label,'2일 지연');assert.match(updatedHsh.linkBasis,/HSH\/HSHI 동일 야드 적용/);
 const goodTime=second.time;await t.evaluate('void logoutPortal()');await t.wait('!window.hpmServerUser&&portalWorkspace.hidden');assert(!await t.evaluate('ahuPndPage.textContent.includes("새_erp.xlsx")'));await login('second');assert.equal(await saved(),null);assert.equal(await stamp(),undefined);assert(await t.evaluate('document.querySelector("[data-pnd-results]").hidden'));await t.evaluate('void logoutPortal()');await t.wait('!window.hpmServerUser');await login('owner');assert.equal(await stamp(),goodTime);
 for(const width of [1366,390,320])for(const theme of ['light','dark']){await t.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await t.evaluate(`document.documentElement.dataset.theme='${theme}';scrollTo(0,0)`);assert(await t.evaluate('document.documentElement.scrollWidth<=innerWidth+2'));await t.shot(`${dir}/restored-${width}-${theme}.png`);}
 await t.evaluate('await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(pndStore.PND_DATABASE);r.onsuccess=resolve;r.onerror=()=>reject(r.error)})');await reload();assert.equal(await stamp(),undefined);assert(await t.evaluate('document.querySelector("[data-pnd-results]").hidden'));
 assert.deepEqual(qa.errors,[]);assert(state.requests.filter(r=>r.path.startsWith('/api/business/')).every(r=>r.method==='GET'&&r.path==='/api/business/notices'));assert.equal(state.env.objects.size,0);
 await writeFile(dir+'/browser-result.json',JSON.stringify({realIndexedDB:true,realBrowserRestart:true,rows:135,timePreserved:true,candidatesAndExportsPreserved:true,filtersAndPagination:true,accountAndPartIsolation:true,newFileLabels:true,failedCompareAndQuotaRollbackAndCancelPreserveOld:true,successfulReplacement:true,deletedBrowserDataNotRestored:true,originalFilesNotStored:true,productionUploads:0,exceptions:0}));
 console.log('PASS real IndexedDB/restart; 135-row full results/filter/page/source/candidate/export consistency; original time; new file labels; comparison failure/quota rollback/cancel; successful replacement; account/part separation/logout; data deletion; no original-file storage or uploads; mobile/dark.');
}catch(error){await writeFile(dir+'/failure.json',JSON.stringify({message:error.message,errors:qa.errors,state:await t.evaluate('({auth:window.hpmServerUser?.id,html:document.querySelector("#ahuPndPage").outerHTML,entry:document.documentElement.dataset.auth})').catch(e=>e.message)},null,2));throw error;}finally{await qa.close();await state.close();}
