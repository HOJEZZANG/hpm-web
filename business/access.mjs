import {ensure} from './domain.mjs';
export const collections={weekly:'weekly_issues',safety:'safety_checks',people:'meal_people',vehicles:'vehicles',notices:'notices'};
export const adminTypes=new Set(['people','vehicles','notices']);
export const idOk=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(id);
export const now=()=>new Date().toISOString();
export const readRow=r=>({id:r.id,owner:r.owner,revision:r.revision,createdAt:r.created_at,updatedAt:r.updated_at,...JSON.parse(r.data)});
export const admin=u=>ensure(u?.role==='admin','관리자 권한이 필요합니다.',403);
export const own=(u,r)=>ensure(u.role==='admin'||r.owner===u.id,'본인이 등록한 기록만 변경할 수 있습니다.',403);
