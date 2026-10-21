import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import assert from 'node:assert/strict';
export async function browser(executable,base){
  const profile=mkdtempSync(join(tmpdir(),'hpm-ui-qa-')),errors=[],dialogs={accept:true,messages:[]};
  const chrome=spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true});
  const ws=await new Promise((resolve,reject)=>{let logs='';const timer=setTimeout(()=>reject(new Error('Browser startup timeout')),20000);chrome.on('error',reject);chrome.stderr.on('data',b=>{logs+=b;const m=logs.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});});
  const socket=new WebSocket(ws);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});let seq=0;const pending=new Map();
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  socket.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);else if(m.method==='Page.javascriptDialogOpening'){dialogs.messages.push(m.params.message);void send('Page.handleJavaScriptDialog',{accept:dialogs.accept},m.sessionId);}else if(m.method==='Fetch.requestPaused')void send(m.params.request.url.startsWith(base)?'Fetch.continueRequest':'Fetch.fulfillRequest',m.params.request.url.startsWith(base)?{requestId:m.params.requestId}:{requestId:m.params.requestId,responseCode:404,body:''},m.sessionId).catch(e=>{if(!/Invalid InterceptionId/.test(e.message))errors.push(e.message);});};
  return {errors,dialogs,async tab(){const {browserContextId}=await send('Target.createBrowserContext'),{targetId}=await send('Target.createTarget',{url:'about:blank',browserContextId}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true}),call=(method,params)=>send(method,params,sessionId);await call('Page.enable');await call('Runtime.enable');await call('Fetch.enable',{patterns:[{urlPattern:'*'}]});
      const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,replMode:true,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
      const wait=async(expression,label=expression)=>{const end=Date.now()+16000;while(Date.now()<end){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,70));}throw new Error('Timed out: '+label);};
      await call('Page.navigate',{url:base});await wait('document.querySelector("#homePage.active") && window.HpmBusiness');
      return {call,evaluate,wait,async shot(path){const r=await call('Page.captureScreenshot',{format:'png'});writeFileSync(path,Buffer.from(r.data,'base64'));}};
    },async close(){socket.close();chrome.kill();const target=resolve(profile);assert(target.startsWith(resolve(tmpdir())+sep)&&target.split(sep).at(-1).startsWith('hpm-ui-qa-'));await new Promise(r=>setTimeout(r,400));rmSync(target,{recursive:true,force:true,maxRetries:6,retryDelay:250});}};
}
