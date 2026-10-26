// Browser upload -> mapping -> explicit AHU selection -> comparison -> actual XLSX download.
// All input files and accounts are synthetic; harness blocks external network requests.
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import ExcelJS from 'exceljs';
import {ahuFixture} from '../tests/support/ahu-pnd-fixtures.mjs';
import {startTestServer} from './local-test-server.mjs';
import {browser} from './browser-harness.mjs';
const state=await startTestServer(),qa=await browser(process.argv[2],state.url),downloadPath=mkdtempSync(resolve('.wrangler/ahu-pnd-downloads-'));
try{
  const tab=await qa.tab();await tab.evaluate(`openLoginModal('login');authUserId.value='owner';authPassword.value=${JSON.stringify(state.password)};submitAuth()`);
  await tab.wait('window.hpmServerUser?.id==="owner"&&issuesLoaded&&calendarState.as.loaded&&calendarState.team.loaded');
  await tab.evaluate(`document.querySelector('#productionMenu [data-page=ahuPnd]').click()`);await tab.wait('document.querySelector("#ahuPndPage[data-ready=true]")');
  assert.equal(await tab.evaluate('location.hash'),'#/ahuPnd');const requestsBefore=state.requests.length;
  async function settled(){await tab.wait('document.querySelector("#ahuPndPage").getAttribute("aria-busy")!=="true"');}
  async function change(side,key,value){await tab.evaluate(`(()=>{const el=document.querySelector('[data-pnd-source=${side}] [data-config=${key}]');el.value=${JSON.stringify(String(value))};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);await settled();}
  async function upload(side,fixture){
    const base64=Buffer.from(fixture.bytes).toString('base64');await tab.evaluate(`(()=>{const dt=new DataTransfer();dt.items.add(new File([Uint8Array.from(atob(${JSON.stringify(base64)}),c=>c.charCodeAt(0))],${JSON.stringify(fixture.filename)},{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const input=document.querySelector('[data-file-side=${side}]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);await settled();
    await tab.wait(`document.querySelector('[data-pnd-source=${side}] [data-config=sheet]')?.options.length===3`);
    await change(side,'sheet',fixture.sheetIndex);await change(side,'header',fixture.header);
    for(const [key,value]of [['yard',2],['hull',3],['pnd',4],['filterCol',1],['filterMode','exact'],['filterValue','가상 AHU']])await change(side,key,value);
    assert(await tab.evaluate(`document.querySelector('[data-pnd-source=${side}] [data-source-count]').textContent.includes('AHU 선택 0행')`));
    await tab.evaluate(`document.querySelector('[data-pnd-source=${side}] [data-source-action=select]').click()`);
  }
  const erp=await ahuFixture('erp'),plan=await ahuFixture('plan');await upload('erp',erp);await upload('plan',plan);
  async function compare(){await tab.evaluate('document.querySelector("[data-pnd-compare]").click()');await settled();}
  await compare();await tab.wait('!document.querySelector("[data-pnd-results]").hidden');
  assert.equal(await tab.evaluate('document.querySelectorAll("[data-result-status=advanced]").length'),2);
  assert.equal(await tab.evaluate('document.querySelectorAll("[data-result-status=delayed]").length'),1);
  assert.equal(await tab.evaluate('document.querySelector("[data-pnd-table] tbody tr").children[1].textContent'),'00102');
  assert.equal(await tab.evaluate('document.querySelectorAll("[data-pnd-table] tbody tr").length'),15);
  const text=await tab.evaluate('document.querySelector("[data-pnd-table]").textContent');for(const value of ['9일 당겨짐','3일 지연','일치','중복 확인 필요','빈 날짜','존재하지','호선번호 누락','ERP에 해당 항목 없음','생산계획에 해당 항목 없음','00123','H-00A','가상 ERP 자료','행'])assert(text.includes(value),value);
  assert.equal(await tab.evaluate(`getComputedStyle(document.querySelector('[data-pnd-table] .pnd-advanced')).color`),'rgb(174, 41, 55)');
  assert.equal(await tab.evaluate(`getComputedStyle(document.querySelector('[data-pnd-table] .pnd-delayed')).color`),'rgb(152, 68, 0)');
  await tab.evaluate(`document.querySelector('[data-alias-source]').value='가상 별칭 야드';document.querySelector('[data-alias-target]').value='가상 정식 야드';document.querySelector('[data-alias-add]').click()`);
  await compare();assert(await tab.evaluate('document.querySelector("[data-pnd-message]").textContent.includes("직접 확인")'));
  await tab.evaluate(`document.querySelector('[data-alias-confirm]').click()`);await compare();await tab.wait('!document.querySelector("[data-pnd-results]").hidden');
  const allCount=await tab.evaluate('document.querySelectorAll("[data-pnd-table] tbody tr").length');assert.equal(allCount,14);
  await tab.evaluate(`document.querySelector('[data-pnd-search]').value='0010';document.querySelector('[data-pnd-search]').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-pnd-status]').value='advanced';document.querySelector('[data-pnd-status]').dispatchEvent(new Event('change',{bubbles:true}))`);
  assert.equal(await tab.evaluate('document.querySelectorAll("[data-pnd-table] tbody tr").length'),2);
  await tab.browserCall('Browser.setDownloadBehavior',{behavior:'allow',downloadPath,browserContextId:tab.browserContextId});
  async function download(kind){await tab.evaluate(`document.querySelector('[data-pnd-export=${kind}]').click()`);await settled();const end=Date.now()+10000;let name;while(Date.now()<end){name=readdirSync(downloadPath).find(n=>n.endsWith('.xlsx')&&n.includes(kind==='all'?'전체':'필터'));if(name)break;await new Promise(r=>setTimeout(r,50));}assert(name,'Browser must download an actual XLSX file');const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(readFileSync(join(downloadPath,name)));return workbook.worksheets[0];}
  const filtered=await download('filtered');assert.equal(filtered.rowCount,3);assert.equal(filtered.getCell('B2').value,'00102');assert.equal(filtered.getCell('F2').value,'9일 당겨짐');assert(String(filtered.getCell('H2').value).includes('가상 ERP 자료'));
  const all=await download('all');assert.equal(all.rowCount,allCount+1);assert([...Array(allCount)].some((_,i)=>all.getCell('F'+(i+2)).value==='중복 확인 필요'));
  assert.equal(state.requests.length,requestsBefore,'File contents/results must never be sent to an API');
  await tab.evaluate(`navigatePortal('home')`);await tab.evaluate('history.back()');await tab.wait('location.hash==="#/ahuPnd"');assert.equal(await tab.evaluate('document.querySelector("[data-pnd-search]").value'),'0010');assert.equal(await tab.evaluate('document.querySelectorAll("[data-result-status=advanced]").length'),2);
  await tab.evaluate(`document.getElementById('themeToggle').click()`);assert.equal(await tab.evaluate('document.documentElement.dataset.theme'),'dark');assert.equal(await tab.evaluate(`getComputedStyle(document.querySelector('[data-pnd-table] .pnd-advanced')).color`),'rgb(255, 172, 184)');
  for(const [width,height]of [[1366,900],[390,844],[320,740]]){await tab.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});assert(await tab.evaluate(`document.documentElement.scrollWidth<=innerWidth+2&&innerWidth<=${width+2}`),'No body overflow or viewport shrinking at '+width);await tab.shot('.wrangler/ahu-pnd-'+width+'.png');}
  // Replacing one file invalidates old results and selections. Invalid input leaves a clear error.
  await tab.evaluate(`(()=>{const dt=new DataTransfer();dt.items.add(new File(['bad ZIP'],'가상_오류.xlsx'));const input=document.querySelector('[data-file-side=erp]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);await settled();assert(await tab.evaluate('document.querySelector("[data-pnd-message]").classList.contains("error")'));assert(await tab.evaluate('document.querySelector("[data-pnd-results]").hidden'));assert(await tab.evaluate('document.querySelector("[data-pnd-source=plan]").textContent.includes("가상_생산계획.xlsx")'));
  await upload('erp',erp);await compare();await tab.wait('!document.querySelector("[data-pnd-results]").hidden');assert.equal(await tab.evaluate('document.querySelectorAll("[data-pnd-table] tbody tr").length'),2,'Search/status filters remain explicit after recompare');
  await change('erp','filterValue','가상 분류 없음');await tab.evaluate(`document.querySelector('[data-pnd-source=erp] [data-source-action=select]').click()`);await compare();assert(await tab.evaluate('document.querySelector("[data-pnd-message]").textContent.includes("대조 완료")'));
  await tab.evaluate(`document.querySelector('[data-pnd-search]').value='';document.querySelector('[data-pnd-search]').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-pnd-status]').value='';document.querySelector('[data-pnd-status]').dispatchEvent(new Event('change',{bubbles:true}))`);assert.equal(await tab.evaluate('document.querySelectorAll("[data-result-status]:not([data-result-status=review])").length'),0);assert(await tab.evaluate('document.querySelector("[data-pnd-table]").textContent.includes("ERP에 해당 항목 없음")'));
  assert.deepEqual(qa.errors,[]);assert(state.requests.slice(requestsBefore).every(r=>r.method==='GET'&&r.path==='/api/business/notices'),'Only the existing home notice read is allowed during navigation');
  await tab.evaluate('logoutPortal()');await tab.wait('window.hpmServerUser===null');assert(!await tab.evaluate('document.querySelector("#ahuPndPage").textContent.includes("가상_ERP.xlsx")'));
  console.log('PASS AHU PND: synthetic dual workbook upload, arbitrary sheets/headers/mapping, explicit mixed-product selection, zero-prefixed identifiers, all comparison states, confirmed aliases, source rows, sorting/filtering, real full/filtered XLSX downloads, navigation, dark theme/mobile, replacement/error/recompare/logout. No comparison API requests.');
  console.log('Synthetic browser downloads: '+downloadPath);
}finally{await qa.close();await state.close();}
