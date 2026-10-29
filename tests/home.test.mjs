import test from 'node:test';
import assert from 'node:assert/strict';
import {koreanTime,monthPeriod,issueLocation,createClock,noticePreview} from '../business/ui/home.js';
import {createPresentation} from '../business/ui/presentation.js';

test('Seoul clock and month ranges cross UTC year/month boundaries and leap days',()=>{
  assert.deepEqual(koreanTime(new Date('2026-12-31T15:00:01Z')),{day:'2027-01-01',date:'2027.01.01 (금)',time:'00:00:01'});
  assert.deepEqual(monthPeriod('2028-02-29'),{start:'2028-02-01',end:'2028-02-29'});
  assert.deepEqual(monthPeriod('2026-12-01'),{start:'2026-12-01',end:'2026-12-31'});
});
test('clock keeps one boundary-aligned timer and recomputes wall time after sleep or system correction',()=>{
  let time=Date.parse('2026-10-29T00:00:00.375Z'),id=0;const jobs=new Map(),renders=[];
  const clock=createClock(value=>renders.push(value.time),{now:()=>time,schedule:(fn,delay)=>{jobs.set(++id,{fn,delay});return id;},cancel:id=>jobs.delete(id)});
  clock.start();assert.equal([...jobs.values()][0].delay,625);
  for(let i=0;i<20;i++)clock.start();assert.equal(jobs.size,1);
  time+=2*3600000+675;[...jobs.values()][0].fn();assert.equal(renders.at(-1),'11:00:01');assert.equal(jobs.size,1);assert.equal([...jobs.values()][0].delay,950);
  time-=5*3600000;clock.start();assert.equal(renders.at(-1),'06:00:01');assert.equal(jobs.size,1);clock.stop();assert.equal(jobs.size,0);
});
test('Yard/Hull presentation never guesses from project identifiers and portable reports omit management numbers',()=>{
  assert.equal(issueLocation({yard:'  ',projectNo:'DO-NOT-INFER'}),'미입력 / 미입력');assert.equal(issueLocation({yard:'Y',hullNo:'0007'}),'Y / 0007');
  const report=createPresentation([{id:'stable-internal',issueNo:'DO-NOT-DISPLAY',yard:'Y',hullNo:'0007',history:[]}],[],[]);
  assert(!report.includes('DO-NOT-DISPLAY'));assert(report.includes('0007'));
});
test('long notices provide escaped previews and a full readable disclosure',()=>{
  const html=noticePreview({title:'<unsafe>',content:'<img onerror=x>\n'.repeat(50)});
  assert(!html.includes('<img'));assert(html.includes('&lt;unsafe&gt;'));assert(html.includes('<details>'));assert(html.includes('공지 전체 보기'));
});
