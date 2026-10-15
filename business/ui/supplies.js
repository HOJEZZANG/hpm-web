import {$,api,esc,field,table,button,run,message,jsonOptions,download,shell,uid} from './common.js';
import {importPanel,wireImports} from './imports.js';
export async function init(root){
  shell(root,'현장 소모품 신청','품목과 신청 내역은 서버에 저장합니다. 신청자는 본인 내역, 관리자는 전체 내역을 조회합니다.',`${importPanel('supplies')}<div class="business-toolbar">${field('search','품목명 · 코드 · 규격 검색','search')}${button('검색','data-search')}</div><div data-items></div><h2>신청 바구니</h2><div data-cart></div><form class="business-form card">${field('applicant','신청자','text',{required:true,max:100})}${field('department','부서','text',{required:true,max:100})}${field('purpose','용도','textarea',{required:true})}<div class="wide"><button type="submit" class="btn primary">바구니 신청 저장</button></div></form><div class="business-toolbar"><h2>신청 내역</h2>${button('내역 새로 조회','data-orders')}${button('신청 내역 엑셀 다운로드','data-export-orders')}</div><div data-orders-list></div>`);
  let items=[],cart=new Map(),batch='',orderId=uid();const form=$('form',root);
  const renderCart=()=>{$('[data-cart]',root).innerHTML=table(['품목코드','품목명','규격','단위','단가',{label:'수량',key:'quantity'}],[...cart.values()],r=>`<input aria-label="${esc(r['품목명'])} 신청 수량" type="number" min="1" max="100000" step="1" value="${r.quantity}" data-quantity="${esc(r.id)}">${button('빼기',`data-remove="${esc(r.id)}"`)}`);};
  const load=async id=>{if(id!==undefined)batch=id;items=(await api('supplies?'+new URLSearchParams({import:batch,q:$('[name=search]',root).value}))).records;$('[data-items]',root).innerHTML=table(['품목코드','품목명','규격','단위','단가','모델번호'],items,(r,i)=>button('담기',`data-add="${i}"`));};
  const loadOrders=async()=>{const {records}=await api('orders');$('[data-orders-list]',root).innerHTML=table([{label:'신청일',key:'created_at'},{label:'신청자',key:'applicant'},{label:'부서',key:'department'},{label:'용도',key:'purpose'},{label:'품목 / 수량',value:r=>r.lines.map(l=>l.item['품목명']+' '+l.quantity+l.item['단위']).join(', ')}],records);};
  root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
    if(b.hasAttribute('data-search'))void run(root,b,()=>load());
    if(b.hasAttribute('data-orders'))void run(root,b,loadOrders);
    if(b.hasAttribute('data-export-orders'))void run(root,b,()=>download('orders?download=1','소모품_신청내역.xlsx'));
    if(b.dataset.add!==undefined){const r=items[Number(b.dataset.add)];if(cart.size>=50&&!cart.has(r.id)){message(root,'최대 50개 품목까지 담을 수 있습니다.',true);return;}cart.set(r.id,{...r,quantity:(cart.get(r.id)?.quantity||0)+1});renderCart();}
    if(b.dataset.remove){cart.delete(b.dataset.remove);renderCart();}
  });
  root.addEventListener('input',e=>{if(e.target.dataset.quantity){const item=cart.get(e.target.dataset.quantity);item.quantity=Number(e.target.value);}});
  form.onsubmit=e=>{e.preventDefault();const draft={...Object.fromEntries(new FormData(form)),lines:[...cart.values()].map(r=>({id:r.id,quantity:r.quantity}))};void run(root,$('[type=submit]',form),async()=>{await api('orders/'+orderId,jsonOptions('PUT',draft));cart.clear();orderId=uid();renderCart();message(root,'서버에서 신청 저장을 확인했습니다.');await loadOrders();});};
  await wireImports(root,'supplies',load);renderCart();await run(root,null,loadOrders);
}
