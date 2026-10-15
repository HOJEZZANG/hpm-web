import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {startTestServer} from './local-test-server.mjs';
import {template} from '../business/excel.mjs';
const executable=process.argv[2];if(!executable)throw new Error('Pass a Chrome/Edge executable path.');
const state=await startTestServer(),profile=mkdtempSync(join(tmpdir(),'hpm-business-qa-'));
const chrome=spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true});
let socket;const errors=[];
try{
  const wsUrl=await new Promise((resolve,reject)=>{let logs='';const timer=setTimeout(()=>reject(new Error('Browser startup timeout')),20000);chrome.on('error',reject);chrome.stderr.on('data',chunk=>{logs+=chunk;const match=logs.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});});
  socket=new WebSocket(wsUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  const pending=new Map(),handlers=new Map();let sequence=0;
  socket.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}else for(const h of handlers.get(m.method)||[])Promise.resolve(h(m.params,m.sessionId)).catch(e=>errors.push(e.stack));};
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  const on=(method,fn)=>handlers.set(method,[...(handlers.get(method)||[]),fn]);
  on('Runtime.exceptionThrown',p=>errors.push(p.exceptionDetails.exception?.description||p.exceptionDetails.text));
  on('Page.javascriptDialogOpening',(_,session)=>send('Page.handleJavaScriptDialog',{accept:true},session));
  on('Fetch.requestPaused',(p,session)=>p.request.url.startsWith(state.url)?send('Fetch.continueRequest',{requestId:p.requestId},session):send('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:404,body:''},session));
  async function tab(){const context=await send('Target.createBrowserContext');const {targetId}=await send('Target.createTarget',{url:'about:blank',browserContextId:context.browserContextId});const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});const call=(method,params)=>send(method,params,sessionId);await call('Page.enable');await call('Runtime.enable');await call('Fetch.enable',{patterns:[{urlPattern:'*'}]});
    const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
    const wait=async(expression,label=expression)=>{const end=Date.now()+15000;while(Date.now()<end){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,60));}throw new Error('Timed out: '+label);};
    await call('Page.navigate',{url:state.url});await wait('document.querySelector("#homePage.active")');return {call,evaluate,wait};
  }
  const a=await tab(),b=await tab();
  async function login(t){await t.evaluate(`openLoginModal('login');authUserId.value='owner';authPassword.value=${JSON.stringify(state.password)};submitAuth();`);await t.wait('window.hpmServerUser?.id==="owner"');await t.wait('issuesLoaded && calendarState.as.loaded && calendarState.team.loaded');}
  await login(a);await login(b);
  assert.notEqual(await a.evaluate('sessionStorage.getItem("hpmServerToken")'),await b.evaluate('sessionStorage.getItem("hpmServerToken")'));
  async function form(t,page,values){await t.evaluate(`navigatePortal(${JSON.stringify(page)})`);await t.wait(`document.getElementById('${page}Page').dataset.ready==='true'`);await t.evaluate(`(()=>{const f=[...document.querySelectorAll('#${page}Page form')].find(f=>Object.keys(${JSON.stringify(values)}).every(k=>f.elements[k]));for(const [k,v] of Object.entries(${JSON.stringify(values)}))f.elements[k].value=v;f.dispatchEvent(new Event('input',{bubbles:true}));f.requestSubmit();})()`);}
  const day=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  await form(a,'weekly',{date:day,part:'1 PART',product:'브라우저 합성제품',manager:'합성 담당',problem:'합성 문제',pnd:'합성PND',plan:'합성 계획',action:'합성 실행',remark:'합성 비고'});
  await a.wait('document.querySelector("#weeklyPage [data-message]").textContent.includes("저장")');
  await b.evaluate('navigatePortal("weekly")');await b.wait('document.querySelector("#weeklyPage [data-list]")?.textContent.includes("브라우저 합성제품")');
  console.log('PASS two isolated browser sessions: separate server sessions read the same persisted weekly issue.');
  state.failWrites=true;
  await a.evaluate('document.querySelector("#weeklyPage [data-new]").click();document.querySelector("#weeklyPage [name=product]").value="실패 시 보존";document.querySelector("#weeklyPage [name=manager]").value="합성 담당";document.querySelector("#weeklyPage [name=problem]").value="보존할 내용";document.querySelector("#weeklyPage form").requestSubmit();');
  await a.wait('document.querySelector("#weeklyPage [data-message]").textContent.includes("실패")');assert.equal(await a.evaluate('document.querySelector("#weeklyPage [name=product]").value'),'실패 시 보존');state.failWrites=false;
  await a.evaluate('document.querySelector("#weeklyPage form").requestSubmit()');await a.wait('document.querySelector("#weeklyPage [data-list]").textContent.includes("실패 시 보존")');
  const expiredToken=await a.evaluate('sessionStorage.getItem("hpmServerToken")');state.env.sqlite.prepare('DELETE FROM portal_sessions WHERE token_hash=?').run(createHash('sha256').update(expiredToken).digest('hex'));
  await a.evaluate('document.querySelector("#weeklyPage [name=product]").value="만료 시 입력 보존";document.querySelector("#weeklyPage form").requestSubmit()');await a.wait('document.getElementById("authModal").classList.contains("show")');await login(a);assert.equal(await a.evaluate('document.querySelector("#weeklyPage [name=product]").value'),'만료 시 입력 보존');await a.evaluate('document.querySelector("#weeklyPage form").requestSubmit()');await a.wait('document.querySelector("#weeklyPage [data-list]").textContent.includes("만료 시 입력 보존")');
  await form(a,'safety',{factory:'AC공장 (B1)',date:day,inspector:'합성 점검자',check0:'양호',check1:'양호',check2:'양호',check3:'양호',check4:'양호',abnormal:'',action:''});await a.wait('document.querySelector("#safetyPage [data-message]").textContent.includes("저장")');
  console.log('PASS weekly failure preserves input and retry; safety form saves and reads actual server records.');
  // Configure vehicles/people through the actual APIs, then exercise their UI workflows.
  await a.evaluate(`apiRequest('/api/business/vehicles/browser-car',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({number:'합성 차량'})})`);
  await form(a,'vehicles',{vehicleId:'browser-car',date:day,start:'09:00',end:'12:00',applicant:'합성 신청',purpose:'합성 용도',remark:'합성 비고'});await a.wait('document.querySelector("#vehiclesPage > [data-list]").textContent.includes("합성 용도")');
  await a.evaluate('document.querySelector("#vehiclesPage > form [data-new]").click();(()=>{const f=document.querySelector("#vehiclesPage form:has([name=vehicleId])");f.elements.vehicleId.value="browser-car";f.elements.applicant.value="합성 신청";f.elements.purpose.value="충돌 시 보존";f.elements.start.value="11:00";f.elements.end.value="13:00";f.requestSubmit()})()');await a.wait('document.querySelector("#vehiclesPage [data-message]").textContent.includes("겹칩니다")');
  assert.equal(await a.evaluate('document.querySelector("#vehiclesPage form:has([name=vehicleId])").elements.purpose.value'),'충돌 시 보존');
  await a.evaluate(`apiRequest('/api/business/people/browser-person',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'합성 식수 인원',department:'합성 부서'})})`);
  await a.evaluate('navigatePortal("meals")');await a.wait('document.querySelector("#mealsPage [data-person]")');await a.evaluate('document.querySelector("#mealsPage [data-person]").click();document.querySelector("#mealsPage [data-save]").click()');await a.wait('document.querySelector("#mealsPage [data-message]").textContent.includes("저장")');
  console.log('PASS vehicle UI saves and rejects overlapping times without losing input; meal grid saves to shared server.');
  const production=Buffer.from(await template('production')).toString('base64');
  await a.evaluate('navigatePortal("production")');await a.wait('document.querySelector("#productionPage [data-file]")');
  await a.evaluate(`(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(production)}),c=>c.charCodeAt(0)),f=new File([bytes],'합성계획.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),dt=new DataTransfer();dt.items.add(f);document.querySelector('#productionPage [data-file]').files=dt.files;document.querySelector('#productionPage [data-preview]').click();})()`);
  await a.wait('document.querySelector("#productionPage [data-apply]")');assert.equal(state.env.sqlite.prepare('SELECT COUNT(*) n FROM production_rows').get().n,0);
  await a.evaluate('document.querySelector("#productionPage [data-apply]").click()');await a.wait('document.querySelector("#productionPage [data-list]")?.textContent.includes("예시조선소")');assert.equal(state.env.sqlite.prepare('SELECT COUNT(*) n FROM production_rows').get().n,1);
  console.log('PASS browser Excel upload -> preview -> explicit apply -> production summary; preview writes no live rows.');
  for(const page of ['supplies','notices','search','accounts']){await a.evaluate('navigatePortal('+JSON.stringify(page)+')');await a.wait(`document.querySelector('#${page}Page [data-message]')`);}
  await a.evaluate('navigatePortal("search");document.querySelector("#searchPage [name=q]").value="브라우저";document.querySelector("#searchPage form").requestSubmit()');await a.wait('document.querySelector("#searchPage [data-results]").textContent.includes("브라우저 합성제품")');
  // Existing issue/calendar UI remains usable with server authentication.
  await a.evaluate('navigatePortal("issue","manage");resetForm();title.value="기존 문제 합성 검증";product.value="AHU";process.value="조립";issueType.value="기타";responsibleDept.value="A/C생산팀";processPnd.value=todayStr();projectNo.value="YARD / H1";description.value="합성 설명";document.getElementById("issueForm").requestSubmit()');
  await a.wait('issues.some(i=>i.title==="기존 문제 합성 검증")');
  await a.wait('!issueBusy');await a.evaluate('editIssue(issues.find(i=>i.title==="기존 문제 합성 검증").id)');
  await a.evaluate(`(()=>{const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBzQAAAAASUVORK5CYII='),c=>c.charCodeAt(0)),dt=new DataTransfer();dt.items.add(new File([png],'synthetic.png',{type:'image/png'}));photoInput.files=dt.files;photoInput.dispatchEvent(new Event('change'));})()`);
  await a.wait('currentImages.length===1 && !issueBusy');
  await a.evaluate('document.getElementById("issueForm").requestSubmit()');await a.wait('issues.some(i=>i.title==="기존 문제 합성 검증"&&i.images.length===1)&&!issueBusy');await a.evaluate('editIssue(issues.find(i=>i.title==="기존 문제 합성 검증").id)');
  await a.wait('document.querySelector("#previewGrid img")?.getAttribute("src")?.startsWith("blob:")');
  await a.evaluate('document.querySelector("#previewGrid img").click()');await a.wait('document.getElementById("photoLightboxImage").src.startsWith("blob:")');await a.evaluate('closePhotoLightbox()');
  await a.evaluate('navigatePortal("as")');await a.wait('calendarState.as.loaded&&!calendarState.as.busy');await a.evaluate('openNewCalendar("as")');await a.wait('document.getElementById("asEditor").open');
  await a.evaluate('hullNo.value="SYNTH-H1";workerInfo.value="합성 출장자";asDetail.value="합성 출장";document.getElementById("asForm").requestSubmit()');await a.wait('calendarState.as.events.some(e=>e.hullNo==="SYNTH-H1")');
  await a.evaluate('navigatePortal("team")');await a.wait('calendarState.team.loaded&&!calendarState.team.busy');await a.evaluate('openNewCalendar("team")');await a.wait('document.getElementById("teamEditor").open');await a.evaluate('teamTitle.value="합성 팀 일정";document.getElementById("teamForm").requestSubmit()');await a.wait('calendarState.team.events.some(e=>e.title==="합성 팀 일정")');
  console.log('PASS integration search; existing issue + authenticated R2 photo thumbnail/lightbox, AS and team-calendar UI.');
  const report=await a.evaluate('window.createHpmPresentation(issues,calendarState.as.events,calendarState.team.events)');assert.ok(report.includes('</script>'));assert.ok(!report.includes('hpmServerToken'));assert.ok(!report.includes('passwordHash'));assert.ok(!report.includes('<script src='));
  await a.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  for(const page of ['weekly','production','vehicles','meals','safety']){await a.evaluate('navigatePortal('+JSON.stringify(page)+')');assert.ok(await a.evaluate('document.documentElement.scrollWidth<=innerWidth+2'),'mobile body overflow: '+page);}
  await a.evaluate('navigatePortal("weekly");document.querySelector("#weeklyPage [data-meeting]").click()');assert.equal(await a.evaluate('document.getElementById("weeklyPage").classList.contains("meeting-view")'),true);
  const screenshot=await a.call('Page.captureScreenshot',{format:'png'});const artifact=resolve('.wrangler','business-mobile-qa.png');writeFileSync(artifact,Buffer.from(screenshot.data,'base64'));
  await a.evaluate('logoutPortal()');await a.wait('window.hpmServerUser===null');assert.equal(await a.evaluate('document.getElementById("title").value'),'');await login(a);const before=state.env.sqlite.prepare('SELECT COUNT(*) n FROM weekly_issues').get().n;
  await form(a,'weekly',{date:day,part:'2 PART',product:'재로그인 후 합성 기록',manager:'합성 담당',problem:'중복 이벤트 검증'});await a.wait('document.querySelector("#weeklyPage [data-list]").textContent.includes("재로그인 후 합성 기록")');assert.equal(state.env.sqlite.prepare('SELECT COUNT(*) n FROM weekly_issues').get().n,before+1);
  assert.deepEqual(errors,[]);console.log('PASS mobile 390px body layout, meeting expansion, no JavaScript exceptions. Screenshot: '+artifact);
}finally{
  socket?.close();chrome.kill();await state.close();
  const tempRoot=resolve(tmpdir())+sep,target=resolve(profile);assert.ok(target.startsWith(tempRoot)&&target.includes('hpm-business-qa-'));
  await new Promise(r=>setTimeout(r,500));try{rmSync(target,{recursive:true,force:true,maxRetries:4,retryDelay:200});}catch{}
}
