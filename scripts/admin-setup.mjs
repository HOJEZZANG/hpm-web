// Temporary loopback UI: passwords stay in memory, never shell arguments or files.
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {passwordHash} from '../business/auth.mjs';
import {executePrivateSql,query,rows,quote,save,load,hash} from './production-lib.mjs';
const verifyOnly=process.argv.includes('--verify-only');
const host='127.0.0.1',port=8799,origin=`http://${host}:${port}`,cookie=randomBytes(32).toString('hex'),base='https://hpmanagement-web.lotusland1995.workers.dev';
let phase='ready',password='',accountId='',busy=false;
const page=`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>HPM 최초 관리자 등록</title><style>body{font:17px system-ui;max-width:560px;margin:40px auto;padding:20px;background:#f5f8fa}label{display:block;margin:18px 0}input,button{font:inherit;padding:12px;box-sizing:border-box;width:100%}button{background:#125ba0;color:white;border:0;border-radius:6px}p{line-height:1.6}#status{white-space:pre-line}</style><h1>최초 관리자 등록</h1><p>이 PC의 임시 설정 화면입니다. Cloudflare 운영 권한으로 최초 관리자 1명만 등록합니다. ID와 비밀번호를 직접 정하고 보관하세요.</p><p>비밀번호는 파일·채팅에 기록하지 않습니다. 계정 등록과 배포 후 HTTPS 로그인 확인에만 메모리에서 사용한 뒤 지웁니다.</p><form><label>로그인 ID (영문 소문자·숫자·._- 3~30자)<input name="id" pattern="[a-z0-9._-]{3,30}" minlength="3" maxlength="30" required autocomplete="username"></label><label>표시 이름<input name="name" maxlength="100" required autocomplete="name"></label><label>새 비밀번호 (12~128자)<input name="password" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></label><label>비밀번호 확인<input name="confirm" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></label><button>최초 관리자 등록</button></form><p role="status" id="status"></p><script src="/setup.js"></script></html>`;
const client=`const f=document.querySelector('form'),s=document.querySelector('#status');f.onsubmit=async e=>{e.preventDefault();if(f.password.value!==f.confirm.value){s.textContent='비밀번호 확인이 일치하지 않습니다.';return;}f.querySelector('button').disabled=true;try{const r=await fetch('/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(f)))});const d=await r.json();s.textContent=d.message;if(r.ok){f.reset();f.hidden=true;}else f.querySelector('button').disabled=false;}catch{s.textContent='연결 실패. 입력은 유지했습니다.';f.querySelector('button').disabled=false;}};setInterval(async()=>{try{const d=await(await fetch('/status')).json();if(d.phase==='registered')s.textContent='관리자 등록 완료. 입력한 ID와 비밀번호를 보관하세요. 운영 배포와 로그인 확인을 진행 중입니다.';if(d.phase==='verified'){s.textContent='배포 후 관리자 로그인·기존 데이터 조회 확인 완료. https://hojezzang.github.io/hpm-web/ 에서 입력한 ID와 비밀번호로 로그인하세요.';f.hidden=true;}if(d.phase==='verify-failed')s.textContent='계정은 등록되었습니다. 배포 후 확인에 추가 점검이 필요합니다.';}catch{}},3000);`;
const server=createServer(async(req,res)=>{
  const send=(status,body,type='application/json')=>{res.writeHead(status,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'self'"});res.end(type==='application/json'?JSON.stringify(body):body);};
  if(req.headers.host!==`${host}:${port}`)return send(403,{message:'잘못된 접근입니다.'});
  if(req.method==='GET'&&req.url==='/'){res.setHeader('Set-Cookie',`setup=${cookie}; HttpOnly; SameSite=Strict; Path=/`);const content=verifyOnly?page.replaceAll('최초 관리자 등록','운영 관리자 로그인 확인').replace('이 PC의 임시 설정 화면입니다. Cloudflare 운영 권한으로 최초 관리자 1명만 등록합니다. ID와 비밀번호를 직접 정하고 보관하세요.','방금 등록한 관리자 ID와 비밀번호를 입력하세요. 계정을 새로 만들지 않으며 운영 데이터는 조회만 합니다.').replace('표시 이름<input name="name" maxlength="100" required autocomplete="name"','표시 이름 (확인 모드에서는 생략)<input name="name" maxlength="100" autocomplete="name"').replace('새 비밀번호 (12~128자)','등록한 비밀번호 (12~128자)'):page;return send(200,content,'text/html');}
  if(req.headers.cookie!==`setup=${cookie}`)return send(403,{message:'이 PC의 설정 화면에서 진행하세요.'});
  if(req.method==='GET'&&req.url==='/setup.js')return send(200,client,'text/javascript');
  if(req.method==='GET'&&req.url==='/status')return send(200,{phase});
  if(req.method!=='POST'||req.url!=='/setup'||req.headers.origin!==origin||!req.headers['content-type']?.startsWith('application/json'))return send(403,{message:'잘못된 접근입니다.'});
  if(busy||phase!=='ready')return send(409,{message:'이미 처리 중이거나 등록이 완료되었습니다.'});
  busy=true;let raw='';try{
    for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)throw new Error('입력이 너무 큽니다.');}
    const b=JSON.parse(raw);raw='';assert(/^[a-z0-9._-]{3,30}$/.test(b.id));if(!verifyOnly)assert(typeof b.name==='string'&&b.name.trim()&&b.name.length<=100);assert(typeof b.password==='string'&&b.password.length>=12&&b.password.length<=128&&b.password===b.confirm);
    if(verifyOnly){accountId=b.id;password=b.password;phase='registered';return send(200,{message:'운영 HTTPS 로그인과 기존 자료 조회를 확인하고 있습니다.'});}
    const existing=rows(await query("SELECT count(*) AS n FROM portal_accounts WHERE role='admin';"))[0];assert.equal(existing.n,0);
    const salt=randomBytes(32).toString('hex'),derived=await passwordHash(b.password,salt);
    await executePrivateSql(`INSERT INTO portal_accounts(id,name,salt,password_hash,role,status,created_at) SELECT ${[b.id,b.name.trim(),salt,derived,'admin','active',new Date().toISOString()].map(quote).join(',')} WHERE NOT EXISTS(SELECT 1 FROM portal_bootstrap WHERE id='initial');`);
    const verified=rows(await query('SELECT role,status FROM portal_accounts WHERE id='+quote(b.id)+';'))[0];assert(verified?.role==='admin'&&verified.status==='active');assert.equal(rows(await query("SELECT count(*) AS n FROM portal_bootstrap WHERE id='initial';"))[0].n,1);
    accountId=b.id;password=b.password;b.password='';b.confirm='';phase='registered';await save('admin-setup',{created:true,method:'Cloudflare management plane + loopback input',at:new Date().toISOString()});
    console.log('최초 관리자 등록 완료. ID·비밀번호·파생 해시를 출력하지 않았습니다.');send(200,{message:'등록 완료. 입력한 ID와 비밀번호로 운영 사이트에서 로그인하세요. 배포를 진행합니다.'});
  }catch{send(400,{message:'등록하지 못했습니다. ID·이름·비밀번호와 운영 준비 상태를 확인하세요. 입력은 유지했습니다.'});}finally{busy=false;raw='';}
});
server.listen(port,host,()=>console.log('최초 관리자 입력 화면 준비: '+origin));
let verifying=false;
const timer=setInterval(async()=>{
  if(phase!=='registered'||verifying)return;
  try{await load('deployment');}catch{return;}
  verifying=true;let token='',step='login',status=0;try{
    const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:'https://hojezzang.github.io','Content-Type':'application/json'},body:JSON.stringify({id:accountId,password})});status=login.status;assert.equal(login.status,200);const session=await login.json();assert.equal(session.user.role,'admin');token=session.token;password='';
    const get=async path=>{step=path;const r=await fetch(base+path,{headers:{Authorization:'Bearer '+token}});status=r.status;assert.equal(r.status,200);return r;};
    const current=await(await get('/api/issues')).json(),before=await load('issues-api-before');
    const old=(before.issues||[]).map(i=>Object.fromEntries(Object.keys(i).map(k=>[k,(current.issues||[]).find(x=>x.id===i.id)?.[k]])));assert.deepEqual(old,before.issues);assert.equal(current.issues.length,before.issues.length);
    const as=await(await get('/api/as-events')).json(),team=await(await get('/api/team-events')).json();
    const photos=await load('photos-before');for(const p of photos){const r=await get(new URL(p.url).pathname);const bytes=Buffer.from(await r.arrayBuffer());assert.equal(hash(bytes),p.sha256);}
    const empty={};for(const path of ['weekly','safety','vehicles','people','notices','imports?kind=production','imports?kind=supplies','production','supplies','orders']){const r=await get('/api/business/'+path);const d=await r.json();empty[path]=Array.isArray(d.records)?d.records.length:null;}
    await save('authenticated-verification',{adminLogin:true,issues:current.issues.length,asRecords:(as.events||[]).length,teamRecords:(team.events||[]).length,photos:photos.length,photoBytesUnchanged:true,newCollections:empty,at:new Date().toISOString()});
    await fetch(base+'/api/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+token}});token='';phase='verified';console.log('운영 관리자 로그인·기존 문제점/사진/AS/팀 및 신규 빈 업무 조회 확인 완료. 운영 업무 쓰기 없음.');
  }catch{phase='verify-failed';await save('authenticated-verification',{failed:true,step,status,at:new Date().toISOString()});console.log(JSON.stringify({verificationFailed:true,step,status}));}
  finally{if(token)await fetch(base+'/api/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+token}}).catch(()=>{});password='';accountId='';token='';}
},5000);
setTimeout(()=>{password='';accountId='';clearInterval(timer);server.close();},45*60*1000).unref();
