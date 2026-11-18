import test from 'node:test';import assert from 'node:assert/strict';
import worker from '../worker.js';import {makeEnv,TOKEN} from './support/env.mjs';
import {issueDepartments} from '../business/issue-departments.mjs';
const put=(env,id,body)=>worker.fetch(new Request('https://hpmanagement-web.lotusland1995.workers.dev/api/issues/'+id,{method:'PUT',headers:{Origin:'https://hojezzang.github.io',Authorization:'Bearer '+TOKEN,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
test('current department choices are accepted; deprecated or arbitrary new departments are rejected',async()=>{
 const env=makeEnv();try{for(const [i,value]of issueDepartments.entries())assert.equal((await put(env,'current-'+i,{description:'합성 부서 확인',responsibleDept:value})).status,200);
 for(const value of ['생산기술팀','임의 부서'])assert.equal((await put(env,'invalid',{description:'합성',responsibleDept:value})).status,400);
 assert.equal(env.sqlite.prepare("SELECT COUNT(*) AS n FROM issues WHERE id='invalid'").get().n,0);
 }finally{env.sqlite.close();}
});
test('unchanged historical department survives unrelated edits and history; selecting a current department is explicit',async()=>{
 const env=makeEnv();try{
 assert.equal((await put(env,'legacy',{description:'기존 내용',responsibleDept:'기술팀'})).status,200);
 env.sqlite.prepare("UPDATE issues SET responsible_dept='생산기술팀' WHERE id='legacy'").run();
 for(const body of [{remark:'다른 항목만 수정'},{description:'내용 수정',responsibleDept:'생산기술팀'}]){
  const response=await put(env,'legacy',body);assert.equal(response.status,200);assert.equal((await response.json()).issue.responsibleDept,'생산기술팀');
 }
 assert.equal((await put(env,'legacy',{responsibleDept:'구조설계팀'})).status,200);
 assert.equal((await put(env,'legacy',{responsibleDept:'생산기술팀'})).status,400);
 assert.equal(env.sqlite.prepare("SELECT responsible_dept FROM issues WHERE id='legacy'").get().responsible_dept,'구조설계팀');
 }finally{env.sqlite.close();}
});
