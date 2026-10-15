import {BusinessError,ensure,text,date,isoWeek,koreanToday,addDays} from './domain.mjs';
import {bodyJson} from './http.mjs';
import {idOk,now,readRow,own} from './access.mjs';
export async function bookings(req,env,u,id,url){
  if(!id&&req.method==='GET'){
    const start=isoWeek(date(url.searchParams.get('week')||koreanToday())).monday;
    const {results}=await env.DB.prepare('SELECT * FROM vehicle_bookings WHERE day>=? AND day<=? ORDER BY day,start_time,id').bind(start,addDays(start,6)).all();
    return {records:results.map(r=>({...readRow(r),vehicleId:r.vehicle_id,date:r.day,start:r.start_time,end:r.end_time,cancelled:!!r.cancelled}))};
  }
  ensure(idOk(id),'예약 ID를 확인하세요.');ensure(['PUT','DELETE'].includes(req.method),'지원하지 않는 요청입니다.',405);
  const b=await bodyJson(req),old=await env.DB.prepare('SELECT * FROM vehicle_bookings WHERE id=?').bind(id).first();
  if(old){own(u,old);ensure(old.revision===b.revision,'다른 PC에서 예약을 수정했습니다.',409);}
  if(req.method==='DELETE'){
    if(!old)return {cancelled:false};
    const result=await env.DB.prepare('UPDATE vehicle_bookings SET cancelled=1,revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(now(),id,b.revision).run();ensure(result.meta.changes===1,'예약이 변경되었습니다.',409);return {cancelled:true};
  }
  ensure(!old?.cancelled,'취소된 예약은 변경할 수 없습니다. 새로 예약하세요.',409);
  const day=date(b.date,'이용일');ensure(idOk(b.vehicleId),'차량을 선택하세요.');
  const car=await env.DB.prepare('SELECT data FROM vehicles WHERE id=?').bind(b.vehicleId).first();ensure(car&&JSON.parse(car.data).active,'사용 가능한 차량을 선택하세요.');
  ensure(/^([01]\d|2[0-3]):[0-5]\d$/.test(b.start)&&/^([01]\d|2[0-3]):[0-5]\d$/.test(b.end)&&b.start<b.end,'이용 시작/종료시간을 확인하세요.');
  const data={applicant:text(b.applicant,'신청자',100,true),purpose:text(b.purpose,'용도',1000,true),remark:text(b.remark??'','비고',1000)};
  try{
    const stamp=now();let result;
    if(old)result=await env.DB.prepare('UPDATE vehicle_bookings SET vehicle_id=?,day=?,start_time=?,end_time=?,data=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(b.vehicleId,day,b.start,b.end,JSON.stringify(data),stamp,id,b.revision).run();
    else {ensure(!b.revision,'대상 예약이 없습니다.',409);result=await env.DB.prepare('INSERT INTO vehicle_bookings(id,vehicle_id,day,start_time,end_time,owner,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,b.vehicleId,day,b.start,b.end,u.id,JSON.stringify(data),stamp,stamp).run();}
    ensure(result.meta.changes===1,'예약이 변경되었습니다. 새로 조회하세요.',409);
  }catch(e){if(/BOOKING_CONFLICT/.test(e.message))throw new BusinessError(409,'차량 이용 시간이 기존 예약과 겹칩니다. 다른 시간을 선택하세요.');throw e;}
  return {saved:true};
}
