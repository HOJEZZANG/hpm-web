import test from 'node:test';import assert from 'node:assert/strict';
import {condEva} from '../business/cond-eva.mjs';import worker from '../worker.js';
import {readOnlyProduction} from '../integrations/cond-eva/source-worker/hpm-readonly.mjs';
const source={fetch:readOnlyProduction};
import {sourceEnv,READ_TOKEN} from './support/cond-eva-fixtures.mjs';import {makeEnv,TOKEN} from './support/env.mjs';
const req=(query='',method='GET')=>new Request('https://hpmanagement-web.lotusland1995.workers.dev/api/business/cond-eva'+query,{method});
const user={id:'owner',role:'user'};
const page=(items=[],extra={})=>({schemaVersion:1,total:items.length,items,hasMore:false,nextCursor:null,revision:'synthetic',sourceUpdatedAt:null,queriedAt:'2026-11-17T01:00:00.000Z',...extra});
const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
test('HPM fetches all source pages without DB replication, admin token or arbitrary proxy',async()=>{
 const env=sourceEnv({count:5001}),requests=[];try{
  const result=await condEva(req(),{HPM_COND_EVA_READ_TOKEN:READ_TOKEN},user,async(url,init)=>{requests.push({url,init});return source.fetch(new Request(url,init),env);});
  assert.equal(result.items.length,5001);assert.equal(result.complete,true);assert.equal(requests.length,11);assert.equal(result.sourceUpdatedAt,'2026-11-17T04:00:00.000Z');assert.notEqual(result.fetchedAt,result.sourceUpdatedAt);
  for(const {url,init}of requests){assert.equal(new URL(url).origin,'https://hiair-cond-v9.kwy1010.workers.dev');assert.equal(new URL(url).pathname,'/api/hpm/production-status');assert(!url.includes(READ_TOKEN));assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');assert.equal(init.headers.Authorization,'Bearer '+READ_TOKEN);assert(!init.headers['X-Admin-Token']);}
  assert(!JSON.stringify(result).includes(READ_TOKEN));assert(env.sql.every(s=>/^SELECT\b/i.test(s.trim())));
 }finally{env.sqlite.close();}
});
test('setup, method and permission failures do not call source',async()=>{
 let calls=0;const fetcher=()=>{calls++;throw Error('unexpected');};
 await assert.rejects(condEva(req(),{},user,fetcher),e=>e.status===503&&e.code==='COND_EVA_SETUP_REQUIRED');
 await assert.rejects(condEva(req('','POST'),{},user,fetcher),e=>e.status===405);
 await assert.rejects(condEva(req('?url=https://evil.example'),{HPM_COND_EVA_READ_TOKEN:READ_TOKEN},user,fetcher),e=>e.status===400);
 await assert.rejects(condEva(req(),{},null,fetcher),e=>e.status===401);assert.equal(calls,0);
});
test('partial, duplicate, changed, oversized and malicious upstream results are never returned as complete',async()=>{
 const options={HPM_COND_EVA_READ_TOKEN:READ_TOKEN},bad=[page([],{total:1}),page([{work_order:'x'},{work_order:'x'}]),page([],{total:20001}),page([{work_order:'x',equipment:READ_TOKEN}]),page([],{hasMore:true,nextCursor:'x'}),{items:[]}];
 for(const value of bad)await assert.rejects(condEva(req(),options,user,async()=>json(value)),e=>e.status===502);
 let n=0;await assert.rejects(condEva(req(),options,user,async()=>json(n++?page([{work_order:'b'}],{total:2,revision:'changed'}):page([{work_order:'a'}],{total:2,hasMore:true,nextCursor:'a'}))),e=>e.code==='COND_EVA_CHANGED');
 for(const status of [206,301,401,403,500])await assert.rejects(condEva(req(),options,user,async()=>new Response(READ_TOKEN,{status})),e=>!e.message.includes(READ_TOKEN)&&e.status===502);
 await assert.rejects(condEva(req(),options,user,async()=>{throw Error(READ_TOKEN);}),e=>!e.message.includes(READ_TOKEN));
 const empty=await condEva(req(),options,user,async()=>json(page()));assert.equal(empty.total,0);assert.equal(empty.complete,true);
});
test('real HPM authentication blocks anonymous and disabled users before source; setting is server-only',async()=>{
 const env=makeEnv(),oldFetch=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return json(page());};
 try{
  const request=(token=TOKEN,method='GET')=>worker.fetch(new Request(req().url,{method,headers:token?{Authorization:'Bearer '+token}:{}}),env);
  assert.equal((await request(null)).status,401);assert.equal((await request()).status,503);assert.equal(calls,0);
  env.HPM_COND_EVA_READ_TOKEN=READ_TOKEN;assert.equal((await request()).status,200);assert.equal(calls,1);
  assert.equal((await request(TOKEN,'POST')).status,405);
  env.sqlite.prepare("INSERT INTO portal_accounts(id,name,salt,password_hash,role,status,created_at) VALUES('keeper','합성 관리자','synthetic','unused','admin','active',?)").run(new Date().toISOString());
  env.sqlite.prepare("UPDATE portal_accounts SET status='pending' WHERE id='owner'").run();assert.equal((await request()).status,403);assert.equal(calls,1);
 }finally{globalThis.fetch=oldFetch;env.sqlite.close();}
});
test('timeout and interrupted response bodies fail safely without exposing credentials',async()=>{
 const nativeTimer=globalThis.setTimeout;
 globalThis.setTimeout=(fn,ms,...args)=>nativeTimer(fn,ms===20000?5:ms,...args);
 try{
  await assert.rejects(condEva(req(),{HPM_COND_EVA_READ_TOKEN:READ_TOKEN},user,async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error(READ_TOKEN))))),e=>e.status===504&&!e.message.includes(READ_TOKEN));
 }finally{globalThis.setTimeout=nativeTimer;}
 await assert.rejects(condEva(req(),{HPM_COND_EVA_READ_TOKEN:READ_TOKEN},user,async()=>new Response(new ReadableStream({start(controller){controller.error(new Error(READ_TOKEN));}}))),e=>e.status===502&&!e.message.includes(READ_TOKEN));
});
