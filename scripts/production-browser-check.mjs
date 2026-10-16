// Actual production page, anonymous browser only; no write or login requests.
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import assert from 'node:assert/strict';
import {save} from './production-lib.mjs';
const executable=process.argv[2];assert(executable,'Pass Chrome/Edge executable');
const profile=await mkdtemp(join(tmpdir(),'hpm-production-smoke-')),errors=[];
const chrome=spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true});let socket;
try{
  const url=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('Browser startup timeout')),20000);chrome.on('error',reject);chrome.stderr.on('data',b=>{text+=b;const m=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});});
  socket=new WebSocket(url);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});let seq=0;const pending=new Map();
  socket.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);};
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true}),call=(method,params)=>send(method,params,sessionId);
  await call('Page.enable');await call('Runtime.enable');
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error('Production browser script failed');return r.result.value;};
  const wait=async expr=>{const end=Date.now()+20000;while(Date.now()<end){if(await evaluate(expr))return;await new Promise(r=>setTimeout(r,150));}throw new Error('Production page timeout');};
  await call('Page.navigate',{url:'https://hojezzang.github.io/hpm-web/'});await wait('document.querySelector("#homePage.active") && window.HpmBusiness');
  assert.equal(await evaluate('window.hpmServerUser'),null);
  await evaluate("openLoginModal('login')");assert.equal(await evaluate('authDialogTitle.textContent'),'로그인');
  await evaluate("setAuthMode('register')");assert.equal(await evaluate('authDialogTitle.textContent'),'가입 신청');await evaluate('closeLoginModal()');
  for(const page of ['weekly','production','supplies','meals','notices','search']){await evaluate(`navigatePortal('${page}')`);await wait(`document.querySelector('#${page}Page').textContent.includes('로그인 후')`);}
  assert.equal(await evaluate('document.querySelector("#portalNavigation [data-page=accounts]").hidden'),true);
  assert.equal(await evaluate('document.querySelectorAll("#safetyPage,#vehiclesPage,#portalNavigation [data-page=safety],#portalNavigation [data-page=vehicles]").length'),0);
  const link=await evaluate('(()=>{const a=document.querySelector(".external-menu");return {href:a.href,rel:a.rel,target:a.target}})()');assert.equal(link.href,'https://hiairkorea-truck.web.app/?utm_source=chatgpt.com');assert(link.rel.includes('noopener')&&link.rel.includes('noreferrer'));assert.equal(link.target,'_blank');
  await evaluate("navigatePortal('fireStatus')");await wait('document.querySelector("#fireStatusSummary tr") && document.getElementById("fireStatusPage").getAttribute("aria-busy")==="false"');
  for(const [width,height] of [[1366,768],[1920,1080],[390,844],[320,740]]){await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});await evaluate("navigatePortal('issue','manage')");assert(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'),'Body overflow at '+width);if(width<600){await evaluate('document.getElementById("menuToggle").click()');assert(await evaluate('document.body.classList.contains("sidebar-open")'));await evaluate('document.querySelector("#portalNavigation [data-page=weekly]").click()');assert.equal(await evaluate('document.body.classList.contains("sidebar-open")'),false);}}
  assert.deepEqual(errors,[]);
  const report={productionPageLoaded:true,loginAndSignupUi:true,newPagesRequireLogin:true,unifiedMenu:true,externalVehicle:true,safetyEntryRemoved:true,ahuLiveRead:true,viewports:[1366,1920,390,320],javascriptExceptions:0,authenticatedUiTested:false,businessWrites:0,at:new Date().toISOString()};await save('browser-verification',report);console.log(JSON.stringify(report));
}finally{socket?.close();chrome.kill();await new Promise(r=>setTimeout(r,300));const target=resolve(profile),parent=resolve(tmpdir())+sep;assert(target.startsWith(parent)&&target.split(sep).at(-1).startsWith('hpm-production-smoke-'));await rm(target,{recursive:true,force:true,maxRetries:8,retryDelay:250});}
