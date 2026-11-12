import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarDate} from '../business/ahu-pnd.mjs';
import {compareProductionPnd,pndExportRows,pndExportColumns} from '../business/ui/pnd-comparison.js';
import {openAhuWorkbook} from '../business/ahu-workbook.mjs';
import {extractAhuRows} from '../business/ahu-xlsx.mjs';
import {applyAhuPreset} from '../business/ahu-presets.mjs';
import {ahuPresetFixture} from './support/ahu-pnd-fixtures.mjs';

const pairs=[
  ['HSH','HSHI'],['JO-ENG','제이오 엔지니어링'],['KYT','한국야나세 통영조선소'],
  ['DHS','DHSCO'],['HNW','DSME'],['HSM','HIPSON MARINE']
];
const row=(yard,side,extra={})=>({yard,hull:'QA-YARD-01',spec:'HKA-10SO',row:side==='erp'?3:7,
  file:'synthetic-'+side+'.xlsx',sheet:side==='erp'?'Sheet1':'ALL',pnd:side==='erp'?'2027-02-18':'2027-02-24',
  date:calendarDate(side==='erp'?'2027-02-18':'2027-02-24'),...extra});
const formatted=value=>' \t'+[...value.toLowerCase()].join(' \n')+'\n ';

test('all six approved pairs match both ways after case/whitespace normalization and retain exact original yards',()=>{
  for(const pair of pairs)for(const [left,right]of [pair,[...pair].reverse()]){
    for(const [erpYard,planYard]of [[left,right],[formatted(left),formatted(right)]]){
      const erp=row(erpYard,'erp'),plan=row(planYard,'plan'),before=structuredClone({erp,plan});
      const results=compareProductionPnd({erp:[erp],plan:[plan]});
      assert.equal(results.length,1);
      const [result]=results;
      assert.equal(result.label,'6일 당겨짐');assert.equal(result.diff,-6);
      assert(result.yardVerified&&result.candidates[0].yard&&result.candidates[0].eligible);
      const relation=pair.join('/')+' 동일 야드 적용';
      assert(result.linkBasis.includes(relation));assert(result.candidates[0].reason.includes(relation));
      assert.equal(result.erpYard,erpYard);assert.equal(result.planYard,planYard);
      assert.equal(result.erp[0].yard,erpYard);assert.equal(result.plan[0].yard,planYard);
      const [cells]=pndExportRows(results);
      assert.equal(cells[pndExportColumns.indexOf('ERP 원본 야드')],erpYard);
      assert.equal(cells[pndExportColumns.indexOf('생산계획 원본 야드')],planYard);
      assert(cells[pndExportColumns.indexOf('연결 근거')].includes(relation));
      assert.deepEqual({erp,plan},before);
    }
  }
});

test('yard-only candidate lookup uses each approved pair while hull/specification and mutual uniqueness stay mandatory',()=>{
  for(const pair of pairs)for(const [left,right]of [pair,[...pair].reverse()]){
    const erp=row(formatted(left),'erp'),plan=row(formatted(right),'plan');
    const yardOnly=compareProductionPnd({erp:[erp],plan:[{...plan,hull:'QA-OTHER',spec:'HKA-08SN'}]});
    assert(yardOnly.every(r=>!r.linked&&r.candidateCount===1&&r.candidates[0].yard&&!r.candidates[0].eligible));
    for(const options of [
      {erp:[erp],plan:[plan,{...plan,yard:left,row:8}]},
      {erp:[erp,{...erp,yard:right,row:4}],plan:[plan]}
    ]){
      const results=compareProductionPnd(options);
      assert.equal(results.length,3);
      assert(results.every(r=>!r.linked&&r.diff===null&&r.reasons.some(reason=>reason.includes('복수 후보'))));
      assert.equal(new Set(results.flatMap(r=>[...r.erp,...r.plan]).map(r=>r.sourceId)).size,3);
    }
  }
});

test('different confirmed groups and unlisted similar strings never become the same yard',()=>{
  for(let i=0;i<pairs.length;i++)for(let j=0;j<pairs.length;j++){
    if(i===j)continue;
    const erpYard=formatted(pairs[i][1]),planYard=formatted(pairs[j][1]);
    const results=compareProductionPnd({erp:[row(erpYard,'erp')],plan:[row(planYard,'plan')],aliases:{[planYard.trim()]:erpYard}});
    assert(results.every(r=>!r.linked&&r.diff===null&&r.candidates.every(c=>!c.yard)));
  }
  for(const [a,b]of [['JO-ENG','JOENG'],['KYT','한국야나세 통영조선소X'],['DHS','DHSCO-1'],['HNW','DSME2'],['HSM','HIPSON MARINEX'],['HSH','HSHII']]){
    const results=compareProductionPnd({erp:[row(a,'erp')],plan:[row(b,'plan')]});
    assert(results.every(r=>!r.linked&&r.candidates.every(c=>!c.yard)));
  }
  const [formatOnly]=compareProductionPnd({erp:[row(' Other Yard\nA ','erp')],plan:[row('OTHER\tYARD A','plan')]});
  assert(formatOnly.linked);assert(formatOnly.linkBasis.includes('대소문자·공백 정리'));
});

test('actual XLS and XLSX readers preserve original spaces/newlines through both-direction comparison and export',async()=>{
  for(const format of ['xlsx','xls'])for(const pair of pairs)for(const direction of [pair,[...pair].reverse()]){
    const sources={};
    for(const [index,side]of ['erp','plan'].entries()){
      const yard=' '+direction[index].toLowerCase().replaceAll(' ','\n')+'\n ';
      const fixture=await ahuPresetFixture(side,format,sheet=>{
        const erp=side==='erp',r=erp?3:7;
        for(const [column,value]of erp?[[4,yard],[5,'QA-READER-01'],[8,'2027-02-18'],[10,'HKA-10SO']]:[[2,yard],[3,'QA-READER-01'],[6,'HKA-10SO'],[16,'2027-02-24']])sheet.getCell(r,column).value=value;
      });
      const sheet=openAhuWorkbook(fixture.bytes,fixture.filename).readSheet(0),preset=applyAhuPreset(side,sheet.preview);
      assert(preset.ready);
      const extracted=extractAhuRows(sheet,{...preset.config,selected:[side==='erp'?3:7],targetConfirmed:true},fixture.filename);
      assert.equal(extracted[0].yard,yard);sources[side]=extracted;
    }
    const result=compareProductionPnd(sources);
    assert.equal(result.length,1);assert.equal(result[0].label,'6일 당겨짐');
    const [cells]=pndExportRows(result);
    assert.equal(cells[pndExportColumns.indexOf('ERP 원본 야드')],sources.erp[0].yard);
    assert.equal(cells[pndExportColumns.indexOf('생산계획 원본 야드')],sources.plan[0].yard);
  }
});
