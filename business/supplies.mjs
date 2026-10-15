import {ensure,text} from './domain.mjs';
import {createWorkbook} from './excel.mjs';
import {bodyJson,binary} from './http.mjs';
import {idOk,now,own} from './access.mjs';
export async function orders(req,env,u,id,url){
  if(req.method==='GET'){
    const records=(await env.DB.prepare(`SELECT * FROM supply_orders${u.role==='admin'?'':' WHERE owner=?'} ORDER BY created_at DESC LIMIT 1000`).bind(...(u.role==='admin'?[]:[u.id])).all()).results.map(r=>({...r,lines:JSON.parse(r.lines)}));
    if(url.searchParams.get('download')==='1')return binary(await createWorkbook(['신청일','신청자','부서','용도','품목코드','품목명','규격','단위','수량','단가'],records.flatMap(r=>r.lines.map(l=>({'신청일':r.created_at,'신청자':r.applicant,'부서':r.department,'용도':r.purpose,...l.item,'수량':l.quantity})))),'소모품_신청내역.xlsx');
    return {records};
  }
  ensure(req.method==='PUT'&&idOk(id),'신청 ID를 확인하세요.');
  const b=await bodyJson(req);const applicant=text(b.applicant,'신청자',100,true),department=text(b.department,'부서',100,true),purpose=text(b.purpose,'용도',1000,true);
  ensure(Array.isArray(b.lines)&&b.lines.length>0&&b.lines.length<=50,'1~50개 품목을 선택하세요.');const lines=[],seen=new Set();
  for(const l of b.lines){ensure(l&&typeof l==='object'&&!Array.isArray(l),'신청 품목 형식을 확인하세요.');ensure(idOk(l.id)&&!seen.has(l.id),'품목이 중복되었거나 올바르지 않습니다.');seen.add(l.id);ensure(Number.isInteger(l.quantity)&&l.quantity>0&&l.quantity<=100000,'수량은 1~100,000 정수여야 합니다.');const item=await env.DB.prepare('SELECT data FROM supply_items WHERE id=?').bind(l.id).first();ensure(item,'등록된 품목을 선택하세요.');lines.push({id:l.id,quantity:l.quantity,item:JSON.parse(item.data)});}
  const existing=await env.DB.prepare('SELECT * FROM supply_orders WHERE id=?').bind(id).first();if(existing){own(u,existing);ensure(existing.applicant===applicant&&existing.department===department&&existing.purpose===purpose&&existing.lines===JSON.stringify(lines),'이미 저장된 신청입니다. 새 신청으로 등록하세요.',409);return {saved:true,retry:true};}
  const result=await env.DB.prepare('INSERT INTO supply_orders(id,owner,applicant,department,purpose,lines,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,u.id,applicant,department,purpose,JSON.stringify(lines),now()).run();ensure(result.meta.changes===1,'동일 신청 ID가 있습니다. 조회 후 확인하세요.',409);return {saved:true};
}
