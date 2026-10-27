// Synthetic local identities only. No production requests, credentials or business files.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {startTestServer} from './local-test-server.mjs';
import {browser} from './browser-harness.mjs';
const state=await startTestServer(),qa=await browser(process.argv[2],state.url);
mkdirSync('.wrangler/employee-access',{recursive:true});
try{
  const owner=await qa.tab(),member=await qa.tab();
  async function login(t,id,p=(id==='owner'||id==='000909')?state.password:state.memberPassword){await t.evaluate(`openLoginModal('login');authUserId.value=${JSON.stringify(id)};authPassword.value=${JSON.stringify(p)};submitAuth()`);await t.wait(`window.hpmServerUser?.loginId===${JSON.stringify(id)}`);await t.wait('issuesLoaded&&calendarState.as.loaded&&calendarState.team.loaded');}
  async function accounts(){await owner.evaluate(`navigatePortal('accounts')`);await owner.wait('document.querySelector("#accountsPage [data-access=owner]")');}
  async function edit(id,values){await owner.evaluate(`document.querySelector('#accountsPage [data-access="${id}"]').click();(()=>{const f=document.querySelector('[data-access-form]');for(const[k,v]of Object.entries(${JSON.stringify(values)}))f.elements[k].type==='checkbox'?f.elements[k].checked=v:f.elements[k].value=v;})()`);}
  const submit=()=>owner.evaluate('document.querySelector("[data-access-form]").requestSubmit()');
  await member.evaluate(`openLoginModal('register');authUserId.value='000707';authDisplayName.value='합성 생산관리팀원';authTeam.value='생산관리팀';authPassword.value=${JSON.stringify(state.memberPassword)};submitAuth()`);await member.wait('authMessage.textContent.includes("승인 후")');
  assert.equal(state.env.sqlite.prepare("SELECT role FROM portal_accounts WHERE id='000707'").get().role,'user');
  await member.evaluate(`authPassword.value=${JSON.stringify(state.memberPassword)};submitAuth()`);await member.wait('authMessage.textContent.includes("이미")');
  await member.evaluate(`setAuthMode('login');authPassword.value=${JSON.stringify(state.memberPassword)};submitAuth()`);await member.wait('authMessage.dataset.code==="ACCOUNT_PENDING"');
  await login(owner,'owner');await accounts();await edit('000707',{role:'admin',status:'active'});await submit();await owner.wait('document.querySelector("#accountsPage [data-message]").textContent.includes("먼저 확인")');
  await owner.evaluate('document.querySelector("[name=productionMemberConfirmed]").checked=true');qa.dialogs.accept=false;await submit();assert.equal(state.env.sqlite.prepare("SELECT role FROM portal_accounts WHERE id='000707'").get().role,'user');
  qa.dialogs.accept=true;await submit();await owner.wait('!document.querySelector("[data-access-form]")');await login(member,'000707');
  assert.equal(await member.evaluate('window.hpmServerUser.role'),'admin');assert.equal(await member.evaluate('document.querySelector("#portalNavigation [data-page=accounts]").hidden'),false);
  await owner.evaluate(`await apiRequest('/api/business/weekly/other', {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:'2026-10-27',part:'1 PART',product:'다른 등록자 자료',problem:'합성 문제',manager:'합성 담당'})})`);
  await member.evaluate(`navigatePortal('weekly')`);await member.wait('document.querySelector("#weeklyPage [data-edit]")');
  await member.evaluate(`navigatePortal('production')`);await member.wait('document.querySelector("#productionPage [data-file]")');
  await accounts();await edit('000707',{role:'user'});await submit();await owner.wait('!document.querySelector("[data-access-form]")');
  await member.evaluate('await refreshPortalIdentity()');await member.wait('window.hpmServerUser.role==="user"&&!document.querySelector("#productionPage [data-file]")');assert.equal(await member.evaluate('document.querySelector("#portalNavigation [data-page=accounts]").hidden'),true);
  assert.equal(await member.evaluate('(await authorizedFetch("/api/auth/users")).status'),403);
  await member.evaluate(`navigatePortal('weekly')`);await member.wait('document.querySelector("#weeklyPage [data-list]").textContent.includes("다른 등록자 자료")');assert.equal(await member.evaluate('document.querySelectorAll("#weeklyPage [data-edit]").length'),0);
  await edit('000707',{role:'admin',productionMemberConfirmed:true});await submit();await owner.wait('!document.querySelector("[data-access-form]")');await member.evaluate('await refreshPortalIdentity()');await member.wait('window.hpmServerUser.role==="admin"');
  qa.dialogs.accept=false;await owner.evaluate(`document.querySelector('#accountsPage [data-user="000707"][data-status=disabled]').click()`);assert.equal(state.env.sqlite.prepare("SELECT status FROM portal_accounts WHERE id='000707'").get().status,'active');
  qa.dialogs.accept=true;await owner.evaluate(`document.querySelector('#accountsPage [data-user="000707"][data-status=disabled]').click()`);await owner.wait(`document.querySelector('#accountsPage [data-access="000707"]').closest('tr').children[5].textContent==='거절 / 이용 중지'`);await member.evaluate('await refreshPortalIdentity()');await member.wait('!window.hpmServerUser&&!sessionStorage.getItem("hpmServerToken")');
  await edit('000707',{status:'active',productionMemberConfirmed:true});await submit();await owner.wait('!document.querySelector("[data-access-form]")');await login(member,'000707');
  await member.evaluate(`navigatePortal('mypage');myCurrentPassword.value=${JSON.stringify(state.memberPassword)};myNewPassword.value='000987';myConfirmPassword.value='000987'`);
  qa.dialogs.accept=false;await member.evaluate('document.getElementById("myPasswordForm").requestSubmit()');assert.equal(await member.evaluate('Boolean(window.hpmServerUser)'),true);
  qa.dialogs.accept=true;await member.evaluate('document.getElementById("myPasswordForm").requestSubmit()');await member.wait('!window.hpmServerUser&&authMessage.textContent.includes("변경")');await login(member,'000707','000987');
  await accounts();await edit('owner',{employeeNo:'000909'});await submit();await owner.wait('window.hpmServerUser.loginId==="000909"');assert.equal(await owner.evaluate('window.hpmServerUser.id'),'owner');
  await owner.evaluate('logoutPortal()');await owner.wait('!window.hpmServerUser');await login(owner,'000909');
  await accounts();await owner.evaluate('document.querySelector("#accountsPage details").open=true;document.querySelector("#accountsPage [data-audit]").click()');await owner.wait('document.querySelector("[data-audit-list]").textContent.includes("본인 비밀번호 변경")');
  for(const width of [1366,390,320]){await owner.call('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:width<600});assert(await owner.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));await owner.shot('.wrangler/employee-access/accounts-'+width+'.png');}
  assert(qa.dialogs.messages.some(m=>m.includes('계정을 변경')));assert(qa.dialogs.messages.some(m=>m.includes('기존 세션')));assert.deepEqual(qa.errors,[]);
  console.log('PASS local browser: zero-preserving signup, duplicate/pending denial, explicit/cancelled administrator approval, others’ records, immediate session role/status UI changes, personal password/logout, legacy-ID conversion, audit and 1366/390/320px. No production requests.');
}finally{await qa.close();await state.close();}
