// Synthetic-data-only QA server. It never connects to Cloudflare or production.
import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {makeEnv} from '../tests/support/env.mjs';
import {passwordHash} from '../business/auth.mjs';
import worker from '../worker.js';
export async function startTestServer(){
  const env=makeEnv(),root=fileURLToPath(new URL('../',import.meta.url));
  env.sqlite.exec(readFileSync(new URL('../migrations/0003_shared_calendars.sql',import.meta.url),'utf8'));
  const password='synthetic-browser-password';
  env.sqlite.prepare('UPDATE portal_accounts SET password_hash=? WHERE id=?').run(await passwordHash(password,'synthetic'),'owner');
  const state={failWrites:false,failIssueWrites:false,failIssueReads:false,requests:[],env,password,memberPassword:'001234'};
  const server=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost');
      if(url.pathname.startsWith('/api/')){
        state.requests.push({path:url.pathname,method:req.method});
        if(req.method==='POST'&&url.pathname.endsWith('/chunk')&&state.failChunkAfter!=null){if(state.failChunkAfter--<=0){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,error:'합성 분할 전송 실패'}));return;}}
        if(url.pathname==='/api/fire-status'&&req.method==='GET'){const row={company:'합성 점검 구역',total:5,normal:3,abnormal:1,pending:1,inspectionRate:80};res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,year:Number(url.searchParams.get('year')),month:Number(url.searchParams.get('month')),companies:[row],summary:row}));return;}
        if(state.failIssueReads&&req.method==='GET'&&url.pathname==='/api/issues'){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,error:'합성 조회 실패'}));return;}
        if((state.failWrites&&['PUT','POST','DELETE'].includes(req.method)&&!url.pathname.startsWith('/api/auth/'))||(state.failIssueWrites&&req.method==='PUT'&&url.pathname.startsWith('/api/issues/'))){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,error:'합성 저장 실패'}));return;}
        const chunks=[];for await(const chunk of req)chunks.push(chunk);let bytes=Buffer.concat(chunks);
        // Translate only canonical photo URLs across this local reverse-proxy boundary.
        const translate=(value,from,to)=>typeof value==='string'&&value.startsWith(from+'/api/photos/')?to+value.slice(from.length):Array.isArray(value)?value.map(v=>translate(v,from,to)):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,translate(v,from,to)])):value;
        const remote='https://hpmanagement-web.lotusland1995.workers.dev';
        if(req.headers['content-type']?.includes('application/json'))bytes=Buffer.from(JSON.stringify(translate(JSON.parse(bytes.toString()),state.url,remote)));
        const headers=new Headers(req.headers);headers.set('Origin','https://hojezzang.github.io');
        const request=new Request('https://hpmanagement-web.lotusland1995.workers.dev'+req.url,{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body:bytes})});
        const response=await worker.fetch(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));
        if(response.headers.get('content-type')?.includes('application/json'))res.end(JSON.stringify(translate(await response.json(),remote,state.url)));
        else res.end(Buffer.from(await response.arrayBuffer()));return;
      }
      const rel=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
      if(!(rel==='index.html'||rel==='assets/hi-air-korea-logo.png'||rel==='assets/xlsx-worker.js'||rel==='assets/ahu-pnd-worker.js'||/^business\/(?:(?:domain|ahu-pnd|ahu-models|ahu-presets|password-policy)\.mjs|ui\/[a-z-]+\.(?:js|css))$/.test(rel))){res.writeHead(404);res.end();return;}
      const path=resolve(root,rel);if(!path.startsWith(resolve(root)+sep)||!existsSync(path)){res.writeHead(404);res.end();return;}
      res.writeHead(200,{'Content-Type':rel.endsWith('.png')?'image/png':rel.endsWith('.html')?'text/html; charset=utf-8':rel.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store'});res.end(readFileSync(path));
    }catch{res.writeHead(500);res.end('Local QA request failed');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));state.url='http://127.0.0.1:'+server.address().port;
  state.close=()=>new Promise(resolve=>server.close(resolve));return state;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const state=await startTestServer();console.log('합성 데이터 검증 서버: '+state.url);process.on('SIGINT',async()=>{await state.close();process.exit(0);});
}
