import {ensure} from './domain.mjs';
import {productionPart} from './production-parts.mjs';
import {canonicalYardCode} from './ahu-models.mjs';
const text=v=>String(v??'').normalize('NFKC').trim().toUpperCase();
const products=r=>[r['규격'],r['제품 규격'],r['품번'],r['프로젝트번호'],r['프로젝트명'],r['LINE 5000'],r['분류'],r['제조사양관리구분']].map(text).filter(Boolean);
export function classifyProductionLinks(row,records){
 const keys=products(row),hull=text(row.HullNo),yard=canonicalYardCode(row.Yard);
 const candidates=records.filter(r=>r.hull&&text(r.hull)===hull||r.project&&String(r.project).normalize('NFKC').trim().toUpperCase().split(/[\s/,;:()]+/).includes(hull));
 const strong=candidates.filter(r=>r.hull&&text(r.hull)===hull&&yard&&canonicalYardCode(r.yard)===yard&&[r.spec,r.product,r.project].some(v=>keys.includes(text(v))));
 return {records:candidates,confirmed:strong.length===1&&candidates.length===1,basis:candidates.length>1?'후보가 여러 개입니다. 야드·호선·프로젝트/제품을 확인하고 기록을 선택하세요.':strong.length===1?'야드 별칭·호선·프로젝트/제품 일치':candidates.length?'호선 후보만 확인됨 · 야드·프로젝트/제품 근거를 직접 확인하세요.':'연결 가능한 식별 정보가 확인되지 않았습니다.'};
}
export async function productionRelated(req,env,url){
 ensure(req.method==='GET','조회만 가능합니다.',405);const part=productionPart(url.searchParams.get('part')??undefined),id=url.searchParams.get('row');ensure(typeof id==='string'&&id.length<=160,'생산 행을 선택하세요.');
 const saved=await env.DB.prepare("SELECT p.data FROM production_rows p JOIN plan_imports i ON i.id=p.import_id WHERE p.id=? AND i.production_part=? AND i.status='applied'").bind(id,part).first();ensure(saved,'선택한 파트의 반영된 생산 행이 아닙니다.',404);const row=JSON.parse(saved.data);
 if(!text(row.HullNo))return {groups:[],message:'호선 식별 정보가 없어 연결을 생략했습니다.'};
 const pattern='%'+String(row.HullNo).replace(/[\\%_]/g,'\\$&')+'%';
 const [{results:issues},{results:weekly}]=await Promise.all([
  env.DB.prepare("SELECT * FROM issues WHERE hull_no LIKE ? ESCAPE '\\' OR project_no LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT 201").bind(pattern,pattern).all(),
  env.DB.prepare("SELECT * FROM weekly_issues WHERE json_extract(data,'$.project') LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT 201").bind(pattern).all()
 ]);ensure(issues.length<=200&&weekly.length<=200,'연결 후보가 많습니다. 기존 문제점·회의록 메뉴에서 조회 범위를 좁혀 주세요.',413);
 const issueRecords=issues.map(r=>({hull:r.hull_no,yard:r.yard,project:r.project_no,spec:r.product_no,product:r.product,title:r.title||r.issue_no,date:r.register_date,fields:{'야드':r.yard,'호선':r.hull_no,'프로젝트':r.project_no,'제품 / 규격':[r.product,r.product_no].filter(Boolean).join(' / '),'문제점':r.description,'조치내용':r.action_detail,'현재 상태':r.status}}));
 const weeklyRecords=weekly.map(r=>{const d=JSON.parse(r.data);return {project:d.project,product:d.product,title:d.project||d.product,date:d.date,fields:{'프로젝트':d.project,'제품':d.product,'파트':d.part,'현황':d.problem,'계획·실행':d.planAction||[d.plan,d.action].filter(Boolean).join('\n'),'비고':d.remark}};});
 const groups=[['공정 문제점',issueRecords],['주간 팀 공정 회의록',weeklyRecords]].map(([label,records])=>({label,...classifyProductionLinks(row,records)}));
 return {groups,message:'기존 기록의 식별 정보로 조회한 읽기 전용 기록입니다. ‘호선 후보’는 자동 연결 확정이 아닙니다.'};
}
