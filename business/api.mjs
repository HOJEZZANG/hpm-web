import {BusinessError,ensure} from './domain.mjs';
import {collections} from './access.mjs';
import {recordApi} from './records.mjs';
import {bookings} from './bookings.mjs';
import {meals,menu} from './meals.mjs';
import {imports,rowsApi} from './imports.mjs';
import {orders} from './supplies.mjs';
import {search} from './search.mjs';
// Authentication is supplied by the Worker; this module never trusts browser identity fields.
export async function businessApi(req,env,user){
  ensure(user?.id&&['user','admin'].includes(user.role),'서버 로그인이 필요합니다.',401);
  ensure(env.DB&&env.PHOTOS,'DB 및 R2 연결을 확인하세요.',503);
  const url=new URL(req.url),parts=url.pathname.replace(/^\/api\/business\/?/,'').split('/'),[type,id,action]=parts;
  if(collections[type]){
    try{return await recordApi(req,env,user,type,id,url);}catch(e){if(type==='vehicles'&&/UNIQUE.*vehicle_number|UNIQUE.*vehicles/i.test(e.message))throw new BusinessError(409,'같은 차량번호가 이미 등록되어 있습니다. 기존 차량을 수정하세요.');throw e;}
  }
  if(type==='bookings')return bookings(req,env,user,id,url);
  if(type==='meals')return meals(req,env,user,url);
  if(type==='menus')return menu(req,env,user,id,url);
  if(type==='imports')return imports(req,env,user,id,action,url);
  if(type==='production'||type==='supplies'){ensure(req.method==='GET','조회만 가능합니다.',405);return rowsApi(env,type,url);}
  if(type==='orders')return orders(req,env,user,id,url);
  if(type==='search'){ensure(req.method==='GET','조회만 가능합니다.',405);return search(env,user,url);}
  throw new BusinessError(404,'요청한 업무 API가 없습니다.');
}
