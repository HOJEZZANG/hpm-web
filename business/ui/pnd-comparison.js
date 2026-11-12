// Browser-only comparison presentation. Reuse the verified AHU candidate matching
// and calendar readers without changing the production import/server module.
import {comparePnd as matchAhuRows,exportRows as sourceExport,exportColumns as sourceColumns} from '../ahu-pnd.mjs?v=20261112-yards';
export const PND_NOTICE='생산계획표를 기준으로 ERP 최신 PND의 변경을 비교합니다. 실제 납기 미준수나 생산 지연 판정이 아닙니다.';
export const partSupport={part1:{label:'1파트',ready:false,reason:'실제 비교 파일 검증 대기 · ERP 열과 연결 기준 확인 후 지원합니다.'},part2:{label:'2파트',ready:true}};
const comparators={part2:compareVerifiedPart2};
export function compareProductionPnd(options){
  const part=options.part||'part2';if(!partSupport[part]?.ready||!comparators[part])throw Error('1파트는 실제 비교 파일 검증 대기 상태입니다.');
  return comparators[part](options);
}
function compareVerifiedPart2({erp,plan,aliases={}}){
  const rows=matchAhuRows(erp,plan,aliases).map(result=>{
    const r={...result,diff:null,status:'review'},e=r.erp[0],p=r.plan[0];
    if(r.linked&&!r.yardVerified){r.linked=false;r.reasons=[...r.reasons,'야드 명칭 또는 별칭 연결을 직접 확인하세요.'];r.linkBasis='야드 명칭 확인 전 자동 연결 보류';r.eligibleCount=0;r.candidates=r.candidates.map(c=>({...c,eligible:false,reason:c.reason+' / 야드 명칭 확인 필요'}));}
    r.reviewKind=r.linked?'date':'link';r.label=r.linked?'날짜 확인 필요':'연결 확인 필요';
    if(r.linked&&e.date?.iso&&p.date?.iso&&!r.reasons.length){
      // Latest ERP minus the managed production-plan baseline, in calendar days.
      r.diff=e.date.day-p.date.day;
      r.status=r.diff<0?'advanced':r.diff>0?'delayed':'same';
      r.label=r.diff<0?`${Math.abs(r.diff)}일 당겨짐`:r.diff>0?`${r.diff}일 지연`:'변경 없음';r.reviewKind='';
    }
    return r;
  });
  const rank={advanced:0,delayed:1,review:2,same:3};
  return rows.sort((a,b)=>rank[a.status]-rank[b.status]||(a.status==='advanced'?a.diff-b.diff:a.status==='delayed'?b.diff-a.diff:0)||a.yard.localeCompare(b.yard,'ko')||a.hull.localeCompare(b.hull,'ko')||a.id-b.id);
}
export function filterPndResults(rows,search='',status='attention'){
  const q=search.trim().toLocaleLowerCase();return rows.filter(r=>(status==='attention'?r.status!=='same':!status||r.status===status)&&(!q||[r.erpYard,r.planYard,r.erpHull,r.planHull,r.erpSpec,r.planSpec,r.label,r.linkBasis].join(' ').toLocaleLowerCase().includes(q)));
}
export const pndExportColumns=sourceColumns.map((c,i)=>i===2?'생산계획 PND':i===3?'ERP 최신 PND':i===4?'변경 일수 (ERP-생산계획)':i===5?'변경 내용':c);
export function pndExportRows(rows){return sourceExport(rows).map(values=>{const out=[...values];[out[2],out[3]]=[out[3],out[2]];out[9]=PND_NOTICE;return out;});}
