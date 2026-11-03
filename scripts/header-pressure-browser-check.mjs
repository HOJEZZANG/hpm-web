// Isolated Chrome profile; synthetic local accounts, drafts and photos only.
// The pressure link may perform a read-only GET to its user-specified destination.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {startTestServer} from './local-test-server.mjs';
import {browser} from './browser-harness.mjs';
const state=await startTestServer(),qa=await browser(process.argv[2],state.url);
const dir='.wrangler/header-pressure-20261103',destination='http://172.16.15.99:8082/';
await mkdir(dir,{recursive:true});
try{
  const t=await qa.tab();await t.wait('document.documentElement.dataset.auth==="anonymous"');
  assert(await t.evaluate('portalWorkspace.hidden&&portalWorkspace.inert'));
  state.env.sqlite.prepare('UPDATE portal_accounts SET name=? WHERE id=?').run('합성 긴 표시 이름 모바일 확인','owner');
  await t.evaluate(`authUserId.value='owner';authPassword.value=${JSON.stringify(state.password)};void submitAuth()`);
  await t.wait('window.hpmServerUser?.id==="owner"&&issuesLoaded');
  assert.deepEqual(await t.evaluate('[...productionMenu.children].map(n=>n.querySelector(".menu-label").firstChild.textContent)'),['현황 대시보드','공정 문제점 관리','주간 이슈관리','생산 일정관리','압력검사','PND 대조']);
  assert.deepEqual(await t.evaluate('(()=>{const a=document.querySelector("[data-service=pressure]");return [a.tagName,a.href,a.target,a.rel,a.textContent.includes("↗"),a.textContent.includes("사내망 접속")]})()'),['A',destination,'_blank','noopener noreferrer',true,true]);

  // Chrome's own zoom preference changes actual browser zoom, including DPR and
  // media-query layout. This is not CSS zoom or pinch/page-scale emulation.
  const {targetId:settingsId}=await t.browserCall('Target.createTarget',{url:'chrome://settings/',browserContextId:t.browserContextId});
  const {sessionId:settingsSession}=await t.browserCall('Target.attachToTarget',{targetId:settingsId,flatten:true});
  const zoom=async value=>{
    const r=await t.browserCall('Runtime.evaluate',{expression:`new Promise(resolve=>chrome.settingsPrivate.setDefaultZoom(${value},()=>chrome.settingsPrivate.getDefaultZoom(resolve)))`,returnByValue:true,awaitPromise:true},settingsSession);
    assert.equal(r.result.value,value);await t.wait(`Math.abs(devicePixelRatio-${value})<0.01`);
  };
  const mainTarget=(await t.browserCall('Target.getTargets')).targetInfos.find(x=>x.url.startsWith(state.url)&&x.browserContextId===t.browserContextId);
  const {windowId}=await t.browserCall('Browser.getWindowForTarget',{targetId:mainTarget.targetId});
  const matrix=[];
  for(const width of [1366,900,600,390,320])for(const factor of [1,1.25,1.5])for(const theme of ['light','dark']){
    await t.browserCall('Browser.setWindowBounds',{windowId,bounds:{width,height:1000,windowState:'normal'}});
    await t.call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:0,mobile:false});
    await zoom(factor);await t.evaluate(`document.documentElement.dataset.theme='${theme}';scrollTo(0,0);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    for(const page of ['home','issue','production']){
      await t.evaluate(`await navigatePortal('${page}'${page==='issue'?",'manage'":''});scrollTo(0,0)`);
      const geometry=await t.evaluate(`(()=>{
        const r=s=>document.querySelector(s).getBoundingClientRect(),h=r('.portal-topbar'),p=r('.brand-logo-panel'),i=r('.brand-logo-panel img'),b=r('.portal-brand'),c=r('.brand-copy strong'),a=r('.portal-top-actions'),side=r('.portal-sidebar'),main=r('.portal-main');
        const inside=(x,y)=>x.left>=y.left-.5&&x.top>=y.top-.5&&x.right<=y.right+.5&&x.bottom<=y.bottom+.5;
        return {viewport:innerWidth,dpr:devicePixelRatio,imageWidth:i.width,imageHeight:i.height,panelWidth:p.width,panelHeight:p.height,headerBottom:h.bottom,sidebarTop:side.top,brandRight:b.right,brandBottom:b.bottom,actionsLeft:a.left,actionsTop:a.top,actionsHeight:a.height,logoSquare:Math.abs(i.width-i.height)<.5,logoInPanel:inside(i,p),brandInHeader:inside(b,h),hpmInBrand:inside(c,b),logoInHeader:inside(i,h),noActionOverlap:b.right<=a.left+.5||b.bottom<=a.top+.5,actionsInHeader:inside(a,h),headerInViewport:h.right<=innerWidth+.5,sidebarOffset:Math.abs(side.top-h.bottom)<.5,mainOffset:main.top>=h.bottom-.5,natural:document.querySelector('.brand-logo-panel img').naturalWidth};
      })()`);
      matrix.push({width,factor,theme,page,...geometry});
      if(Object.values(geometry).includes(false))await t.shot(`${dir}/failure.png`);
      for(const [key,value]of Object.entries(geometry))if(typeof value==='boolean')assert(value,JSON.stringify({width,factor,theme,page,key,geometry}));
      assert.equal(geometry.natural,447);
    }
    if(width<=900)await t.evaluate('menuToggle.click()');
    await t.evaluate('document.querySelector("[data-service=pressure]").scrollIntoView({block:"center"})');
    assert(await t.evaluate('(()=>{const a=document.querySelector("[data-service=pressure]").getBoundingClientRect(),s=portalSidebar.getBoundingClientRect(),h=document.querySelector(".portal-topbar").getBoundingClientRect();return a.left>=s.left&&a.right<=s.right+1&&a.top>=h.bottom&&a.bottom<=innerHeight})()'));
    if((width===1366||width===320)&&factor!==1.25)await t.shot(`${dir}/header-menu-${width}-${factor}-${theme}.png`);
    await t.evaluate('closePortalMenu()');
  }
  await zoom(1);await t.call('Emulation.setDeviceMetricsOverride',{width:1366,height:1000,deviceScaleFactor:0,mobile:false});await t.browserCall('Browser.setWindowBounds',{windowId,bounds:{width:1366,height:1000}});
  await t.evaluate('await navigatePortal("issue","manage");resetForm();description.value="보존할 작성 내용";description.dispatchEvent(new Event("input",{bubbles:true}));');
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBzQAAAAASUVORK5CYII=';
  for(const category of ['before','after']){
    await t.evaluate(`void addIssuePhotos([new File([Uint8Array.from(atob('${png}'),c=>c.charCodeAt(0))],'synthetic.png',{type:'image/png'})],'${category}')`);await t.wait('!issueBusy');
  }
  await t.evaluate('window.keptDraft=JSON.stringify(issueDraftSnapshot());window.keptField=description;window.keptHash=location.hash;window.unloadEvents=0;addEventListener("beforeunload",()=>unloadEvents++);');
  const writesBefore=state.requests.filter(r=>r.method!=='GET').length,dialogsBefore=qa.dialogs.events.length;
  async function openAndVerify(kind){
    const prior=new Set((await t.browserCall('Target.getTargets')).targetInfos.map(x=>x.targetId));
    await t.evaluate('document.querySelector("[data-service=pressure]").scrollIntoView({block:"center"})');
    if(kind==='keyboard'){
      await t.evaluate('document.querySelector("#productionMenu [data-page=production]").focus()');
      await t.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      await t.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      assert(await t.evaluate('document.activeElement===document.querySelector("[data-service=pressure]")'));
      await t.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});
      await t.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    }else{
      const point=await t.evaluate('(()=>{const r=document.querySelector("[data-service=pressure]").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
      await t.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
      const style=await t.evaluate('(()=>{const a=document.querySelector("[data-service=pressure]"),b=document.querySelector("#productionMenu [data-page=production]");const x=getComputedStyle(a),y=getComputedStyle(b);return [x.backgroundColor,x.fontSize===y.fontSize,x.padding===y.padding,x.gap===y.gap]})()');
      assert.notEqual(style[0],'rgba(0, 0, 0, 0)');assert(style.slice(1).every(Boolean));
      await t.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
      await t.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
    }
    let popup;const deadline=Date.now()+5000;
    while(Date.now()<deadline&&!popup){popup=(await t.browserCall('Target.getTargets')).targetInfos.find(x=>!prior.has(x.targetId)&&x.type==='page'&&x.url===destination);if(!popup)await new Promise(r=>setTimeout(r,50));}
    assert(popup,'The link must create a new browser tab with the exact URL');
    const {sessionId}=await t.browserCall('Target.attachToTarget',{targetId:popup.targetId,flatten:true});
    const opener=await t.browserCall('Runtime.evaluate',{expression:'window.opener===null',returnByValue:true},sessionId);assert.equal(opener.result.value,true);
    assert(await t.evaluate('JSON.stringify(issueDraftSnapshot())===keptDraft&&description===keptField&&location.hash===keptHash&&HpmIssueDraft.isDirty()&&!issueLeaveDialog.open&&unloadEvents===0&&hpmServerUser.id==="owner"'));
    assert.deepEqual(await t.evaluate('[currentImages.length,currentAfterImages.length]'),[1,1]);
    assert.equal(qa.dialogs.events.length,dialogsBefore);assert.equal(state.requests.filter(r=>r.method!=='GET').length,writesBefore);
    await t.browserCall('Target.closeTarget',{targetId:popup.targetId});
  }
  await openAndVerify('mouse');await openAndVerify('keyboard');
  // The same link in the narrow drawer must close only the drawer, preserving drafts.
  await t.browserCall('Browser.setWindowBounds',{windowId,bounds:{width:320,height:1000}});
  await t.call('Emulation.setDeviceMetricsOverride',{width:320,height:1000,deviceScaleFactor:0,mobile:false});
  await t.evaluate('menuToggle.click()');await openAndVerify('mouse');assert(await t.evaluate('!document.body.classList.contains("sidebar-open")'));
  assert.deepEqual(qa.errors,[]);
  await writeFile(dir+'/result.json',JSON.stringify({actualChromeZoom:true,matrix,mouseKeyboardAndMobileNewTab:true,draftAndBothPendingPhotosPreserved:true,noLeaveDialog:true,noLocalBusinessWrites:true,exceptions:qa.errors.length},null,2));
  console.log(`PASS ${matrix.length} header layouts at actual Chrome 100/125/150% zoom; light/dark; home/issue/production; 1366/900/600/390/320 windows; menu visibility; mouse/Tab+Enter/mobile new tab; opener isolation; draft and both pending photos preserved; no leave dialog or business writes.`);
}finally{await qa.close();await state.close();}
