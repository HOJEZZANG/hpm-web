// Actual production page, anonymous browser only; no write or login requests.
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import assert from 'node:assert/strict';
import {save} from './production-lib.mjs';
import {writeFile} from 'node:fs/promises';
const executable=process.argv[2];assert(executable,'Pass Chrome/Edge executable');
const evidence=process.argv[3]||'.wrangler/brand-20261021';assert(/^\.wrangler\/[a-z0-9-]+$/.test(evidence));
const profile=await mkdtemp(join(tmpdir(),'hpm-production-smoke-')),errors=[],writes=[];
const chrome=spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true});let socket;
try{
  const url=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('Browser startup timeout')),20000);chrome.on('error',reject);chrome.stderr.on('data',b=>{text+=b;const m=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});});
  socket=new WebSocket(url);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});let seq=0;const pending=new Map();
  socket.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);else if(m.method==='Network.requestWillBeSent'&&!['GET','HEAD','OPTIONS'].includes(m.params.request.method))writes.push(m.params.request.method+' '+new URL(m.params.request.url).pathname);};
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true}),call=(method,params)=>send(method,params,sessionId);
  await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error('Production browser script failed');return r.result.value;};
  const wait=async expr=>{const end=Date.now()+20000;while(Date.now()<end){if(await evaluate(expr))return;await new Promise(r=>setTimeout(r,150));}throw new Error('Production page timeout');};
  await call('Page.navigate',{url:'https://hojezzang.github.io/hpm-web/'});await wait('document.querySelector("#homePage.active") && window.HpmBusiness && location.hash==="#/home"');
  assert.equal(await evaluate('window.hpmServerUser'),null);
  assert.equal(await evaluate('localStorage.getItem("hpmTheme")'),null);
  assert.equal(await evaluate('document.documentElement.dataset.theme'),await evaluate('matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"'));
  await evaluate("openLoginModal('login')");assert.equal(await evaluate('authDialogTitle.textContent'),'로그인');
  await evaluate("setAuthMode('register')");assert.equal(await evaluate('authDialogTitle.textContent'),'가입 신청');
  assert.deepEqual(await evaluate('({type:authPassword.type,min:authPassword.minLength,max:authPassword.maxLength,mode:authPassword.inputMode,pattern:authPassword.pattern})'),{type:'password',min:4,max:128,mode:'numeric',pattern:'[0-9]{4,128}'});
  assert.equal(await evaluate('window.HpmPasswordPolicy.newPasswordError("0123","numeric")'),'');
  assert(await evaluate('Boolean(window.HpmPasswordPolicy.newPasswordError("12a4","numeric"))'));
  await evaluate("setAuthMode('login')");assert.equal(await evaluate('authPassword.inputMode'),'text');assert.equal(await evaluate('authPassword.hasAttribute("pattern")'),false);assert.equal(await evaluate('authPassword.minLength'),1);
  assert.equal(await evaluate('window.HpmPasswordPolicy.newPasswordError("Synthetic-Admin!2026","legacy")'),'');
  assert(await evaluate('document.querySelector(".auth-security-note").textContent.includes("숫자만 4자리 이상")'));await evaluate('closeLoginModal()');
  for(const page of ['weekly','production','notices','search']){await evaluate(`navigatePortal('${page}')`);await wait(`document.querySelector('#${page}Page').textContent.includes('로그인 후')`);}
  assert.equal(await evaluate('document.querySelector("#portalNavigation [data-page=accounts]").hidden'),true);
  assert.equal(await evaluate('document.querySelectorAll("#safetyPage,#vehiclesPage,#mealsPage,#suppliesPage,#portalNavigation [data-page=safety],#portalNavigation [data-page=vehicles]").length'),0);
  const link=await evaluate('(()=>{const a=document.querySelector("[data-service=vehicles]");return {href:a.href,rel:a.rel,target:a.target}})()');assert.equal(link.href,'https://hiairkorea-truck.web.app/?utm_source=chatgpt.com');assert(link.rel.includes('noopener')&&link.rel.includes('noreferrer'));assert.equal(link.target,'_blank');
  const supplies=await evaluate('(()=>{const a=document.querySelector("[data-service=supplies]");return {href:a.href,target:a.target,rel:a.rel}})()');assert.equal(supplies.href,'https://hiair-supplies.kwy1010.workers.dev/');assert.equal(supplies.target,'_blank');assert(supplies.rel.includes('noopener')&&supplies.rel.includes('noreferrer'));
  await wait('document.querySelector(".brand-logo-panel img").naturalWidth===447');
  assert.equal(await evaluate('new URL(document.querySelector(".brand-logo-panel img").src).pathname'),'/hpm-web/assets/hi-air-korea-logo.png');
  assert.equal(await evaluate('typeof openIssueDetails==="function"&&Boolean(document.querySelector("#issueDetailDialog #issueDetailSummary"))'),true);
  await evaluate("navigatePortal('fireStatus')");await wait('document.querySelector("#fireStatusSummary tr") && document.getElementById("fireStatusPage").getAttribute("aria-busy")==="false"');
  for(const mode of ['light','dark']){
    await evaluate(`if(document.documentElement.dataset.theme!==${JSON.stringify(mode)})themeToggle.click();else{themeToggle.click();themeToggle.click()}`);assert.equal(await evaluate('localStorage.getItem("hpmTheme")'),mode);assert.equal(await evaluate('themeToggle.getAttribute("aria-pressed")'),String(mode==='dark'));
    assert.equal(await evaluate('getComputedStyle(document.body).backgroundColor'),mode==='dark'?'rgb(16, 27, 43)':'rgb(244, 246, 250)');
    for(const [width,height] of [[1366,768],[1920,1080],[390,844],[320,740]]){await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});await evaluate("navigatePortal('issue','manage')");assert(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'),'Body overflow at '+mode+' '+width);if(width<600){await evaluate('document.getElementById("menuToggle").click()');assert(await evaluate('document.body.classList.contains("sidebar-open")'));await evaluate('document.querySelector("#portalNavigation [data-page=weekly]").click()');assert.equal(await evaluate('document.body.classList.contains("sidebar-open")'),false);await evaluate("navigatePortal('issue','manage')");}if(width!==320){const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(evidence+'/operating-'+mode+'-'+width+'.png',Buffer.from(shot.data,'base64'));}}
  }
  await evaluate("navigatePortal('home');navigatePortal('issue','manage');navigatePortal('production')");await evaluate('history.back()');await wait('location.hash==="#/issue/manage"&&document.querySelector("#issuePage.active")');await evaluate('history.back()');await wait('location.hash==="#/home"&&document.querySelector("#homePage.active")');await evaluate('history.forward()');await wait('location.hash==="#/issue/manage"&&document.querySelector("#issuePage.active")');
  assert(await evaluate('getComputedStyle(document.documentElement).getPropertyValue("--line-outer")!==getComputedStyle(document.documentElement).getPropertyValue("--line-inner")'));
  await evaluate('window.__qaReloadMarker=true');await call('Page.reload');await wait('!window.__qaReloadMarker&&window.HpmBusiness&&document.querySelector("#issuePage.active")');assert.equal(await evaluate('location.hash'),'#/issue/manage');assert.equal(await evaluate('document.documentElement.dataset.theme'),'dark');assert.equal(await evaluate('window.hpmServerUser'),null);
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  const report={productionPageLoaded:true,loginAndSignupUi:true,numericSignupPolicy:true,legacyLoginAcceptsMixedCharacters:true,newPagesRequireLogin:true,unifiedMenu:true,externalVehicle:true,externalSupplies:true,mealAndSafetyEntryRemoved:true,logo:true,themes:['light','dark'],osDefault:true,themeRestoredAfterReload:true,detailMarkupAndFunctionDelivered:true,ahuLiveRead:true,viewports:[1366,1920,390,320],javascriptExceptions:0,authenticatedUiTested:false,businessWrites:0,historyBackForward:true,borders:true,at:new Date().toISOString()};await save('browser-verification',report);await writeFile(evidence+'/approved-browser-verification.json',JSON.stringify(report));console.log(JSON.stringify(report));
}finally{socket?.close();chrome.kill();await new Promise(r=>setTimeout(r,300));const target=resolve(profile),parent=resolve(tmpdir())+sep;assert(target.startsWith(parent)&&target.split(sep).at(-1).startsWith('hpm-production-smoke-'));await rm(target,{recursive:true,force:true,maxRetries:8,retryDelay:250});}
