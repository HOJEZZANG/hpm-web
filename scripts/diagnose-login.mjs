// Normal existing-account login, then read-only production verification. Never bootstraps accounts.
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {hash} from './production-lib.mjs';
const host='127.0.0.1',port=8799,origin=`http://${host}:${port}`,cookie=randomBytes(32).toString('hex'),base='https://hpmanagement-web.lotusland1995.workers.dev',dir='.wrangler/brand-20261021';
const baseline=JSON.parse(await readFile(dir+'/records-before.json','utf8')),manifest=JSON.parse(await readFile(dir+'/before.json','utf8'));
let busy=false,verified=false;
const page=`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>HPM 운영 읽기 진단</title><style>body{font:16px/1.7 system-ui;max-width:540px;margin:40px auto;padding:24px;background:#f2f5fa;color:#182b45}label{display:block;margin:16px 0}input,button{display:block;font:inherit;padding:12px;width:100%;box-sizing:border-box}button{background:#0757a3;color:white;border:0;border-radius:6px}#status{white-space:pre-line}</style><h1>HPM 운영 읽기 진단</h1><p>현재 사용 중인 승인 계정으로 정상 로그인합니다. 계정 생성·초기 관리자 등록·업무 저장·복원은 하지 않습니다.</p><p>문제점·일정·사진을 현재 D1 기준과 읽기 비교한 뒤 로그아웃합니다. 비밀번호와 세션은 파일·대화에 기록하지 않습니다.</p><form><label>기존 로그인 ID<input name="id" autocomplete="username" required maxlength="30"></label><label>기존 비밀번호<input type="password" name="password" autocomplete="current-password" required maxlength="128"></label><button>로그인하여 조회 확인</button></form><p role="status" id="status"></p><script src="/verify.js"></script></html>`;
const client=`const f=document.querySelector('form'),s=document.querySelector('#status');f.onsubmit=async e=>{e.preventDefault();f.querySelector('button').disabled=true;s.textContent='HTTPS 로그인 및 읽기 비교 중…';try{const r=await fetch('/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(f)))}),d=await r.json();s.textContent=d.message;if(r.ok){f.reset();f.hidden=true;}}catch{s.textContent='연결 실패. 입력은 유지했습니다.';}finally{f.querySelector('button').disabled=false;}};`;
const server=createServer(async(req,res)=>{
  const send=(status,value,type='application/json')=>{res.writeHead(status,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'self'"});res.end(type==='application/json'?JSON.stringify(value):value);};
  if(req.headers.host!==host+':'+port)return send(403,{message:'잘못된 접근입니다.'});
  if(req.method==='GET'&&req.url==='/'){res.setHeader('Set-Cookie',`diagnosis=${cookie}; HttpOnly; SameSite=Strict; Path=/`);return send(200,page,'text/html');}
  if(req.headers.cookie!==`diagnosis=${cookie}`)return send(403,{message:'이 PC의 진단 화면에서 진행하세요.'});
  if(req.method==='GET'&&req.url==='/verify.js')return send(200,client,'text/javascript');
  if(req.method!=='POST'||req.url!=='/verify'||req.headers.origin!==origin||!req.headers['content-type']?.startsWith('application/json'))return send(403,{message:'잘못된 접근입니다.'});
  if(busy||verified)return send(409,{message:'이미 처리 중이거나 확인이 끝났습니다.'});
  busy=true;let token='',raw='',step='login';
  try{
    for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)throw new Error('입력이 너무 큽니다.');}
    const body=JSON.parse(raw);raw='';assert(typeof body.id==='string'&&typeof body.password==='string');
    const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:'https://hojezzang.github.io','Content-Type':'application/json'},body:JSON.stringify(body)});body.password='';
    if(!login.ok){const d=await login.json();return send(login.status,{message:d.error||'로그인 실패. 기존 승인 계정을 확인하세요.'});}
    const session=await login.json();token=session.token;
    const get=async path=>{step=path;const r=await fetch(base+path,{headers:{Authorization:'Bearer '+token,Origin:'https://hojezzang.github.io'}});assert.equal(r.status,200);return r;};
    const api=await(await get('/api/issues')).json();assert(Array.isArray(api.issues));assert.deepEqual(api.issues.map(i=>i.id).sort(),baseline.issues.map(i=>i.id).sort());
    const mapping={issueNo:'issue_no',occurDate:'occur_date',reporter:'reporter',reporterId:'reporter_id',title:'title',description:'description',actionDetail:'action_detail',yard:'yard',hullNo:'hull_no',productNo:'product_no',responsibleDept:'responsible_dept',processPnd:'process_pnd',part:'part',factory:'factory'};
    for(const i of api.issues){const row=baseline.issues.find(r=>r.id===i.id);for(const [key,column] of Object.entries(mapping))assert.equal(i[key],String(row[column]??''),key);}
    const as=await(await get('/api/as-events')).json(),team=await(await get('/api/team-events')).json();assert.equal(as.events.length,baseline.as_events.length);assert.equal(team.events.length,baseline.team_events.length);
    for(const file of manifest.files){const path=file.key.startsWith('issues/')?'/api/photos/'+file.key:null;if(path){const r=await get(path);assert.equal(hash(Buffer.from(await r.arrayBuffer())),file.sha256);}}
    await writeFile(dir+'/api-before.json',JSON.stringify(api));
    await writeFile(dir+'/authenticated-verification.json',JSON.stringify({login:true,role:session.user.role,idsAndMappedFieldsMatch:true,issues:api.issues.length,as:as.events.length,team:team.events.length,photos:manifest.files.length,at:new Date().toISOString()}));
    verified=true;console.log('PASS 정상 계정 로그인/API 문제점 전체 ID·주요 필드/D1 건수/AS·팀/인증 사진 바이트 일치. 업무 쓰기 없음.');send(200,{message:`확인 완료: 문제점 ${api.issues.length}건, AS ${as.events.length}건, 팀 일정 ${team.events.length}건 및 사진이 현재 기준과 일치합니다. 확인 세션은 로그아웃합니다.`});
  }catch{await writeFile(dir+'/authenticated-error.json',JSON.stringify({step,at:new Date().toISOString()}));console.log('운영 읽기 비교 미완료. 비공개 진단 상태를 확인하세요.');send(503,{message:'읽기 비교를 완료하지 못했습니다. 진단 자료를 보존했습니다. 입력은 유지했습니다.'});}
  finally{if(token)await fetch(base+'/api/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+token,Origin:'https://hojezzang.github.io'}}).catch(()=>{});token='';raw='';busy=false;}
});
server.listen(port,host,()=>console.log('기존 계정의 정상 로그인·읽기 확인 화면: '+origin));
setTimeout(()=>server.close(),45*60*1000).unref();
