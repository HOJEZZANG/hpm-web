// All writes use synthetic local SQLite and memory R2. No production connections.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {startTestServer} from './local-test-server.mjs';
import {browser} from './browser-harness.mjs';
const state=await startTestServer(),qa=await browser(process.argv[2],state.url),dir='.wrangler/issue-attachments-20261102';
await mkdir(dir,{recursive:true});
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBzQAAAAASUVORK5CYII=';
await writeFile(dir+'/synthetic.png',Buffer.from(png,'base64'));
try{
  const t=await qa.tab();await t.wait('document.documentElement.dataset.auth==="anonymous"');
  await t.call('Emulation.setTimezoneOverride',{timezoneId:'America/Los_Angeles'});
  await t.evaluate(`authUserId.value='owner';authPassword.value=${JSON.stringify(state.password)};void submitAuth()`);
  await t.wait('window.hpmServerUser?.id==="owner"&&issuesLoaded');
  await t.evaluate('await navigatePortal("issue","manage");resetForm()');
  assert(await t.evaluate('document.getElementById("completedDateField").hidden'));
  await t.evaluate(`window.testPasteEvents=0;document.addEventListener('paste',()=>testPasteEvents++);window.testPhoto=(type='image/png',size=0)=>new File([size?new Uint8Array(size):Uint8Array.from(atob('${png}'),c=>c.charCodeAt(0))],'synthetic.png',{type});window.testTransfer=(files)=>{const dt=new DataTransfer();for(const f of files)dt.items.add(f);return dt;};`);
  async function drop(zone,files,twice=false){
    await t.wait('!issueBusy');
    await t.evaluate(`(async()=>{const n=document.getElementById('${zone}'),e=new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:testTransfer(${files})});n.dispatchEvent(e);${twice?'n.dispatchEvent(e);':''}window.testDropPrevented=e.defaultPrevented;})()`);
    await t.wait('!issueBusy');assert(await t.evaluate('testDropPrevented'));
  }
  async function pasteText(text){
    const previous=await t.evaluate('testPasteEvents');
    await t.evaluate(`await navigator.clipboard.writeText(${JSON.stringify(text)})`);
    await t.call('Input.dispatchKeyEvent',{type:'keyDown',key:'v',code:'KeyV',modifiers:2,windowsVirtualKeyCode:86});
    await t.call('Input.dispatchKeyEvent',{type:'keyUp',key:'v',code:'KeyV',modifiers:2,windowsVirtualKeyCode:86});
    await t.wait('testPasteEvents>'+previous);await t.wait('!issueBusy');
  }
  async function pasteImage(zone){
    const previous=await t.evaluate('testPasteEvents');
    await t.evaluate(`document.getElementById('${zone}').focus();{const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;canvas.getContext('2d').fillRect(0,0,4,4);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);}`);
    await t.call('Input.dispatchKeyEvent',{type:'keyDown',key:'v',code:'KeyV',modifiers:2,windowsVirtualKeyCode:86});
    await t.call('Input.dispatchKeyEvent',{type:'keyUp',key:'v',code:'KeyV',modifiers:2,windowsVirtualKeyCode:86});
    await t.wait('testPasteEvents>'+previous);await t.wait('!issueBusy');
  }
  await t.browserCall('Browser.grantPermissions',{origin:state.url,browserContextId:t.browserContextId,permissions:['clipboardReadWrite','clipboardSanitizedWrite']});
  // Native file input selection and multi-file drop, including a repeated event object.
  const {root}=await t.call('DOM.getDocument'),{nodeId}=await t.call('DOM.querySelector',{nodeId:root.nodeId,selector:'#photoInput'});
  await t.call('DOM.setFileInputFiles',{nodeId,files:[resolve(dir+'/synthetic.png')]});await t.wait('!issueBusy&&currentImages.length===1');
  await drop('beforePhotoZone','[testPhoto(),testPhoto()]',true);assert.equal(await t.evaluate('currentImages.length'),3);
  await pasteImage('afterPhotoZone');await t.wait('currentAfterImages.length===1');
  await pasteImage('beforePhotoZone');assert.equal(await t.evaluate('currentImages.length'),3);
  assert.match(await t.evaluate('beforePhotoZone.textContent'),/최대 3장/);
  await t.evaluate('afterPhotoZone.focus()');await pasteText('https://example.com/image.png');
  await t.wait('afterPhotoZone.textContent.includes("클립보드에 이미지가 없습니다")');assert.equal(await t.evaluate('currentAfterImages.length'),1);
  for(const field of ['description','actionDetail']){
    await t.evaluate(`document.getElementById('${field}').focus()`);await pasteText('일반 텍스트 유지');
    await t.wait(`${field}.value==='일반 텍스트 유지'`);
  }
  assert.deepEqual(await t.evaluate('[currentImages.length,currentAfterImages.length]'),[3,1]);
  // A clipboard image in the textarea never falls back to the previously selected photo zone.
  await pasteImage('description');assert.deepEqual(await t.evaluate('[currentImages.length,currentAfterImages.length]'),[3,1]);
  await drop('afterPhotoZone',"[testPhoto('image/gif'),testPhoto('image/png',5*1024*1024+1),testPhoto()]");
  assert.equal(await t.evaluate('currentAfterImages.length'),2);assert.match(await t.evaluate('afterPhotoZone.textContent'),/5MB/);
  await drop('afterPhotoZone','[testPhoto(),testPhoto()]');assert.equal(await t.evaluate('currentAfterImages.length'),3);
  await t.evaluate(`window.outsideDrop=new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:testTransfer([testPhoto()])});document.body.dispatchEvent(outsideDrop)`);
  assert(await t.evaluate('outsideDrop.defaultPrevented'));assert.deepEqual(await t.evaluate('[currentImages.length,currentAfterImages.length]'),[3,3]);
  assert.equal(state.env.objects.size,0,'Attachments must stay local until Save');
  // Native keyboard focus marks the destination, and Enter opens its existing picker once.
  await t.evaluate('beforePhotoZone.focus()');
  await t.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  assert(await t.evaluate('beforePhotoZone.contains(document.activeElement)'));
  assert.notEqual(await t.evaluate('getComputedStyle(beforePhotoZone).outlineStyle'),'none');
  state.failIssueWrites=true;
  await t.evaluate(`description.value='합성 사진 등록';occurDate.value='2020-01-01';issueForm.requestSubmit();issueForm.requestSubmit();issueForm.requestSubmit()`);
  await t.wait('!issueBusy&&issueFeedback.textContent.includes("저장하지 못했습니다")');
  assert.equal(state.env.objects.size,6);assert.deepEqual(await t.evaluate('[currentImages.length,currentAfterImages.length]'),[3,3]);
  assert.equal(await t.evaluate('description.value'),'합성 사진 등록');
  assert.equal(state.requests.filter(r=>r.path==='/api/photos'&&r.method==='POST').length,6);
  state.failIssueWrites=false;
  await t.evaluate('issueForm.requestSubmit();issueForm.requestSubmit()');await t.wait('!issueBusy&&issues.length===1');
  assert.equal(state.env.objects.size,6);assert.equal(state.env.sqlite.prepare('SELECT COUNT(*) n FROM issues').get().n,1);
  assert.equal(state.requests.filter(r=>r.path==='/api/photos'&&r.method==='POST').length,6);
  const id=await t.evaluate('issues[0].id'),initial=state.env.sqlite.prepare('SELECT * FROM issues').get();
  assert.equal(initial.status,'접수');assert.equal(initial.completed_date,'');
  // Editing retains two existing photos while adding one replacement explicitly after removal.
  await t.evaluate(`editIssue('${id}');removeImage(2)`);await drop('beforePhotoZone','[testPhoto(),testPhoto()]');
  assert.equal(await t.evaluate('currentImages.length'),3);
  for(const src of JSON.parse(initial.images).slice(0,2))assert(await t.evaluate(`currentImages.some(src=>src.endsWith(${JSON.stringify(src)}))`));
  await t.evaluate(`removeImage(2);removeAfterImage(2);window.testEncodedPhoto=async type=>{const canvas=document.createElement('canvas');canvas.width=3;canvas.height=3;const blob=await new Promise(resolve=>canvas.toBlob(resolve,type));return new File([blob],'valid-photo',{type});}`);
  await drop('beforePhotoZone',"[await testEncodedPhoto('image/jpeg')]");await drop('afterPhotoZone',"[await testEncodedPhoto('image/webp')]");
  assert.deepEqual(await t.evaluate('[currentImages.length,currentAfterImages.length]'),[3,3],await t.evaluate('beforePhotoZone.textContent+afterPhotoZone.textContent'));
  await t.evaluate(`completedDate.value='2019-12-31';completedDate.dispatchEvent(new Event('input',{bubbles:true}));issueForm.requestSubmit()`);
  await t.wait('!issueBusy&&issueFeedback.textContent.includes("발생일 이전")');
  await t.evaluate(`completedDate.value='9998-12-31';completedDate.dispatchEvent(new Event('input',{bubbles:true}));issueForm.requestSubmit()`);
  await t.wait('!issueBusy&&issueFeedback.textContent.includes("오늘 이후")');
  await t.evaluate(`completedDate.value='2020-01-05';completedDate.dispatchEvent(new Event('input',{bubbles:true}))`);
  assert.match(await t.evaluate('completedDateHint.textContent'),/미완료 상태/);assert.equal(await t.evaluate('status.value'),'접수');
  // Date field and attachment controls remain usable at mobile widths in both themes.
  for(const theme of ['light','dark'])for(const width of [1366,390,320]){
    await t.call('Emulation.setDeviceMetricsOverride',{width,height:width<600?900:1100,deviceScaleFactor:1,mobile:width<600});
    await t.evaluate(`document.documentElement.dataset.theme='${theme}';beforePhotoZone.focus()`);
    assert.equal(await t.evaluate('document.documentElement.scrollWidth>innerWidth+2'),false);
    assert(await t.evaluate('completedDate.getBoundingClientRect().width>100'));
    await t.shot(`${dir}/${theme}-${width}.png`);
    await t.evaluate('beforePhotoZone.scrollIntoView({block:"start",behavior:"instant"})');await t.shot(`${dir}/photos-${theme}-${width}.png`);
  }
  await t.evaluate('issueForm.requestSubmit()');await t.wait('!issueBusy&&issues[0].completedDate==="2020-01-05"');
  assert.equal(state.env.sqlite.prepare('SELECT completed_date FROM issues').get().completed_date,'2020-01-05');
  await t.evaluate(`editIssue('${id}');actionDetail.value='일반 수정';actionDetail.dispatchEvent(new Event('input',{bubbles:true}));issueForm.requestSubmit()`);
  await t.wait('!issueBusy&&issues[0].actionDetail==="일반 수정"');assert.equal(state.env.sqlite.prepare('SELECT completed_date FROM issues').get().completed_date,'2020-01-05');
  const other=await qa.tab();await other.call('Emulation.setTimezoneOverride',{timezoneId:'Pacific/Auckland'});
  await other.evaluate(`authUserId.value='owner';authPassword.value=${JSON.stringify(state.password)};void submitAuth()`);await other.wait('window.hpmServerUser?.id==="owner"&&issuesLoaded');
  await other.evaluate(`await navigatePortal('issue','manage');openIssueDetails('${id}')`);
  assert.match(await other.evaluate('issueDetailBody.textContent'),/실제 완료일\s*2020-01-05/);
  await other.evaluate(`issueDetailDialog.close();editIssue('${id}')`);assert.equal(await other.evaluate('completedDate.value'),'2020-01-05');
  await other.evaluate(`status.value='종결';status.dispatchEvent(new Event('change',{bubbles:true}));issueForm.requestSubmit()`);await other.wait('!issueBusy&&issues[0].status==="종결"');
  await t.evaluate('await loadIssues();renderDashboard()');assert.match(await t.evaluate('sumLead.textContent'),/4/);
  await other.evaluate(`editIssue('${id}')`);
  await other.evaluate(`clearCompletedDate.click();issueForm.requestSubmit()`);await other.wait('!issueBusy&&issues[0].completedDate===""');
  // Legacy invalid dates must remain visible as raw text and survive unrelated edits.
  state.env.sqlite.prepare('UPDATE issues SET completed_date=?').run('기존 날짜 미정');
  await other.evaluate(`await loadIssues();editIssue('${id}')`);assert.match(await other.evaluate('completedDateHint.textContent'),/기존 날짜 미정/);
  await other.evaluate(`actionDetail.value='기존 이상값 보존';actionDetail.dispatchEvent(new Event('input',{bubbles:true}));issueForm.requestSubmit()`);await other.wait('!issueBusy&&issues[0].actionDetail==="기존 이상값 보존"');
  assert.equal(state.env.sqlite.prepare('SELECT completed_date FROM issues').get().completed_date,'기존 날짜 미정');
  assert.deepEqual(qa.errors,[]);
  console.log('PASS native file picker, multiple drops, native Ctrl+V images/text, exact before/after focus, no URL/global paste, validation/partial acceptance, previews/removal, no pre-save uploads, failed save/retry/double submit, existing photos, date edit/preserve/clear/invalid legacy, independent status, second PC timezone, mobile/dark layout.');
}finally{await qa.close();await state.close();}
