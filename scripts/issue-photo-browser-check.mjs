// Isolated local SQLite/R2 and synthetic images only; browser blocks external requests.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {startTestServer} from './local-test-server.mjs';
import {browser} from './browser-harness.mjs';
const baseline=process.argv.includes('--baseline'),dir='.wrangler/nov23-review';
await mkdir(dir,{recursive:true});
const state=await startTestServer(),qa=await browser(process.argv[2],state.url);
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBzQAAAAASUVORK5CYII=','base64');
function seed(){for(let i=0;i<15;i++){
 const before=`issues/photo-${i}/before/synthetic.png`,after=`issues/photo-${i}/after/synthetic.png`;
 state.env.objects.set(before,{bytes,type:'image/png'});state.env.objects.set(after,{bytes,type:'image/png'});
 state.env.sqlite.prepare('INSERT INTO issues(id,title,description,status,images,after_images,updated_at) VALUES(?,?,?,?,?,?,?)').run('photo-'+i,'합성 사진 '+i,'사진 검증','접수',JSON.stringify([before]),JSON.stringify([after]),String(100-i));
}
state.env.sqlite.prepare('INSERT INTO issues(id,title,status,updated_at) VALUES(?,?,?,?)').run('photo-none','합성 사진 없음','접수','001');
}
const get=state.env.PHOTOS.get;state.env.PHOTOS.get=async key=>{await new Promise(r=>setTimeout(r,180));return get(key);};
try{
 const t=await qa.tab();await t.wait('document.documentElement.dataset.auth==="anonymous"');
 await t.call('Emulation.setDeviceMetricsOverride',{width:1366,height:900,deviceScaleFactor:1,mobile:false});
 await t.evaluate(`authUserId.value='owner';authPassword.value=${JSON.stringify(state.password)};void submitAuth()`);
 await t.wait('window.hpmServerUser?.id==="owner"&&issuesLoaded');
 await t.evaluate(`await navigatePortal('issue','manage');switchManageView('list');window.photoShown=[];window.photoStatuses=[];const originalPhotoFetch=window.authorizedFetch;window.authorizedFetch=async(...args)=>{const r=await originalPhotoFetch(...args);if(args[0].includes('/api/photos/'))photoStatuses.push({url:args[0],status:r.status});return r};document.addEventListener('load',e=>{if(e.target.matches?.('#issueList img'))photoShown.push({at:performance.now(),source:hpmCanonicalPhoto(e.target.src)})},true);`);
 seed();await t.evaluate('window.photoStart=performance.now();performance.clearResourceTimings();await loadIssues();applyFilters()');
 if(!baseline)await t.wait('document.querySelector("#issueList [data-photo-state=loading]")!==null');
 await t.wait('photoShown.length>0');await new Promise(r=>setTimeout(r,500));
 const measure=()=>t.evaluate(`({firstPhotoMs:photoShown[0]?.at-photoStart,rendered:photoShown.length,requests:performance.getEntriesByType('resource').filter(e=>e.name.includes('/api/photos/')).map(e=>({path:new URL(e.name).pathname,type:e.initiatorType,status:e.responseStatus,transferBytes:e.transferSize,bodyBytes:e.encodedBodySize,durationMs:e.duration}))})`);
 const first=await measure(),requests=()=>state.requests.filter(r=>r.path.startsWith('/api/photos/'));
 const firstCount=requests().length;
 await t.evaluate('await navigatePortal("home");await navigatePortal("issue","manage");switchManageView("list")');await new Promise(r=>setTimeout(r,450));
 const reentry=requests().length-firstCount;
 if(baseline){
  const report={fixture:{imageBytes:bytes.length,photoDelayMs:180,issues:16},...first,totalRequests:firstCount,reentryRequests:reentry};
  await writeFile(dir+'/photos-before.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }else{
  assert(first.requests.every(r=>r.type==='fetch'&&r.status===200),JSON.stringify(first));
  assert(firstCount>0&&firstCount<15,'Only visible list images should start loading');assert.equal(reentry,0);
  assert(await t.evaluate('[...document.querySelectorAll("#issueList img")].some(i=>!i.getAttribute("src")&&i.closest("[data-photo-state]").dataset.photoState==="waiting")'));
  await t.shot(dir+'/photo-list.png');
  await t.evaluate('document.querySelectorAll("#issueList img").item(document.querySelectorAll("#issueList img").length-1).scrollIntoView({block:"center",behavior:"instant"})');
  await t.wait('[...document.querySelectorAll("#issueList img")].at(-1).closest("[data-photo-state]").dataset.photoState==="loaded"');
  assert(requests().length>firstCount,'Scrolling starts previously deferred photos');
  const afterScroll=requests().length;assert.equal(new Set(requests().map(r=>r.path)).size,afterScroll,'No duplicate originals or unauthenticated image requests');
  await t.evaluate('keywordFilter.value="합성 사진 없음";applyFilters()');assert(await t.evaluate('issueList.textContent.includes("사진 없음")&&!issueList.querySelector("img")'));
  await t.evaluate('keywordFilter.value="";applyFilters();scrollTo(0,0)');
  const firstId=await t.evaluate('currentFiltered[0].id');
  await t.evaluate(`await openIssueDetails(${JSON.stringify(firstId)});document.querySelector('.issue-detail-photos').scrollIntoView({block:'center',behavior:'instant'})`);
  await t.wait('document.querySelectorAll(".detail-photo[data-photo-state=loaded]").length===2');
  const detailCount=requests().length;
  await t.evaluate('document.querySelector(".detail-photo").click()');await t.wait('photoLightbox.open&&document.querySelector(".photo-lightbox-dialog").dataset.photoState==="loaded"');
  assert.equal(requests().length,detailCount,'Lightbox reuses the original photo');
  assert(await t.evaluate('photoLightboxImage.src===document.querySelector(".detail-photo img").src'));
  await t.evaluate('closePhotoLightbox()');await t.shot(dir+'/photo-detail.png');await t.evaluate('issueDetailDialog.close()');
  // Missing object is distinct from no attachment and retries on reopening.
  const missing='issues/photo-failure/after/retry.png';
  state.env.sqlite.prepare('INSERT INTO issues(id,title,status,after_images,updated_at) VALUES(?,?,?,?,?)').run('photo-failure','합성 불러오기 실패','접수',JSON.stringify([missing]),'000');
  await t.evaluate('await loadIssues();await openIssueDetails("photo-failure");document.querySelector(".issue-detail-photos").scrollIntoView({block:"center",behavior:"instant"})');
  await t.wait('document.querySelector(".detail-photo[data-photo-state=error]")!==null');
  assert(await t.evaluate('photoStatuses.some(e=>e.url.endsWith("'+missing+'")&&e.status===404)'));
  assert(await t.evaluate('issueDetailBody.textContent.includes("첨부 사진 없음")&&issueDetailBody.textContent.includes("사진 불러오기 실패")'));
  await t.shot(dir+'/photo-failure.png');state.env.objects.set(missing,{bytes:Uint8Array.of(1,2,3),type:'image/png'});
  await t.evaluate('issueDetailDialog.close();await openIssueDetails("photo-failure");document.querySelector(".issue-detail-photos").scrollIntoView({block:"center",behavior:"instant"})');
  await t.wait('document.querySelector(".detail-photo[data-photo-state=error]")!==null');
  state.env.objects.set(missing,{bytes,type:'image/png'});
  await t.evaluate('issueDetailDialog.close();await openIssueDetails("photo-failure");document.querySelector(".issue-detail-photos").scrollIntoView({block:"center",behavior:"instant"})');
  await t.wait('document.querySelector(".detail-photo[data-photo-state=loaded]")!==null');await t.evaluate('issueDetailDialog.close()');
  // One slow request shared by concurrent list/detail/lightbox consumers.
  const shared='issues/photo-concurrent/before/shared.png';state.env.objects.set(shared,{bytes,type:'image/png'});
  state.env.sqlite.prepare('INSERT INTO issues(id,title,status,images,updated_at) VALUES(?,?,?,?,?)').run('photo-concurrent','합성 동시 요청','접수',JSON.stringify([shared]),'999');
  await t.evaluate('await loadIssues();applyFilters();await openIssueDetails("photo-concurrent");document.querySelector(".issue-detail-photos").scrollIntoView({block:"center",behavior:"instant"});openPhotoLightbox(issuePhotoUrl(issues.find(i=>i.id==="photo-concurrent").images[0]))');
  await t.wait('photoLightbox.open&&document.querySelector(".photo-lightbox-dialog").dataset.photoState==="loaded"');
  assert.equal(requests().filter(r=>r.path.endsWith(shared)).length,1);
  await t.evaluate('closePhotoLightbox();issueDetailDialog.close()');
  for(const width of [1366,390,320])for(const theme of ['light','dark']){
   await t.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await t.evaluate(`document.documentElement.dataset.theme='${theme}';scrollTo(0,0)`);
   assert(await t.evaluate('document.documentElement.scrollWidth<=innerWidth+2'));await t.shot(`${dir}/photo-list-${width}-${theme}.png`);
  }
  const beforeReload=requests().length,origin=await t.evaluate('performance.timeOrigin');await t.call('Page.reload');
  await t.wait('performance.timeOrigin!=='+origin+'&&window.hpmServerUser?.id==="owner"&&issuesLoaded');
  await t.evaluate('await navigatePortal("issue","manage");switchManageView("list");scrollTo(0,0)');await t.wait('document.querySelector("#issueList [data-photo-state=loaded]")!==null');
  const refreshed=requests().length-beforeReload;assert(refreshed>0,'A refresh refetches private photos; no persistent photo cache');
  assert((await t.evaluate('performance.getEntriesByType("resource").filter(e=>e.name.includes("/api/photos/")).every(e=>e.initiatorType==="fetch"&&e.responseStatus===200)')));
  // Logout during fetch must abort and cannot restore a photo into a later session.
  const late='issues/photo-late/before/late.png';state.env.objects.set(late,{bytes,type:'image/png'});
  await t.evaluate(`window.lateImg=document.createElement('img');document.body.append(lateImg);hpmSetPhotoSource(lateImg,location.origin+'/api/photos/${late}',{eager:true});void logoutPortal()`);
  await t.wait('!window.hpmServerUser&&portalWorkspace.hidden');await new Promise(r=>setTimeout(r,250));assert.equal(await t.evaluate('lateImg.getAttribute("src")'),null);
  assert.deepEqual(qa.errors,[]);
  const report={fixture:{imageBytes:bytes.length,photoDelayMs:180,issues:16},...first,totalRequests:firstCount,afterScrollRequests:afterScroll,reentryRequests:reentry,refreshRequests:refreshed,deferredUntilVisible:true,beforeAfterAndOriginal:true,concurrentSharedRequests:1,missing404AndDecodeFailureRetry:true,logoutInFlight:true,productionRequests:0};
  await writeFile(dir+'/photos-after.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }
}finally{await qa.close();await state.close();}
