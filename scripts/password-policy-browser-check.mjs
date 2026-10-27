// Local synthetic accounts only; passwords are never read from production.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {startTestServer} from './local-test-server.mjs';
import {browser} from './browser-harness.mjs';
import {passwordHash} from '../business/auth.mjs';
const state=await startTestServer();state.password='Legacy-Admin!2026-Old';
state.env.sqlite.prepare("UPDATE portal_accounts SET password_hash=? WHERE id='owner'").run(await passwordHash(state.password,'synthetic'));
const qa=await browser(process.argv[2],state.url);mkdirSync('.wrangler/password-policy',{recursive:true});
try{
  const owner=await qa.tab(),member=await qa.tab();
  async function login(t,id,password){await t.evaluate(`openLoginModal('login');authUserId.value=${JSON.stringify(id)};authPassword.value=${JSON.stringify(password)};submitAuth()`);await t.wait(`window.hpmServerUser?.id===${JSON.stringify(id)}`);await t.wait('issuesLoaded&&calendarState.as.loaded&&calendarState.team.loaded');}
  const oldHash=state.env.sqlite.prepare("SELECT password_hash FROM portal_accounts WHERE id='owner'").get().password_hash;
  await login(owner,'owner',state.password);assert.equal(state.env.sqlite.prepare("SELECT password_hash FROM portal_accounts WHERE id='owner'").get().password_hash,oldHash);
  await owner.evaluate(`navigatePortal('mypage')`);assert.equal(await owner.evaluate('myNewPassword.hasAttribute("pattern")'),false);assert.equal(await owner.evaluate('myNewPassword.inputMode'),'text');
  await member.evaluate(`openLoginModal('register');authUserId.value='001100';authDisplayName.value='합성 숫자 팀원';authTeam.value='생산관리팀'`);
  const before=state.requests.filter(r=>r.path==='/api/auth/register'&&r.method==='POST').length;
  for(const p of ['123','12a4','12!4',' 0123']){await member.evaluate(`authPassword.value=${JSON.stringify(p)};submitAuth()`);await member.wait('!authSubmitBtn.disabled&&authMessage.textContent.includes("숫자만")');}
  assert.equal(state.requests.filter(r=>r.path==='/api/auth/register'&&r.method==='POST').length,before);
  assert.equal(await member.evaluate('authPassword.type'),'password');assert.equal(await member.evaluate('authPassword.inputMode'),'numeric');
  await member.evaluate(`authPassword.value='0123';submitAuth()`);await member.wait('authMessage.textContent.includes("승인 후")');
  await owner.evaluate(`await apiRequest('/api/auth/users/001100',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'admin',status:'active',productionMemberConfirmed:true,confirmation:'001100'})})`);
  await login(member,'001100','0123');assert.equal(await member.evaluate('window.hpmServerUser.role'),'admin');assert.equal(await member.evaluate('window.hpmServerUser.passwordPolicy'),'numeric');
  await member.evaluate(`navigatePortal('mypage')`);assert.equal(await member.evaluate('myNewPassword.minLength'),4);assert.equal(await member.evaluate('myNewPassword.inputMode'),'numeric');
  for(const p of ['123','12a4'])assert.equal(await member.evaluate(`myNewPassword.value=${JSON.stringify(p)};myNewPassword.checkValidity()`),false);
  await member.evaluate(`myCurrentPassword.value='0123';myNewPassword.value='0000';myConfirmPassword.value='0000';document.getElementById('myPasswordForm').requestSubmit()`);await member.wait('!window.hpmServerUser&&authMessage.textContent.includes("변경")');await login(member,'001100','0000');
  await owner.evaluate(`myCurrentPassword.value=${JSON.stringify(state.password)};myNewPassword.value='Next-Admin!2026-Private';myConfirmPassword.value='Next-Admin!2026-Private';document.getElementById('myPasswordForm').requestSubmit()`);await owner.wait('!window.hpmServerUser&&authMessage.textContent.includes("변경")');await login(owner,'owner','Next-Admin!2026-Private');assert.equal(await owner.evaluate('window.hpmServerUser.passwordPolicy'),'legacy');
  await member.evaluate('logoutPortal()');await member.wait('!window.hpmServerUser');
  const failed=await member.evaluate(`await (async()=>{const statuses=[];for(let i=0;i<5;i++)statuses.push((await authorizedFetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'001100',password:'9999'})})).status);return statuses;})()`);assert.deepEqual(failed,[401,401,401,401,401]);
  await member.evaluate(`openLoginModal('login');authUserId.value='001100';authPassword.value='0000';submitAuth()`);await member.wait('authMessage.dataset.code==="LOGIN_RETRY"&&authMessage.textContent.includes("초 후")');
  assert.equal(await member.evaluate('window.hpmServerUser'),null);assert.equal(await member.evaluate('authPassword.type'),'password');
  // Advance only the synthetic local limiter windows; no real wait or remote change.
  state.env.sqlite.prepare('UPDATE portal_login_limits SET window_start=0,retry_at=0').run();
  await member.evaluate('submitAuth()');await member.wait('window.hpmServerUser?.id==="001100"');
  await member.evaluate(`navigatePortal('mypage')`);
  for(const width of [1366,390,320]){await member.call('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:width<600});assert(await member.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));await member.shot('.wrangler/password-policy/numeric-'+width+'.png');}
  assert.equal(await member.evaluate('[authPassword,myCurrentPassword,myNewPassword,myConfirmPassword].every(n=>n.type==="password")'),true);assert.deepEqual(qa.errors,[]);
  console.log('PASS local browser: existing mixed administrator login/change without reset, numeric signup/client validation, zeroes, numeric admin promotion/change, masked inputs, server retry notice/recovery and responsive UI. No production requests.');
}finally{await qa.close();await state.close();}
