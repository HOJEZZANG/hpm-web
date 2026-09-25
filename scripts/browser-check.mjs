// Real Chromium DOM checks with intercepted APIs. No production requests are sent.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import {calendarBackup, planCalendarImport, normalizeCalendar} from '../calendar-data.mjs';

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
const calendarRecords = {as:new Map(),team:new Map()};
const legacyAs = [
  {id:'as-legacy',date:'2026-09-16',yard:'HHI',asType:'누설',carInfo:'96오 7790',workDetail:'기존 상세'},
  {id:'as-fail',startDate:'2026-09-17',endDate:'2026-09-17',yard:'HHI',asType:'누설',carInfo:'96오 7790'},
];
const legacyTeam = [{date:'2026-09-16',teamType:'회사행사',title:'이전 일정',startTime:'09:00',endTime:'18:00'}];
let failCalendarId = null, failCalendarWrites = false, failCalendarReads = false, calendarWrites = 0;
let failCalendarImport=false;
let failWrite = false, failLoad = false, writeCount = 0, uploads = 0;
let fireMode = 'success', holdFire = false;
const heldFire = [];
let offlineSnapshotHtml = '';
let navigationPending = false;
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
      Promise.resolve(handler(message.params, message.sessionId)).catch(error => {
        // Image requests may be cancelled by DOM replacement as well as navigation.
        if (message.method === 'Fetch.requestPaused' && error.message === 'Invalid InterceptionId.' &&
            (navigationPending || message.params.resourceType === 'Image' || message.params.request.url.includes('/api/fire-status'))) return;
        errors.push(message.method + ' ' + (message.params.request?.url || '') + ': ' + error.stack);
      });
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
    if (path==='/api/calendars/export') return fulfill(requestId,JSON.stringify({ok:true,backup:calendarBackup({as:[...calendarRecords.as.values()],team:[...calendarRecords.team.values()]})}));
    if (path==='/api/calendars/import') {
      if(failCalendarImport)return fulfill(requestId,JSON.stringify({ok:false,error:'가져오기 실패 테스트'}),500);
      const payload=JSON.parse(request.postData),current={as:[...calendarRecords.as.values()],team:[...calendarRecords.team.values()]};
      const plan=planCalendarImport(payload,current),apply=new URL(request.url).searchParams.get('mode')==='apply';
      const inserted={as:[],team:[]};
      if(apply)for(const {type,event} of plan.candidates){calendarRecords[type].set(event.id,{...event,createdAt:event.createdAt||new Date().toISOString(),updatedAt:event.updatedAt||new Date().toISOString()});inserted[type].push(event.id);calendarWrites++;}
      const report=apply?planCalendarImport(payload,{as:[...calendarRecords.as.values()],team:[...calendarRecords.team.values()]}).report:plan.report;
      if(apply)for(const type of ['as','team']){report[type].insertedIds=inserted[type];report[type].duplicateIds=report[type].duplicateIds.filter(id=>!inserted[type].includes(id));}
      return fulfill(requestId,JSON.stringify({ok:true,dryRun:!apply,report}));
    }
    if (path === '/api/fire-status') {
      const params = new URL(request.url).searchParams;
      const year = Number(params.get('year')), month = Number(params.get('month'));
      const mode = fireMode;
      if (holdFire) await new Promise(resolve=>heldFire.push(resolve));
      if (mode==='error') return fulfill(requestId,JSON.stringify({ok:false,error:'조회 실패'}),502);
      const summary = {total:mode==='empty'?0:3,normal:mode==='empty'?0:1,abnormal:0,pending:mode==='empty'?0:2,inspectionRate:mode==='empty'?0:33};
      return fulfill(requestId,JSON.stringify({ok:true,year,month,companies:mode==='empty'?[]:[{company:'업체 <img src=x onerror=alert(1)>',...summary}],summary}));
    }
    const calendarRoute = path.match(/^\/api\/(as|team)-events(?:\/([^/]+))?$/);
    if (calendarRoute) {
      const [,type,id] = calendarRoute;
      const events = calendarRecords[type];
      if (request.method === 'GET') return fulfill(requestId, JSON.stringify(failCalendarReads ? {ok:false,error:'일정 조회 실패'} : {ok:true,events:[...events.values()]}), failCalendarReads ? 500 : 200);
      if (failCalendarWrites || id === failCalendarId) return fulfill(requestId, JSON.stringify({ok:false,error:'일정 저장 실패 테스트'}),500);
      if (request.method === 'PUT') {
        calendarWrites++;
        if (new URL(request.url).searchParams.get('migration') === '1' && events.has(id)) {
          return fulfill(requestId,JSON.stringify({ok:true,event:events.get(id)}));
        }
        const event = JSON.parse(request.postData);
        event.createdAt = events.get(id)?.createdAt || new Date().toISOString(); event.updatedAt = new Date().toISOString();
        events.set(id,event);
        return fulfill(requestId,JSON.stringify({ok:true,event}));
      }
      if (request.method === 'DELETE') {
        events.delete(id); return fulfill(requestId,JSON.stringify({ok:true,id,deleted:true}));
      }
    }
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
    throw new Error('Timed out: '+expression+'\n'+errors.join('\n'));
  }
  await call('Page.addScriptToEvaluateOnNewDocument', {source:
    "if (!localStorage.getItem('calendarTestSeeded')) { localStorage.setItem('asEvents', " + JSON.stringify(JSON.stringify(legacyAs)) + "); localStorage.setItem('teamEvents', " + JSON.stringify(JSON.stringify(legacyTeam)) + "); localStorage.setItem('calendarTestSeeded','yes'); }"
  });
  navigationPending = true;
  await call('Page.navigate',{url:site});
  await waitFor("typeof issuesLoaded !== 'undefined' && issuesLoaded && document.getElementById('homePage').classList.contains('active')");
  navigationPending = false;
  assert.equal(await evaluate('calendarState.as.loaded'),true);
  assert.deepEqual(JSON.parse(await evaluate("localStorage.getItem('asEvents')")),legacyAs);
  assert.deepEqual(JSON.parse(await evaluate("localStorage.getItem('teamEvents')")),legacyTeam);
  assert.equal(calendarRecords.as.size,0);assert.equal(calendarRecords.team.size,0);
  assert.equal(calendarWrites,0,'local browser backups must never auto-import');
  assert.equal(await evaluate('asForm.querySelector("button[type=submit]").disabled'),true);
  await evaluate('initializeCalendars()');
  assert.equal(calendarWrites,0);
  await evaluate("currentUser={id:'browser-user',name:'브라우저 검사',team:'검사팀'}; renderAuthState(); syncModulesAfterAuth();");
  assert.equal(await evaluate('issues.length'),0);
  await evaluate("title.value='브라우저 등록'; processPnd.value='2026-09-15'; issueForm.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));");
  await waitFor("!issueBusy && issues.length===1");
  const id = await evaluate('issues[0].id');
  assert.equal(records.size,1);
  navigationPending = true;
  await call('Page.reload');
  await waitFor("typeof issuesLoaded !== 'undefined' && issuesLoaded && issues.length===1 && calendarState.as.loaded && calendarState.team.loaded && !calendarInitialization");
  navigationPending = false;
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
  // Calendar CRUD changes UI only after success; local copies stay unchanged.
  await waitFor('calendarState.as.loaded && calendarState.team.loaded && !calendarInitialization');
  await evaluate("resetCalendarForm('as'); asStartDate.value='2026-09-18'; asEndDate.value='2026-09-19'; asMemo.value='브라우저 AS'; asForm.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));");
  await waitFor("!calendarState.as.busy && calendarState.as.events.some(event=>event.memo==='브라우저 AS')");
  const asId = await evaluate("calendarState.as.events.find(event=>event.memo==='브라우저 AS').id");
  await evaluate("editCalendarEvent('as',"+JSON.stringify(asId)+"); asMemo.value='AS 수정'; asForm.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));");
  await waitFor("!calendarState.as.busy && calendarState.as.events.some(event=>event.memo==='AS 수정')");
  failCalendarWrites = true;
  await evaluate("editCalendarEvent('as',"+JSON.stringify(asId)+"); asMemo.value='실패한 AS 수정'; asForm.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));");
  await waitFor('!calendarState.as.busy');
  assert.equal(calendarRecords.as.get(asId).memo,'AS 수정');
  assert.equal(await evaluate("calendarState.as.events.find(event=>event.id==="+JSON.stringify(asId)+").memo"),'AS 수정');
  await evaluate("deleteCalendarEvent('as')");
  assert.ok(calendarRecords.as.has(asId));
  failCalendarWrites = false;
  await evaluate("deleteCalendarEvent('as')");
  assert.ok(!calendarRecords.as.has(asId));
  await evaluate("resetCalendarForm('team'); teamStartDate.value='2026-09-18'; teamEndDate.value='2026-09-18'; teamTitle.value='브라우저 팀'; teamForm.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));");
  await waitFor("!calendarState.team.busy && calendarState.team.events.some(event=>event.title==='브라우저 팀')");
  const teamId = await evaluate("calendarState.team.events.find(event=>event.title==='브라우저 팀').id");
  await evaluate("editCalendarEvent('team',"+JSON.stringify(teamId)+"); teamTitle.value='팀 수정'; teamForm.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));");
  await waitFor("!calendarState.team.busy && calendarState.team.events.some(event=>event.title==='팀 수정')");
  await evaluate("editCalendarEvent('team',"+JSON.stringify(teamId)+"); deleteCalendarEvent('team')");
  await waitFor('!calendarState.team.busy');
  assert.ok(!calendarRecords.team.has(teamId));
  calendarRecords.team.set('other-pc',{...legacyTeam[0],id:'other-pc',startDate:'2026-09-16',endDate:'2026-09-16',title:'다른 PC 일정'});
  await evaluate("navigatePortal('team')");
  await waitFor("!calendarState.team.busy && calendarState.team.events.some(event=>event.id==='other-pc')");
  failCalendarReads = true;
  await evaluate("refreshCalendar('as')");
  assert.equal(await evaluate('calendarState.as.loaded'),false);
  const beforeBlocked = calendarWrites;
  await evaluate("upsertCalendar('as', {id:'blocked'})");
  assert.equal(calendarWrites,beforeBlocked);
  failCalendarReads = false;
  await evaluate('initializeCalendars()');
  assert.deepEqual(JSON.parse(await evaluate("localStorage.getItem('asEvents')")),legacyAs);
  assert.deepEqual(JSON.parse(await evaluate("localStorage.getItem('teamEvents')")),legacyTeam);
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
  // Reference calendar features and safe backup flow, against shared mock API state.
  const schedule=(id,extra={})=>normalizeCalendar('as',{id,startDate:'2026-09-30',endDate:'2026-10-02',yard:'HHI',hullNo:'HN-1',asType:'누설',carInfo:'96오 7790',asDetail:'<img src=x onerror=alert(1)>',...extra});
  calendarRecords.as.set('range',schedule('range'));
  calendarRecords.as.set('same',schedule('same',{startDate:'2026-09-10',endDate:'2026-09-10',asType:'용접불량'}));
  calendarRecords.as.set('custom',schedule('custom',{asType:'직접 유형',yard:'직접 YARD',carInfo:'직접 차량'}));
  await evaluate("initializeCalendars(); navigatePortal('as')");
  await waitFor('calendarState.as.loaded && !calendarState.as.busy && !calendarInitialization');
  await evaluate("calendarState.as.current=new Date(2026,9,1);renderCalendar('as')");
  assert.equal(await evaluate("document.querySelectorAll('#asCalendar [data-event-id=range]').length"),3,'multi-day span must include both months');
  await evaluate("asFilterStartDate.value='2026-10-01';asFilterEndDate.value='2026-10-01';document.querySelectorAll('#asFilterTypes input').forEach(b=>b.checked=['누설','용접불량'].includes(b.value));applyCalendarFilter('as')");
  assert.deepEqual(await evaluate("getCalendarFiltered('as').map(e=>e.id)"),['range']);
  await evaluate("asFilterStartDate.value='';asFilterEndDate.value='';applyCalendarFilter('as')");
  assert.deepEqual(await evaluate("getCalendarFiltered('as').map(e=>e.id)"),['same','range']);
  await evaluate("document.querySelectorAll('#asFilterTypes input').forEach(b=>b.checked=b.value==='기타');applyCalendarFilter('as')");
  assert.deepEqual(await evaluate("getCalendarFiltered('as').map(e=>e.id)"),['custom']);
  assert.equal(await evaluate("document.querySelectorAll('#asList img').length"),0,'schedule input must not become HTML');
  await evaluate("editCalendarEvent('as','custom')");
  assert.equal(await evaluate('yardSelect.value'),'기타');assert.equal(await evaluate('yardCustom.value'),'직접 YARD');
  assert.equal(await evaluate('asTypeCustom.value'),'직접 유형');assert.equal(await evaluate('carCustom.value'),'직접 차량');
  const beforeValidation=calendarWrites;
  await evaluate("asEndDate.value='2020-01-01';asForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
  assert.equal(calendarWrites,beforeValidation);
  await evaluate("editCalendarEvent('as','custom');yardCustom.value='';asForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
  assert.equal(calendarWrites,beforeValidation);
  await evaluate("editCalendarEvent('as','custom');asMemo.value='custom saved';asForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
  await waitFor('!calendarState.as.busy');assert.equal(calendarRecords.as.get('custom').memo,'custom saved');
  await evaluate("resetCalendarForm('team');teamStartDate.value='2026-09-30';teamEndDate.value='2026-09-30';teamStartTime.value='12:00';teamEndTime.value='11:00';teamTitle.value='time validation';teamForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
  assert.equal(calendarWrites,beforeValidation+1);
  await evaluate("teamEndDate.value='2026-10-02';teamType.value='기타';toggleCustomTeamType();teamTypeCustom.value='외부 일정';teamForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
  await waitFor('!calendarState.team.busy');
  assert.ok([...calendarRecords.team.values()].some(e=>e.teamType==='외부 일정'));
  await evaluate("teamFilterType.value='기타';teamFilterStartDate.value='2026-10-01';teamFilterEndDate.value='2026-10-01';applyCalendarFilter('team')");
  assert.equal(await evaluate("getCalendarFiltered('team').length"),1);
  const incoming=calendarBackup({as:[schedule('import-new'),schedule('range',{memo:'conflict'}),calendarRecords.as.get('same')],team:[]});
  const preview=()=>evaluate('previewCalendarImport({files:[new File(['+JSON.stringify(JSON.stringify(incoming))+'],"backup.json",{type:"application/json"})],value:""})');
  const beforeImport=calendarWrites;
  await preview();assert.equal(await evaluate('calendarImportDialog.open'),true);
  assert.deepEqual(await evaluate('pendingCalendarImport.report.as.newIds'),['import-new']);
  assert.equal(await evaluate('pendingCalendarImport.report.as.duplicateIds.length'),1);
  assert.equal(await evaluate('pendingCalendarImport.report.as.conflicts[0].id'),'range');
  assert.equal(calendarWrites,beforeImport);
  await evaluate('closeCalendarImport()');assert.equal(calendarWrites,beforeImport);
  await preview();failCalendarImport=true;await evaluate('confirmCalendarImport()');
  assert.equal(calendarWrites,beforeImport);assert.equal(await evaluate('calendarState.as.events.some(e=>e.id==="import-new")'),false);
  failCalendarImport=false;await evaluate('confirmCalendarImport()');
  assert.equal(calendarWrites,beforeImport+1);assert.equal(calendarRecords.as.get('range').memo,'');
  assert.equal(await evaluate('calendarState.as.events.some(e=>e.id==="import-new")'),true);
  await evaluate('closeCalendarImport()');await preview();
  assert.equal(await evaluate('calendarImportConfirm.disabled'),true);
  await evaluate('closeCalendarImport()');
  calendarRecords.as.set('export-fresh',schedule('export-fresh'));
  await evaluate('downloadBlob=(content,filename,type)=>{window.__scheduleExport={content,filename,type}};exportCalendarData()');
  const exported=JSON.parse(await evaluate('window.__scheduleExport.content'));
  assert.equal(exported.app,'AS출장_팀캘린더');assert.equal(exported.version,1);assert.ok(exported.exportedAt);
  assert.ok(exported.asEvents.some(e=>e.id==='export-fresh'),'export must fetch current server data');
  await evaluate("sessionStorage.removeItem(AUTH_SESSION_KEY);currentUser=null;renderAuthState();syncModulesAfterAuth()");
  const anonymousWrites=calendarWrites;
  await evaluate("upsertCalendar('as',{id:'anonymous'});deleteCalendarEvent('as');chooseCalendarImport();closeLoginModal()");
  assert.equal(calendarWrites,anonymousWrites);assert.equal(await evaluate('asForm.querySelector("button[type=submit]").disabled'),true);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#asPage .calendar-layout')).gridTemplateColumns.split(' ').length"),1);
  assert.equal(await evaluate("document.querySelector('#asPage .calendar-scroll').scrollWidth>document.querySelector('#asPage .calendar-scroll').clientWidth"),true);
  await call('Emulation.clearDeviceMetricsOverride');
  console.log('PASS schedule UI: month-boundary spans, overlap/multi-type/custom filters, other inputs, date/time validation, XSS, preview/cancel/import/retry/conflicts, fresh export, logged-out write guards and mobile.');

  // Exercise the existing auth flow, including restoration after a full reload.
  await evaluate("openLoginModal('register'); authUserId.value='browser-user'; authDisplayName.value='브라우저 검사'; authPassword.value='test-only-password'; submitAuth()");
  assert.equal(await evaluate('currentUser.id'),'browser-user');
  assert.equal(await evaluate('JSON.parse(sessionStorage.getItem(AUTH_SESSION_KEY)).id'),'browser-user');
  navigationPending = true;
  await call('Page.reload');
  await waitFor("typeof issuesLoaded!=='undefined' && issuesLoaded && calendarState.as.loaded && calendarState.team.loaded && !calendarInitialization");
  navigationPending = false;
  assert.equal(await evaluate('currentUser.id'),'browser-user');
  await evaluate("navigatePortal('mypage')");
  assert.equal(await evaluate("document.getElementById('mypagePage').classList.contains('active')"),true);
  await evaluate('logoutPortal()');
  assert.equal(await evaluate('currentUser'),null);
  assert.equal(await evaluate('sessionStorage.getItem(AUTH_SESSION_KEY)'),null);
  await evaluate("openLoginModal('login'); authUserId.value='browser-user'; authPassword.value='test-only-password'; submitAuth()");
  assert.equal(await evaluate('currentUser.id'),'browser-user');
  await evaluate("navigatePortal('issue','dashboard'); navigatePortal('issue','statistics')");
  console.log('PASS auth: registration, login persistence after reload, my page, logout, login, dashboard and statistics.');
  // Fire status uses the same portal navigation; all requests stay intercepted.
  holdFire = true;
  await evaluate("navigatePortal('fireStatus')");
  await waitFor("fireStatusRequest!==null");
  assert.equal(await evaluate("document.getElementById('fireStatusTableWrap').hidden"),true);
  assert.equal(await evaluate("document.getElementById('fireStatusRefresh').disabled"),true);
  const fireCount = () => requests.filter(r=>r.url.includes('/api/fire-status')).length;
  const firstCount = fireCount();
  await evaluate('void loadFireStatus(); void loadFireStatus()');
  assert.equal(fireCount(),firstCount,'same month request must deduplicate');
  holdFire = false; heldFire.splice(0).forEach(resolve=>resolve());
  await waitFor("fireStatusRequest===null");
  assert.equal(await evaluate("document.querySelectorAll('#fireStatusRows tr').length"),1);
  assert.equal(await evaluate("document.querySelectorAll('#fireStatusRows img').length"),0,'company must render as text');
  assert.match(await evaluate("document.getElementById('fireStatusSummary').textContent"),/전체 소계.*33%/);
  // Rapid month changes abort stale requests and immediately hide old rows.
  holdFire = true;
  await evaluate("fireStatusMonth.value='1'; fireStatusMonth.dispatchEvent(new Event('change'))");
  await waitFor("fireStatusRequest?.key.endsWith('-1')");
  assert.equal(await evaluate("document.getElementById('fireStatusRows').children.length"),0);
  await evaluate("fireStatusMonth.value='2'; fireStatusMonth.dispatchEvent(new Event('change'))");
  await waitFor("fireStatusRequest?.key.endsWith('-2')");
  holdFire = false; heldFire.splice(0).forEach(resolve=>resolve());
  await waitFor('fireStatusRequest===null');
  assert.match(await evaluate('fireStatusPeriod.textContent'),/2월/);
  await evaluate("fireStatusYear.selectedIndex=1; fireStatusYear.dispatchEvent(new Event('change'))");
  await waitFor('fireStatusRequest===null');
  const lastFire = new URL(requests.filter(r=>r.url.includes('/api/fire-status')).at(-1).url);
  assert.equal(lastFire.searchParams.get('year'),await evaluate('fireStatusYear.value'));
  fireMode = 'empty';
  await evaluate('loadFireStatus()');
  assert.match(await evaluate('fireStatusMessageText.textContent'),/등록된 소화기 데이터가 없습니다/);
  assert.match(await evaluate('fireStatusSummary.textContent'),/0%/);
  fireMode = 'error';
  await evaluate('loadFireStatus()');
  assert.equal(await evaluate('fireStatusTableWrap.hidden'),true);
  assert.equal(await evaluate('fireStatusRetry.hidden'),false);
  fireMode = 'success';
  await evaluate('fireStatusRetry.click()');
  await waitFor('fireStatusRequest===null');
  assert.equal(await evaluate('fireStatusRetry.hidden'),true);
  const beforeReentry=fireCount();
  await evaluate("navigatePortal('home'); navigatePortal('fireStatus')");
  await waitFor('fireStatusRequest===null');
  assert.equal(fireCount(),beforeReentry+1);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate("fireStatusTableWrap.scrollWidth>fireStatusTableWrap.clientWidth"),true);
  assert.equal(await evaluate("document.getElementById('fireStatusPage').getBoundingClientRect().width<=390"),true);
  assert.equal(await evaluate("document.querySelector('[data-page=fireStatus]').getBoundingClientRect().width>0"),true);
  assert.equal(await evaluate("document.querySelector('.fire-source').target"),'_blank');
  await call('Emulation.clearDeviceMetricsOverride');
  console.log('PASS fire UI: menu, loading, deduplication, stale-response protection, year/month, totals, empty/error/retry, text escaping, reentry and 390px mobile table.');
  // Export embeds R2 photos for offline presentation, and file mode cannot mutate D1.
  await evaluate("downloadBlob=(content,filename,type)=>{window.__exported={content,filename,type}}; presentationPassword.value='test1234'; presentationPasswordConfirm.value='test1234'; confirmPresentationExport()");
  offlineSnapshotHtml = await evaluate('window.__exported.content');
  assert.ok(offlineSnapshotHtml.startsWith('<!DOCTYPE html>'));
  const snapshotPath = join(profile,'presentation.html');
  writeFileSync(snapshotPath,offlineSnapshotHtml);
  const apiCount = requests.filter(request=>request.url.startsWith(api)).length;
  navigationPending = true;
  await call('Page.navigate',{url:pathToFileURL(snapshotPath).href});
  await waitFor("typeof issuesLoaded !== 'undefined' && issuesLoaded && isPresentationMode() && calendarState.as.loaded && calendarState.team.loaded");
  navigationPending = false;
  assert.equal(await evaluate("calendarState.team.events.some(event=>event.id==='other-pc')"),true);
  assert.equal(await evaluate("issues.find(item=>item.id==='imported').afterImages[0].startsWith('data:image/')"),true);
  await evaluate("currentUser={id:'browser-user',name:'브라우저 검사'}; editIssue('imported'); issueForm.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));");
  assert.equal(requests.filter(request=>request.url.startsWith(api)).length,apiCount);
  assert.equal(errors.length,0,errors.join('\n'));
  assert.ok(dialogs.some(message=>message.includes('저장하지 못했습니다')));
  console.log('PASS browser: initialize, create, reload, edit, failed save/delete, compress/upload, preview/lightbox, photo save, mixed-owner bulk delete, load failure lock, samples, legacy JSON import, after photos, offline presentation export and write lock.');
  console.log('Intercepted requests: '+requests.length+'; no production API requests forwarded.');
  console.log('PASS calendars: no automatic local import, unchanged local backups, CRUD, failure preservation, cross-PC reads, offline snapshot.');
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
