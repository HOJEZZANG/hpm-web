// Add this entry point beside the backed-up current worker.js; do not replace its contents.
import legacy from './worker.js';
import {READ_PATH,readOnlyProduction} from './hpm-readonly.mjs';
export default {
  ...legacy,
  async fetch(request,env,ctx){
    const path=new URL(request.url).pathname;
    if(path===READ_PATH)return readOnlyProduction(request,env);
    // Never let the read credential reach legacy routes, including GET routes that run DDL.
    if(path.startsWith('/api/')&&env.HPM_READ_TOKEN&&[
      request.headers.get('X-Admin-Token'),request.headers.get('X-HPM-Read-Token'),
      request.headers.get('Authorization')?.replace(/^Bearer /,'')
    ].includes(env.HPM_READ_TOKEN))return new Response(JSON.stringify({error:'조회 전용 인증으로 접근할 수 없습니다.'}),{status:401,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
    return legacy.fetch(request,env,ctx);
  }
};
