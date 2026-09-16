// Real Chromium DOM checks with intercepted APIs. No production requests are sent.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const executable = process.argv[2];
if (!executable) throw new Error('Usage: node scripts/browser-check.mjs <path-to-chrome-or-edge>');
const profile = mkdtempSync(join(tmpdir(), 'hpm-browser-check-'));
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const site = 'https://hojezzang.github.io/hpm-web/';
const api = 'https://hpmanagement-web.lotusland1995.workers.dev';
const photoKey = 'issues/browser-one/before/test.png';
const photoUrl = api + '/api/photos/' + photoKey;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBzQAAAAASUVORK5CYII=', 'base64');
const records = new Map();
let failWrite = false, failLoad = false, writeCount = 0, uploads = 0;
let offlineSnapshotHtml = '';
const errors = [], requests = [], dialogs = [];
const chrome = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide:true });
let socket;
try {
  const wsUrl = await new Promise((resolve, reject) => {
    let logs = '';
    const timer = setTimeout(() => reject(new Error('Browser startup timed out')), 20000);
    chrome.on('error', reject);
    chrome.stderr.on('data', chunk => {
      logs += chunk;
      const match = logs.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const pending = new Map(), handlers = new Map();
  let commandId = 0;
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const item = pending.get(message.id); pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
    } else for (const handler of handlers.get(message.method) || []) {
      Promise.resolve(handler(message.params, message.sessionId)).catch(error => errors.push(error.stack));
    }
  };
  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++commandId; pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  function on(method, handler) { handlers.set(method, [...(handlers.get(method) || []), handler]); }
  const { targetId } = await send('Target.createTarget', { url:'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten:true });
  const call = (method, params) => send(method, params, sessionId);
  await call('Page.enable'); await call('Runtime.enable');
  on('Runtime.exceptionThrown', ({ exceptionDetails }) => errors.push(exceptionDetails.exception?.description || exceptionDetails.text));
  on('Page.javascriptDialogOpening', async ({ message, type }) => {
    dialogs.push(message);
    await call('Page.handleJavaScriptDialog', { accept:true });
  });
  const cors = [
    {name:'Access-Control-Allow-Origin',value:'https://hojezzang.github.io'},
    {name:'Access-Control-Allow-Methods',value:'GET, POST, PUT, DELETE, OPTIONS'},
    {name:'Access-Control-Allow-Headers',value:'Content-Type'},
  ];
  async function fulfill(id, body, code = 200, contentType = 'application/json') {
    return call('Fetch.fulfillRequest', { requestId:id, responseCode:code,
      responseHeaders:[...cors,{name:'Content-Type',value:contentType}], body:Buffer.from(body).toString('base64') });
  }
  on('Fetch.requestPaused', async ({ requestId, request }) => {
    requests.push({ method:request.method, url:request.url });
    if (request.url.startsWith(site)) return fulfill(requestId, html, 200, 'text/html;charset=utf-8');
    if (request.url.startsWith('file:') && offlineSnapshotHtml) return fulfill(requestId, offlineSnapshotHtml, 200, 'text/html;charset=utf-8');
    if (!request.url.startsWith(api)) return fulfill(requestId, '', 404, 'text/plain');
    const path = new URL(request.url).pathname;
    if (request.method === 'OPTIONS') return fulfill(requestId, '', 204);
    if (path === '/api/issues' && request.method === 'GET') {
      return fulfill(requestId, JSON.stringify(failLoad ? {ok:false,error:'조회 실패'} : {ok:true,issues:[...records.values()]}), failLoad ? 500 : 200);
    }
    if (path === '/api/photos' && request.method === 'POST') {
      uploads++;
      return fulfill(requestId, JSON.stringify({ok:true,key:photoKey,url:photoUrl,contentType:'image/png'}), 201);
    }
    if (path.startsWith('/api/photos/')) {
      if (request.method === 'GET') return fulfill(requestId, png, 200, 'image/png');
      const referenced = [...records.values()].some(item => [...item.images,...item.afterImages].includes(photoUrl));
      return fulfill(requestId, JSON.stringify({ok:true,deleted:!referenced}));
    }
    if (path.startsWith('/api/issues/') && request.method === 'PUT') {
      writeCount++;
      if (failWrite) return fulfill(requestId, JSON.stringify({ok:false,error:'저장 실패 테스트'}), 500);
      const raw = request.postData ?? (await call('Fetch.getRequestPostData', {requestId})).postData;
      const item = JSON.parse(raw);
      assert.ok([...item.images,...item.afterImages].every(p=>!p.startsWith('data:')));
      const now = new Date().toISOString();
      item.createdAt = records.get(item.id)?.createdAt || item.createdAt || now; item.updatedAt = now;
      records.set(item.id,item);
      return fulfill(requestId,JSON.stringify({ok:true,issue:item,photosCleaned:true}));
    }
    if (path === '/api/issues/bulk-delete' && request.method === 'POST') {
      const { ids } = JSON.parse(request.postData);
      for (const id of ids) records.delete(id);
      return fulfill(requestId,JSON.stringify({ok:true,ids,photosCleaned:true}));
    }
    if (path.startsWith('/api/issues/') && request.method === 'DELETE') {
      if (failWrite) return fulfill(requestId,JSON.stringify({ok:false,error:'삭제 실패 테스트'}),500);
      const id = path.split('/').at(-1); records.delete(id);
      return fulfill(requestId,JSON.stringify({ok:true,ids:[id],photosCleaned:true}));
    }
    return fulfill(requestId,JSON.stringify({ok:false,error:'unknown'}),404);
  });
  await call('Fetch.enable', {patterns:[{urlPattern:'*'}]});
  async function evaluate(expression) {
    const result = await call('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async function waitFor(expression) {
    const until = Date.now()+15000;
    while (Date.now()<until) {
      if (await evaluate(expression)) return;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw new Error('Timed out: '+expression);
  }
  await call('Page.navigate',{url:site});
  await waitFor("typeof issuesLoaded !== 'undefined' && issuesLoaded && document.getElementById('homePage').classList.contains('active')");
  await evaluate("currentUser={id:'browser-user',name:'브라우저 검사',team:'검사팀'}; renderAuthState(); syncModulesAfterAuth();");
  assert.equal(await evaluate('issues.length'),0);
  await evaluate("title.value='브라우저 등록'; processPnd.value='2026-09-15'; issueForm.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));");
  await waitFor("!issueBusy && issues.length===1");
  const id = await evaluate('issues[0].id');
  assert.equal(records.size,1);
  await call('Page.reload');
  await waitFor("typeof issuesLoaded !== 'undefined' && issuesLoaded && issues.length===1");
  await evaluate("currentUser={id:'browser-user',name:'브라우저 검사',team:'검사팀'}; renderAuthState(); syncModulesAfterAuth(); editIssue(" + JSON.stringify(id) + "); title.value='브라우저 수정'; issueForm.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));");
  await waitFor("!issueBusy && issues[0].title==='브라우저 수정'");
  const committed = records.get(id).title;
  failWrite = true;
  await evaluate("editIssue(" + JSON.stringify(id) + "); title.value='실패한 수정'; issueForm.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));");
  await waitFor('!issueBusy');
  assert.equal(await evaluate('issues[0].title'),committed);
  assert.equal(records.get(id).title,committed);
  await evaluate('deleteIssue()');
  assert.equal(await evaluate('issues.length'),1);
  failWrite = false;
  await evaluate("editIssue(" + JSON.stringify(id) + ");");
  await evaluate("(async()=>{ const blob=await (await fetch('data:image/png;base64," + png.toString('base64') + "')).blob(); const transfer=new DataTransfer(); transfer.items.add(new File([blob],'photo.png',{type:'image/png'})); photoInput.files=transfer.files; photoInput.dispatchEvent(new Event('change',{bubbles:true})); })()");
  await waitFor("!issueBusy && currentImages.length===1");
  assert.equal(uploads,1);
  assert.equal(await evaluate('currentImages[0]'),photoUrl);
  await waitFor("document.querySelector('#previewGrid img').complete && document.querySelector('#previewGrid img').naturalWidth>0");
  await evaluate("document.querySelector('#previewGrid img').click()");
  assert.equal(await evaluate("photoLightbox.classList.contains('show')"),true);
  assert.equal(await evaluate('photoLightboxImage.src'),photoUrl);
  await evaluate("closePhotoLightbox(); issueForm.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));");
  await waitFor('!issueBusy && issues[0].images.length===1');
  assert.equal(records.get(id).images[0],photoUrl);
  // Preserve registration-based delete checks, including mixed selections.
  records.set('other-owner',{...records.get(id),id:'other-owner',reporterId:'other',reporter:'다른 등록자'});
  await evaluate("loadIssues().then(refreshIssueViews)");
  await evaluate("selectedIssueIds=new Set(["+JSON.stringify(id)+",'other-owner']); deleteSelectedIssues()");
  await waitFor("!issueBusy && issues.length===1");
  assert.ok(records.has('other-owner')); assert.ok(!records.has(id));
  assert.equal(await evaluate("canDeleteIssue(issues[0])"),false);
  // Failed reload retains current in-memory records and locks writes.
  failLoad = true;
  await evaluate("loadIssues().catch(()=>{})");
  assert.equal(await evaluate('issuesLoaded'),false);
  assert.equal(await evaluate('issues.length'),1);
  const previousWrites = writeCount;
  await evaluate("issueForm.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));");
  assert.equal(writeCount,previousWrites);
  failLoad = false;
  await evaluate('loadIssues().then(refreshIssueViews)');
  // Both sample creation and legacy JSON import must persist via individual PUT requests.
  await evaluate('addSampleData()');
  assert.equal([...records.values()].filter(item=>item.sample).length,4);
  const beforeRepeat = writeCount;
  await evaluate('addSampleData()');
  assert.equal(writeCount,beforeRepeat);
  const imported = {id:'imported',title:'가져온 문제점',reporter:'브라우저 검사',reporterId:'browser-user',images:[],afterImages:['data:image/png;base64,'+png.toString('base64')],history:[],processPnd:'2026-09-15'};
  await evaluate("(()=>{const transfer=new DataTransfer(); transfer.items.add(new File(["+JSON.stringify(JSON.stringify({issues:[imported]}))+"],'backup.json',{type:'application/json'})); importInput.files=transfer.files; importInput.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await waitFor("!issueBusy && issues.some(item=>item.id==='imported')");
  assert.equal(records.get('imported').afterImages[0],photoUrl);
  assert.ok(records.has('other-owner'));
  await evaluate("editIssue('imported')");
  await waitFor("document.querySelector('#afterPreviewGrid img').complete && document.querySelector('#afterPreviewGrid img').naturalWidth>0");
  await evaluate("document.querySelector('#afterPreviewGrid img').click()");
  assert.equal(await evaluate('photoLightboxImage.src'),photoUrl);
  await evaluate('closePhotoLightbox()');
  // Export embeds R2 photos for offline presentation, and file mode cannot mutate D1.
  await evaluate("downloadBlob=(content,filename,type)=>{window.__exported={content,filename,type}}; presentationPassword.value='test1234'; presentationPasswordConfirm.value='test1234'; confirmPresentationExport()");
  offlineSnapshotHtml = await evaluate('window.__exported.content');
  assert.ok(offlineSnapshotHtml.startsWith('<!DOCTYPE html>'));
  const snapshotPath = join(profile,'presentation.html');
  writeFileSync(snapshotPath,offlineSnapshotHtml);
  const apiCount = requests.filter(request=>request.url.startsWith(api)).length;
  await call('Page.navigate',{url:pathToFileURL(snapshotPath).href});
  await waitFor("typeof issuesLoaded !== 'undefined' && issuesLoaded && isPresentationMode()");
  assert.equal(await evaluate("issues.find(item=>item.id==='imported').afterImages[0].startsWith('data:image/')"),true);
  await evaluate("currentUser={id:'browser-user',name:'브라우저 검사'}; editIssue('imported'); issueForm.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));");
  assert.equal(requests.filter(request=>request.url.startsWith(api)).length,apiCount);
  assert.equal(errors.length,0,errors.join('\n'));
  assert.ok(dialogs.some(message=>message.includes('저장하지 못했습니다')));
  console.log('PASS browser: initialize, create, reload, edit, failed save/delete, compress/upload, preview/lightbox, photo save, mixed-owner bulk delete, load failure lock, samples, legacy JSON import, after photos, offline presentation export and write lock.');
  console.log('Intercepted requests: '+requests.length+'; no production API requests forwarded.');
  await call('Page.close');
  await send('Browser.close');
} finally {
  socket?.close();
  chrome.kill();
  await new Promise(resolve => setTimeout(resolve,500));
  const target = resolve(profile), parent = resolve(tmpdir());
  if (!target.startsWith(parent + sep) || !target.split(sep).at(-1).startsWith('hpm-browser-check-')) throw new Error('Unsafe temporary path');
  try { rmSync(target,{recursive:true,force:true,maxRetries:5,retryDelay:200}); } catch { console.warn('Temporary browser profile remains: '+target); }
}
