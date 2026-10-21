// Synthetic records only. Exercises rendered themes, modal focus and read-failure recovery in Chrome.
import assert from 'node:assert/strict';
import {startTestServer} from './local-test-server.mjs';
import {browser} from './browser-harness.mjs';
const state=await startTestServer(),qa=await browser(process.argv[2],state.url);
state.env.sqlite.prepare('UPDATE portal_accounts SET name=? WHERE id=?').run('합성 긴 표시 이름으로 모바일 헤더 검증','owner');
try{
  const t=await qa.tab();
  const theme=()=>t.evaluate('document.documentElement.dataset.theme');
  const reload=async()=>{await t.evaluate('window.__qaReloadMarker=true');await t.call('Page.reload');await t.wait('!window.__qaReloadMarker&&window.HpmBusiness');};
  const esc=async()=>{await t.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await t.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});};
  await t.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});await t.wait('document.documentElement.dataset.theme==="dark"');
  await t.evaluate(`localStorage.setItem('hpm-unrelated-backup','retain');document.getElementById('themeToggle').click()`);assert.equal(await theme(),'light');
  await reload();assert.equal(await theme(),'light');assert.equal(await t.evaluate('localStorage.getItem("hpm-unrelated-backup")'),'retain');
  assert.equal(await t.evaluate('document.querySelector(".brand-logo-panel img").naturalWidth'),447);
  assert.equal(await t.evaluate('document.querySelectorAll("#mealsPage,#suppliesPage,[data-page=meals],[data-page=supplies],[data-page=safety],[data-page=vehicles]").length'),0);
  const links=await t.evaluate('[...document.querySelectorAll(".external-menu")].map(a=>({href:a.href,target:a.target,rel:a.rel}))');assert.deepEqual(links.map(a=>a.href),['https://wooden-convinced-spending-assume.trycloudflare.com/','https://hiairkorea-truck.web.app/?utm_source=chatgpt.com']);assert(links.every(a=>a.target==='_blank'&&a.rel.includes('noopener')&&a.rel.includes('noreferrer')));
  state.failIssueReads=true;
  await t.evaluate(`openLoginModal('login');authUserId.value='owner';authPassword.value=${JSON.stringify(state.password)};submitAuth()`);await t.wait('window.hpmServerUser?.id==="owner"&&issueLoadError');
  await t.evaluate('navigatePortal("issue","manage");switchManageView("list")');assert.equal(await t.evaluate('listCountBadge.textContent'),'미확인');assert.equal(await t.evaluate('sumTotal.textContent'),'—');assert(!(await t.evaluate('issueList.textContent')).includes('없습니다'));
  state.failIssueReads=false;await t.evaluate('document.querySelector("#issuePage [data-retry-issues]").click()');await t.wait('issuesLoaded');assert.equal(await t.evaluate('listCountBadge.textContent'),'0건');assert((await t.evaluate('issueList.textContent')).includes('없습니다'));
  const record={title:'합성 상세 화면 · 긴 제목',description:'첫 번째 줄\n두 번째 줄 <script>검증</script>',actionDetail:'첫 조치\n다음 조치',product:'CHILLER',yard:'SYNTH YARD',hullNo:'SYNTH HULL',responsibleDept:'자재',status:'접수',processPnd:'2026-10-20',causeFeedback:'합성 원인',prevention:'합성 재발방지',history:[{at:'2026-10-20T23:30:00Z',actor:'합성 작성자',status:'접수',note:'합성 변경\n추가 설명'}]};
  await t.evaluate(`await apiRequest('/api/issues/brand-record',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(record)})});await loadIssues();applyFilters()`);
  await t.evaluate(`const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBzQAAAAASUVORK5CYII='),c=>c.charCodeAt(0));const urls=[];for(const category of ['before','after']){const form=new FormData();form.append('file',new Blob([bytes],{type:'image/png'}),'synthetic.png');form.append('issueId','brand-record');form.append('category',category);urls.push((await apiRequest('/api/photos',{method:'POST',body:form})).url);}await apiRequest('/api/issues/brand-record',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({images:[urls[0]],afterImages:[urls[1]]})});await loadIssues();applyFilters();document.querySelector('.issue-open-detail').focus();openIssueDetails('brand-record')`);
  await t.wait('document.querySelectorAll("#issueDetailBody img[src^=blob]").length===2');
  assert.equal(await t.evaluate('issueDetailTitle.textContent'),record.title);assert.equal(await t.evaluate('document.querySelector(".detail-narratives p").textContent'),record.description);
  assert.equal(await t.evaluate('document.querySelectorAll("#issueDetailBody script").length'),0);assert.equal(await t.evaluate('document.querySelector(".detail-additional").open'),false);
  assert((await t.evaluate('document.querySelector(".timeline-meta time").textContent')).includes('08:30'));assert((await t.evaluate('document.querySelector(".timeline-meta time").textContent')).includes('한국 시간'));
  await t.evaluate('document.querySelector("#issueDetailBody [data-photo]").click()');await t.wait('photoLightbox.open');await esc();await t.wait('!photoLightbox.open');assert.equal(await t.evaluate('issueDetailDialog.open'),true);assert.equal(await t.evaluate('document.activeElement.className'),'detail-photo');
  await t.evaluate('issueDetailDialog.scrollTop=issueDetailDialog.scrollHeight');assert(await t.evaluate('Math.abs(document.querySelector("#issueDetailDialog>.card-head").getBoundingClientRect().top-issueDetailDialog.getBoundingClientRect().top)<3'));await esc();await t.wait('!issueDetailDialog.open');assert.equal(await t.evaluate('document.activeElement.className'),'issue-open-detail');
  await t.evaluate(`editIssue('brand-record');description.value='보존할 수정 내용';description.dispatchEvent(new Event('input',{bubbles:true}));openIssueDetails('brand-record')`);qa.dialogs.accept=false;await t.evaluate('document.getElementById("editIssueDetail").click()');assert.equal(await t.evaluate('description.value'),'보존할 수정 내용');assert.equal(await t.evaluate('issueDetailDialog.open'),true);assert(qa.dialogs.messages.at(-1).includes('버리고'));await esc();assert.equal(await t.evaluate('description.value'),'보존할 수정 내용');qa.dialogs.accept=true;
  await t.evaluate('resetForm();keywordFilter.value="없는 합성 필터";applyFilters();switchManageView("list")');assert((await t.evaluate('issueFilterScope.textContent')).includes('전체 1건'));assert((await t.evaluate('issueFilterScope.textContent')).includes('필터 0건'));await t.evaluate('resetFilters()');
  state.failIssueReads=true;await t.evaluate('try{await loadIssues()}catch{}');assert((await t.evaluate('document.querySelector("#issuePage [data-issue-status]").textContent')).includes('이전에 조회한 1건'));assert.equal(await t.evaluate('issues.length'),1);state.failIssueReads=false;await t.evaluate('document.querySelector("#issuePage [data-retry-issues]").click()');await t.wait('issuesLoaded');
  const token=await t.evaluate('sessionStorage.getItem("hpmServerToken")');
  for(const mode of ['light','dark']){
    if(await theme()!==mode)await t.evaluate('document.getElementById("themeToggle").click()');assert.equal(await theme(),mode);assert.equal(await t.evaluate('sessionStorage.getItem("hpmServerToken")'),token);
    for(const [width,height,name] of [[1366,768,'1366'],[1920,1080,'1920'],[390,844,'mobile'],[320,740,'320']]){
      await t.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
      for(const page of ['home','weekly','production','as','team','notices','search','accounts']){await t.evaluate(`navigatePortal('${page}')`);assert(await t.evaluate('document.documentElement.scrollWidth<=innerWidth+2'),page+' overflow '+mode+' '+width);}
      await t.evaluate('navigatePortal("issue","manage");switchManageView("list");openIssueDetails("brand-record")');assert(await t.evaluate('issueDetailDialog.scrollWidth<=issueDetailDialog.clientWidth+2'),'Detail overflow');
      if(width<600)assert.equal(await t.evaluate('getComputedStyle(document.querySelector(".detail-narratives")).gridTemplateColumns.split(" ").length'),1);
      if(width!==320)await t.shot('.wrangler/brand-'+mode+'-'+name+'.png');await esc();
      // Inspect actual computed contrast of common content, controls, labels and status badges.
      const contrast=await t.evaluate(`(()=>{const rgb=s=>(s.match(/[\\d.]+/g)||[]).slice(0,3).map(Number),lum=a=>a.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);return [...document.querySelectorAll('#issuePage input:not([type=checkbox]),#issuePage textarea,#issuePage .badge,#issuePage .btn,.theme-toggle')].filter(e=>e.getBoundingClientRect().width>0).map(e=>{const c=getComputedStyle(e),a=lum(rgb(c.color)),b=lum(rgb(c.backgroundColor));return {label:e.id||e.textContent.slice(0,20),ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});})()`);assert(contrast.every(x=>x.ratio>=4.5),JSON.stringify(contrast.filter(x=>x.ratio<4.5)));
    }
  }
  await reload();await t.wait('window.hpmServerUser?.id==="owner"&&issuesLoaded');assert.equal(await theme(),'dark');assert.equal(await t.evaluate('localStorage.getItem("hpm-unrelated-backup")'),'retain');
  await t.evaluate('logoutPortal()');await t.wait('window.hpmServerUser===null');assert.equal(await theme(),'dark');
  for(const [width,height] of [[1366,768],[1920,1080],[390,844],[320,740],[390,440]]){await t.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});await t.evaluate('openLoginModal("login")');assert(await t.evaluate('(()=>{const r=document.querySelector("#authModal .auth-dialog").getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})()'),'Login dialog clipped at '+width+'x'+height);await t.evaluate('closeLoginModal()');}assert.deepEqual(qa.errors,[]);
  console.log('PASS brand/logo, OS/default + explicit/reloaded theme, storage/session preservation, light/dark 4 widths and control contrast; grouped detail/newlines/escaped HTML/KST/photos/sticky header/keyboard focus/Esc/draft cancel; read failure vs empty/stale/retry/filter counts; external links and removed entry points.');
}finally{await qa.close();await state.close();}
