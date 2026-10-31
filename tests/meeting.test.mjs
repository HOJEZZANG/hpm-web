import test from 'node:test';
import assert from 'node:assert/strict';
import {meetingDate,meetingRange,weekLabel,weeklyRange,weeklyView} from '../business/weekly-data.mjs';
import {validateRecord,isoWeek,koreanToday} from '../business/domain.mjs';
test('nearest Wednesday meeting and inclusive Thursday/Wednesday reports at month/year boundaries',()=>{
  for(const [day,meeting,start]of [['2026-10-28','2026-10-28','2026-10-22'],['2026-10-29','2026-11-04','2026-10-29'],['2026-11-04','2026-11-04','2026-10-29'],['2026-11-05','2026-11-11','2026-11-05'],['2026-12-30','2026-12-30','2026-12-24'],['2026-12-31','2027-01-06','2026-12-31'],['2027-01-01','2027-01-06','2026-12-31']]){assert.equal(meetingDate(day),meeting);const r=meetingRange(day);assert.equal(r.weekStart,start);assert.equal(r.weekEnd,meeting);assert.equal(r.weekBasis,'seoul-wednesday-v1');}
  assert.equal(weekLabel(meetingRange('2027-01-01')),'2026.12.31 ~ 2027.01.06');
  assert.equal(meetingDate(koreanToday(new Date('2026-10-28T14:59:59Z'))),'2026-10-28');assert.equal(meetingDate(koreanToday(new Date('2026-10-28T15:00:00Z'))),'2026-11-04');
  assert.equal(isoWeek('2026-10-29').monday,'2026-10-26');assert.equal(weeklyRange('2026-10-31').weekStart,'2026-10-25');
});
test('new dates normalize but editing old ISO/Sunday records does not rewrite their actual dates or stored week metadata',()=>{
  const b={date:'2026-10-31',part:'2 PART',product:'합성',manager:'담당',problem:'현황',plan:'계획',action:'실행',pnd:'원문'};
  for(const old of [{...b,...isoWeek(b.date)},{...b,...weeklyRange(b.date)},{...b,date:undefined}]){
    const changed=validateRecord('weekly',{project:'프로젝트만 수정'},old,'2026-10-31');for(const key of ['date','key','monday','weekStart','weekEnd','weekBasis','plan','action','pnd'])assert.equal(changed[key],old[key],key);
    const v=weeklyView(changed,'2026-10-31');assert.equal(v.referenceDate,'2026-10-31');assert.equal(v.meetingDate,'2026-11-04');assert.equal(v.weekStart,'2026-10-29');
  }
  const created=validateRecord('weekly',{...b,pnd:''});assert.equal(created.date,'2026-11-04');assert.equal(created.meetingDate,'2026-11-04');assert.equal(created.weekStart,'2026-10-29');
  const unknown=weeklyView({key:'2026-W44',monday:'2026-10-26'},'2026-W44');assert.equal(unknown.meetingDate,'');assert.equal(unknown.unresolvedWeek,true);
});
