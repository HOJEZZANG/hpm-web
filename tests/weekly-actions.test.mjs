import test from 'node:test';import assert from 'node:assert/strict';
import {weeklyPage,canManageWeekly,deleteWeeklyRecords} from '../business/ui/weekly-actions.js';
import {businessApi} from '../business/api.mjs';import {makeEnv} from './support/env.mjs';
test('weekly header range is the current page; selection keys can stay stable through filters and ordering',()=>{
 const rows=Array.from({length:62},(_,i)=>({id:'id-'+i}));assert.equal(weeklyPage(rows,0).rows.length,50);assert.equal(weeklyPage(rows,1).rows.length,12);assert.equal(weeklyPage(rows,99).page,1);const selected=new Set(weeklyPage(rows,1).rows.map(r=>r.id));assert(selected.has('id-61'));assert.equal([...rows].reverse().filter(r=>selected.has(r.id)).length,12);assert.equal(weeklyPage([],3).page,0);
});
test('bulk result is per stable ID and distinguishes deleted, absent and failures without duplicate calls',async()=>{
 const rows=['ok','absent','failed','blocked','ok'].map(id=>({id,owner:id==='blocked'?'other':'member'})),calls=[],events=[],results=await deleteWeeklyRecords(rows,{canDelete:r=>canManageWeekly({id:'member',role:'user'},r),remove:async r=>{calls.push(r.id);if(r.id==='failed')throw Error('통신 실패');return {deleted:r.id==='ok'};},onResult:r=>events.push(r.status)});assert.deepEqual(calls,['ok','absent','failed']);assert.deepEqual(events,['deleted','absent','failed','failed']);assert.deepEqual(results.filter(r=>r.status==='failed').map(r=>r.row.id),['failed','blocked']);assert.equal(canManageWeekly(null,rows[0]),false);assert.equal(canManageWeekly({role:'admin'},rows[3]),true);
});
test('the existing server enforces owner/admin and revisions for every selected deletion',async()=>{
 const env=makeEnv(),stamp='2026-11-25T00:00:00Z';for(const [id,owner]of [['own','member'],['other','owner'],['stale','member']])env.sqlite.prepare('INSERT INTO weekly_issues(id,owner,data,day,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,owner,JSON.stringify({date:'2026-11-25',part:'1 PART',product:'합성 제품',manager:'합성 담당',problem:'현황'}),'2026-11-25',stamp,stamp);
 env.sqlite.prepare("UPDATE weekly_issues SET revision=2 WHERE id='stale'").run();const remove=(id,revision=1)=>businessApi(new Request('https://hpm.test/api/business/weekly/'+id,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision})}),env,{id:'member',role:'user'});
 await assert.rejects(()=>remove('other'),e=>e.status===403);const results=await deleteWeeklyRecords([{id:'own'},{id:'stale'}],{canDelete:()=>true,remove:r=>remove(r.id)});assert.deepEqual(results.map(r=>r.status),['deleted','failed']);assert.equal(env.sqlite.prepare('SELECT count(*) AS n FROM weekly_issues').get().n,2);assert.equal(env.sqlite.prepare("SELECT revision FROM weekly_issues WHERE id='stale'").get().revision,2);
});
