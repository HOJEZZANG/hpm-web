// Synthetic local accounts, SQLite and R2 only. Production writes are never used.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {startTestServer} from './local-test-server.mjs';
import {browser} from './browser-harness.mjs';
const state=await startTestServer(),qa=await browser(process.argv[2],state.url),dir='.wrangler/issue-leave-20261102';await mkdir(dir,{recursive:true});
try{
  const t=await qa.tab();await t.wait('document.documentElement.dataset.auth==="anonymous"');
  await t.evaluate(`authUserId.value='owner';authPassword.value=${JSON.stringify(state.password)};void submitAuth()`);await t.wait('window.hpmServerUser?.id==="owner"&&issuesLoaded');
  const evalNow=expression=>t.evaluate(expression),wait=expression=>t.wait(expression);
  async function nativeWarningCount(count){const deadline=Date.now()+5000;while(qa.dialogs.events.filter(e=>e.type==='beforeunload').length<count&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,30));assert.equal(qa.dialogs.events.filter(e=>e.type==='beforeunload').length,count);}
  async function input(id,value){await evalNow(`{const n=document.getElementById('${id}');n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));}`);}
  async function ask(action){await evalNow(`void ${action}`);await wait('issueLeaveDialog.open');assert.equal(await evalNow('issueLeaveTitle.textContent'),'변경사항을 저장하시겠습니까?');}
  async function choose(choice,settled=true){await evalNow(`document.querySelector('[data-issue-leave=${choice}]').click()`);if(settled)await wait('!HpmIssueDraft.isPending()&&!issueBusy');}
  const dirty=()=>evalNow('HpmIssueDraft.isDirty()');
  const unload=()=>evalNow('(()=>{const e=new Event("beforeunload",{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented})()');
  async function photo(category='before'){
    await evalNow(`void addIssuePhotos([new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBzQAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],'synthetic.png',{type:'image/png'})],'${category}')`);await wait('!issueBusy');
  }
  await evalNow('await navigatePortal("issue","manage");resetForm()');
  assert.equal(await dirty(),false);assert.equal(await unload(),false);assert.equal(await evalNow('HpmIssueDraft.beforeUnloadActive()'),false);
  await evalNow('await navigatePortal("home");await navigatePortal("issue","manage");switchManageView("list");switchManageView("create")');assert.equal(await evalNow('issueLeaveDialog.open'),false);
  // All editable values compare to the baseline, including explicit date deletion.
  for(const [id,value]of [['description','추가'],['actionDetail','조치'],['issueExtra_yard','야드'],['status','종결'],['processPnd','2020-01-02'],['occurDate','2020-01-01']]){
    const initial=await evalNow(`document.getElementById('${id}').value`);await input(id,value);assert(await dirty(),id);assert(await unload());await input(id,initial);assert.equal(await dirty(),false,id);assert.equal(await unload(),false,id);
  }
  await photo();assert(await dirty());await evalNow('removeImage(0)');assert.equal(await dirty(),false);assert.equal(await unload(),false);
  // Keep writing preserves the same DOM node, caret, form and scroll position.
  await input('description','작성 위치 보존');await evalNow('description.focus();description.setSelectionRange(2,5);description.scrollIntoView({behavior:"instant",block:"center"});window.keptNode=description;window.keptScroll=scrollY');
  await ask('navigatePortal("home")');assert.equal(await evalNow('document.querySelectorAll("#issueLeaveDialog[open]").length'),1);
  await evalNow('void navigatePortal("production");void navigatePortal("home")');
  for(const theme of ['light','dark'])for(const width of [1366,390,320]){
    await t.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});await evalNow(`document.documentElement.dataset.theme='${theme}'`);
    assert(await evalNow('issueLeaveDialog.getBoundingClientRect().width<=innerWidth'));await t.shot(`${dir}/dialog-${theme}-${width}.png`);
  }
  // Restore desktop before measuring the saved scroll/caret position.
  await t.call('Emulation.setDeviceMetricsOverride',{width:1366,height:900,deviceScaleFactor:1,mobile:false});
  await choose('continue');assert.equal(await evalNow('location.hash'),'#/issue/manage');assert(await evalNow('description===keptNode'));assert.equal(await evalNow('description.value'),'작성 위치 보존');assert.deepEqual(await evalNow('[description.selectionStart,description.selectionEnd]'),[2,5]);
  await evalNow('window.keptScroll=scrollY');await ask('switchManageView("list")');assert.equal(await evalNow('document.activeElement.id'),'issueLeaveContinue');await t.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});await t.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await wait('!HpmIssueDraft.isPending()');assert.equal(await evalNow('issueEditorPane.hidden'),false);assert(await evalNow('Math.abs(scrollY-keptScroll)<2'));
  await ask('navigatePortal("home")');await choose('discard');assert.equal(await evalNow('location.hash'),'#/home');assert.equal(await dirty(),false);assert.equal(await unload(),false);assert.equal(state.env.sqlite.prepare('SELECT COUNT(*) n FROM issues').get().n,0);
  await evalNow('await navigatePortal("issue","manage")');assert.equal(await evalNow('description.value'),'');
  // Save-and-move validates, retains pending pictures on failure, then retries once.
  await photo();await evalNow('openPhotoLightbox(currentImages[0])');assert.equal(await evalNow('issueLeaveDialog.open'),false);await evalNow('closePhotoLightbox()');await ask('navigatePortal("home")');await choose('save',false);await wait('issueLeaveMessage.textContent.includes("상세내용")');assert.equal(await evalNow('location.hash'),'#/issue/manage');assert.equal(state.env.objects.size,0);await choose('continue');
  await input('description','저장 후 목적지');state.failIssueWrites=true;await ask('navigatePortal("fireAc")');await choose('save',false);await wait('issueLeaveMessage.textContent.includes("저장하지 못했습니다")');
  assert.equal(await evalNow('location.hash'),'#/issue/manage');assert.equal(await evalNow('description.value'),'저장 후 목적지');assert.equal(await evalNow('currentImages.length'),1);assert.equal(state.env.objects.size,1);
  state.failIssueWrites=false;
  await evalNow('document.querySelector("[data-issue-leave=save]").click();document.querySelector("[data-issue-leave=save]").click();void navigatePortal("production")');
  await wait('!HpmIssueDraft.isPending()&&location.hash==="#/fireAc"');assert.equal(state.env.sqlite.prepare('SELECT COUNT(*) n FROM issues').get().n,1);assert.equal(state.env.objects.size,1);
  assert.equal(state.requests.filter(r=>r.path==='/api/photos'&&r.method==='POST').length,1);assert.equal(await unload(),false);
  const id=await evalNow('issues[0].id'),saved={...state.env.sqlite.prepare('SELECT * FROM issues').get()},key=JSON.parse(saved.images)[0];
  // Editing: removed existing photos remain in R2 after Continue and Discard.
  await evalNow(`editIssue('${id}')`);await input('completedDate','2020-01-01');assert(await dirty());await input('completedDate','');assert.equal(await dirty(),false);
  await evalNow('removeImage(0)');assert(await dirty());assert(state.env.objects.has(key));await ask('navigatePortal("home")');await choose('continue');assert.equal(await evalNow('currentImages.length'),0);assert(state.env.objects.has(key));
  await ask('navigatePortal("home")');await choose('discard');assert(state.env.objects.has(key));assert.equal(state.env.sqlite.prepare('SELECT images FROM issues').get().images,saved.images);
  await evalNow(`editIssue('${id}')`);await photo('after');await input('actionDetail','수정 저장');await ask('switchManageView("list")');await choose('save');assert.equal(await evalNow('issueEditorPane.hidden'),true);assert.equal(state.env.sqlite.prepare('SELECT action_detail FROM issues').get().action_detail,'수정 저장');assert.equal(await dirty(),false);
  // Opening another issue and New both protect the current editor.
  await evalNow(`await apiRequest('/api/issues/other',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({description:'다른 문제점'})});await loadIssues();editIssue('${id}')`);
  await input('actionDetail','버리면 안 됨');await ask('openIssueDetails("other")');await choose('continue');assert.equal(await evalNow('issueDetailDialog.open'),false);assert.equal(await evalNow('issueId.value'),id);
  await ask('editIssue("other")');await choose('discard');assert.equal(await evalNow('issueId.value'),'other');
  await input('actionDetail','새로 작성 보호');await ask('HpmIssueDraft.run(()=>resetForm())');await choose('continue');assert.equal(await evalNow('issueId.value'),'other');await ask('HpmIssueDraft.run(()=>resetForm())');await choose('discard');assert.equal(await evalNow('issueId.value'),'');
  // Real Back/Forward: URL is restored before the modal, then the original target is replayed.
  await evalNow('await navigatePortal("home");await navigatePortal("issue","manage")');await input('description','뒤로 보호');
  await evalNow('history.back()');await wait('issueLeaveDialog.open');assert.equal(await evalNow('location.hash'),'#/issue/manage');assert.equal(await evalNow('description.value'),'뒤로 보호');await evalNow('history.back()');await wait('location.hash==="#/issue/manage"&&issueLeaveDialog.open');await choose('continue');
  await evalNow('history.back()');await wait('issueLeaveDialog.open');await choose('discard');await wait('location.hash==="#/home"');
  await evalNow('history.forward()');await wait('location.hash==="#/issue/manage"&&issuePage.classList.contains("active")');assert.equal(await evalNow('description.value'),'');
  await evalNow('await navigatePortal("production");history.back()');await wait('location.hash==="#/issue/manage"&&issuePage.classList.contains("active")');await input('description','앞으로 보호');
  await evalNow('history.forward()');await wait('issueLeaveDialog.open');assert.equal(await evalNow('location.hash'),'#/issue/manage');await t.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await t.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await wait('!HpmIssueDraft.isPending()');
  await evalNow('history.forward()');await wait('issueLeaveDialog.open');await choose('save');await wait('productionPage.classList.contains("active")');assert(state.env.sqlite.prepare('SELECT id FROM issues WHERE description=?').get('앞으로 보호'));
  await evalNow('history.back()');await wait('location.hash==="#/issue/manage"&&issuePage.classList.contains("active")');
  // Native browser warning requires real user activation. Cancel both reload and tab close.
  await evalNow('description.focus()');await t.call('Input.dispatchKeyEvent',{type:'keyDown',key:'x',code:'KeyX',text:'x',windowsVirtualKeyCode:88});await t.call('Input.dispatchKeyEvent',{type:'keyUp',key:'x',code:'KeyX',windowsVirtualKeyCode:88});
  assert(await dirty());qa.dialogs.accept=false;let count=qa.dialogs.events.filter(e=>e.type==='beforeunload').length;
  await t.call('Page.reload');await nativeWarningCount(count+1);await wait('HpmIssueDraft.isDirty()');
  count++;await t.call('Page.close');await nativeWarningCount(count+1);assert(await dirty());qa.dialogs.accept=true;
  await evalNow('issueForm.requestSubmit()');await wait('!issueBusy&&!HpmIssueDraft.isDirty()');assert.equal(await unload(),false);assert.equal(await evalNow('HpmIssueDraft.beforeUnloadActive()'),false);
  count=qa.dialogs.events.filter(e=>e.type==='beforeunload').length;await evalNow('window.beforeCleanReload=true');await t.call('Page.reload');await wait('!window.beforeCleanReload&&window.hpmServerUser&&issuesLoaded');assert.equal(qa.dialogs.events.filter(e=>e.type==='beforeunload').length,count);
  // Logout also uses the three choices and sends no request on Continue.
  await evalNow('switchManageView("create")');await input('description','로그아웃 보호');const logoutCount=state.requests.filter(r=>r.path==='/api/auth/logout').length;
  await ask('logoutPortal()');await choose('continue');assert.equal(state.requests.filter(r=>r.path==='/api/auth/logout').length,logoutCount);assert(await evalNow('Boolean(hpmServerUser)'));
  await ask('logoutPortal()');await choose('save');await wait('document.documentElement.dataset.auth==="anonymous"');assert.equal(state.requests.filter(r=>r.path==='/api/auth/logout').length,logoutCount+1);assert.equal(await unload(),false);
  const rowsBeforeLogout=state.env.sqlite.prepare('SELECT * FROM issues ORDER BY id').all();await evalNow(`authUserId.value='owner';authPassword.value=${JSON.stringify(state.password)};void submitAuth()`);await wait('window.hpmServerUser&&issuesLoaded');await evalNow('await navigatePortal("issue","manage");switchManageView("create")');await input('description','버리고 로그아웃');await ask('logoutPortal()');await choose('discard');await wait('document.documentElement.dataset.auth==="anonymous"');assert.deepEqual(state.env.sqlite.prepare('SELECT * FROM issues ORDER BY id').all(),rowsBeforeLogout);assert(state.env.objects.has(key));
  assert.deepEqual(qa.errors,[]);await writeFile(dir+'/issue-leave-result.json',JSON.stringify({realBrowser:true,nativeReloadAndCloseWarning:true,syntheticOnly:true,exceptions:qa.errors.length}));
  console.log('PASS unchanged/reverted drafts; text/select/date/completion/photo changes; three choices; exact destination; validation/failure/retry; duplicate clicks; existing R2 preservation; tabs/other issue/new/menu; real Back/Forward; native reload/close warnings and saved removal; logout; keyboard/mobile/dark.');
}finally{await qa.close();await state.close();}
