// Local synthetic ERP snapshots only; the harness blocks production URLs.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {startTestServer} from './local-test-server.mjs';
import {browser} from './browser-harness.mjs';
import {ahuBytes} from '../tests/support/production-parts-fixtures.mjs';
import {parseProductionSheet,normalizeProductionRow} from '../business/production-sheet.mjs';
import {koreanToday,addDays} from '../business/domain.mjs';
const state=await startTestServer(),qa=await browser(process.argv[2],state.url),dir='.wrangler/requests-20261124',today=koreanToday();await mkdir(dir,{recursive:true});
const items=[['HSH','8239','냉매라인 보온작업[HIS]','HKA-01','WO-01','ITEM-01'],['HSM','YZJ2025-1713','조립1[HAI]','HKA-02','WO-02','ITEM-02'],['SHI','2659','조립3[HA3]','10SO','WO-10','ITEM-10'],['SHI','2659','조립3[HA3]','06SO','WO-06','ITEM-06'],['SHI','2659','조립2[HA2]','10SO','WO-10','ITEM-10'],['SHI','2659','조립3[HA3]','10SO','WO-10','ITEM-10'],...Array.from({length:105},(_,i)=>['KSB','PAGE-'+i,'조립2[HA2]','HKA-08','PAGE-WO-'+i,'PAGE-ITEM-'+i])];
let version=0;
function seed(changed=false){
 const input=items.map((v,i)=>{const [yard,hull,process,spec,wo,item]=v;return [yard,hull,changed&&i===0?'납품준비 [APR]':process,addDays(today,i===0?13:i===1?14:-1),1,item,wo,'AHU',spec,'',''];});
 if(changed)input.reverse();const bytes=ahuBytes(0,{rows:input}),parsed=parseProductionSheet(bytes,()=>{},'part2'),id=crypto.randomUUID(),at=new Date(Date.now()+(++version)*1000).toISOString(),meta={...parsed.meta,part:'part2',sourceReady:true,phase:'ready'},key='synthetic/'+id+'.xlsx';
 state.env.sqlite.prepare("INSERT INTO plan_imports(id,kind,owner,filename,file_key,sha256,row_count,staged_data,created_at,applied_at,status,production_part) VALUES(?,'production','owner',?,?,?,?,?,?,?,'applied','part2')").run(id,'합성-실적요청-'+version+'.xlsx',key,createHash('sha256').update(bytes).digest('hex'),parsed.rows.length,JSON.stringify(meta),at,at);parsed.rows.forEach(raw=>state.env.sqlite.prepare('INSERT INTO production_rows(id,import_id,row_number,data) VALUES(?,?,?,?)').run(id+'_'+raw.number,id,raw.number,JSON.stringify(normalizeProductionRow(raw,meta))));state.env.objects.set(key,{bytes});return id;
}
seed();let t;
try{
 t=await qa.tab();await t.evaluate(`authUserId.value='owner';authPassword.value=${JSON.stringify(state.password)};void submitAuth()`);await t.wait('window.hpmServerUser?.id==="owner"&&issuesLoaded');await t.evaluate('await navigatePortal("production");await productionPage.hpmLoadState({part:"part2"})');await t.wait('productionPage.getAttribute("aria-busy")==="false"');
 const click=s=>t.evaluate(`document.querySelector(${JSON.stringify(s)}).click()`),settled=()=>t.wait('productionPage.getAttribute("aria-busy")==="false"'),text=s=>t.evaluate(`document.querySelector(${JSON.stringify(s)}).textContent`);
 await t.evaluate('Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async text=>{window.__copied=text}}})');
 const pick=async(n)=>click(`#productionPage [data-list] tbody tr:nth-child(${n}) [data-request-pick]`);
 for(let n=1;n<=6;n++)await pick(n);
 assert.equal(await text('[data-request-selection-count]'),'선택 6건');await click('[data-plan-next]');await pick(1);assert.equal(await text('[data-request-selection-count]'),'선택 7건');await click('[data-plan-prev]');
 await t.evaluate('const q=productionPage.querySelector("[name=q]");q.value="YZJ2025";q.dispatchEvent(new Event("input",{bubbles:true}))');await t.wait('productionPage.querySelector("[data-list] h2").textContent==="조회 결과 1건"');assert((await text('.request-toolbar')).includes('현재 조회 1건 · 조회 밖 6건'));
 await click('[data-request-open]');assert.equal(await t.evaluate('document.querySelectorAll("[data-request-confirmed]:checked").length'),0);assert(await t.evaluate('document.querySelector("[data-request-copy]").disabled'));
 // All choices are explicit. Editing preserves keyboard focus and clears the old confirmation.
 // Resolve each current node because each change redraws the confirmation area.
 for(let n=1;n<=7;n++)await t.evaluate(`const c=document.querySelector('[data-request-confirmed="${n}"]');if(!c.checked)c.click()`);
 await click('[data-request-remove="7"]');await click('[data-request-copy]');await t.wait('window.__copied?.includes("[실적 미처리 현황]")');
 const expected='[실적 미처리 현황]\nHSH 8239 냉매라인 보온작업[HIS]\nHSM YZJ2025-1713 조립1[HAI]\nSHI 2659 (10SO) 조립3[HA3]\nSHI 2659 (06SO) 조립3[HA3]\nSHI 2659 (10SO) 조립2[HA2]';assert.equal(await t.evaluate('window.__copied'),expected);assert((await text('.request-preview')).includes('동일 항목·규격·공정 중복 1건 제외'));
 await t.evaluate(`const p=document.querySelector('[data-request-process="2"]');p.focus();p.value='조립1[HAI]';p.dispatchEvent(new Event('input',{bubbles:true}))`);assert(await t.evaluate('document.activeElement.dataset.requestProcess==="2"'));assert.equal(await t.evaluate(`document.querySelector('[data-request-confirmed="2"]').checked`),false);await click('[data-request-confirmed="2"]');
 await t.evaluate('const p=document.querySelector("[data-request-preview]");p.value+="\\n현장 확인 후 처리 부탁드립니다.";p.dispatchEvent(new Event("input",{bubbles:true}))');await click('[data-request-copy]');await t.wait('window.__copied?.endsWith("현장 확인 후 처리 부탁드립니다.")');
 await t.evaluate('const p=document.querySelector("[data-request-preview]");p.value="";p.dispatchEvent(new Event("input",{bubbles:true}))');assert(await t.evaluate('document.querySelector("[data-request-copy]").disabled'));await click('[data-request-rebuild]');
 // Copy always checks the current import first. A newer snapshot changes process and row positions.
 const next=seed(true);await click('[data-request-copy]');await t.wait(`productionPage.dataset.importId===${JSON.stringify(next)}&&!document.querySelector('[data-request-copy]').textContent.includes('확인 중')`);assert(await t.evaluate('document.querySelector("[data-request-copy]").disabled'));assert.equal(await t.evaluate('document.querySelectorAll("[data-request-confirmed]:checked").length'),0);assert((await text('.request-items')).includes('ERP 공정 변경'));assert((await text('.request-items')).includes('납품준비 [APR]'));
 for(const n of [1,2,4])await click(`[data-request-confirmed="${n}"]`);for(const n of [3,5,6]){assert(await t.evaluate(`Boolean(document.querySelector('[data-request-match="${n}"]'))`));await t.evaluate(`const s=document.querySelector('[data-request-match="${n}"]');s.value=s.options[1].value;s.dispatchEvent(new Event('change',{bubbles:true}))`);await click(`[data-request-confirmed="${n}"]`);}
 state.failPlanReads=true;await click('[data-request-copy]');await t.wait('productionPage.querySelector("[data-production-progress]").textContent.includes("조회 실패")');assert(await t.evaluate('document.querySelector("[data-request-copy]").disabled'));assert.equal(await text('[data-request-selection-count]'),'선택 6건');state.failPlanReads=false;await click('[data-refresh-production]');await settled();
 assert.equal(await text('[data-request-status]'),'');await t.evaluate('loginSuccess.classList.remove("show")');
 for(const [width,height]of [[1366,768],[1920,1080],[390,844]])for(const theme of ['light','dark']){
  await t.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await t.evaluate(`document.documentElement.dataset.theme='${theme}';document.querySelector('.request-editor').scrollIntoView({block:'start',behavior:'instant'})`);assert(await t.evaluate('document.documentElement.scrollWidth<=innerWidth+2'));assert(await t.evaluate('[...document.querySelectorAll(".request-editor input[type=text],.request-editor select,.request-preview textarea")].every(e=>e.getBoundingClientRect().right<=innerWidth+1)'));await t.shot(`${dir}/request-${width}-${theme}.png`);
 }
 await click('[data-request-clear]');assert.equal(await text('[data-request-selection-count]'),'선택 0건');assert.equal(await t.evaluate('document.querySelectorAll("[data-request-pick]:checked").length'),0);assert(state.requests.filter(r=>r.path.includes('/business/')).every(r=>r.method==='GET'));assert.deepEqual(qa.errors,[]);await writeFile(dir+'/browser-result.json',JSON.stringify({explicitConfirmation:true,distinctSpecsAndProcesses:true,exactDeduplication:true,editableCopy:true,filterAndPageSelection:true,reconcileNewImport:true,ambiguousIdentityReviewed:true,failureRetainsDraft:true,keyboardFocus:true,desktopMobileLightDark:true,productionWrites:0,exceptions:0},null,2));console.log('PASS performance request selection, confirmation, spec/process distinction, exact plain-text copy/editing, snapshot reconciliation, read-only behavior and responsive layouts.');
}catch(error){await writeFile(dir+'/failure.json',JSON.stringify({message:error.message,exceptions:qa.errors,html:await t?.evaluate('productionPage.outerHTML').catch(()=>null)},null,2));if(t)await t.shot(dir+'/failure.png');throw error;}finally{await qa.close();await state.close();}
