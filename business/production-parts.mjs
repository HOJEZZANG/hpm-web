import {ensure} from './domain.mjs';
export const productionPart=value=>{const part=value===undefined?'part1':value;ensure(['part1','part2'].includes(part),'생산 파트를 확인하세요.');return part;};
export const isAhuEquipment=value=>/^AHU(?:$|\s|\()/i.test(String(value??'').trim())||/^OFFSHORE AHU$/i.test(String(value??'').trim());
export function assertPartRow(data,part){
  const ahu=['LINE 5000','제조사양관리구분'].some(k=>isAhuEquipment(data[k]));
  ensure(part==='part2'?isAhuEquipment(data['LINE 5000']):!ahu,part==='part2'?'2파트(AHU) 장비 양식이 아닙니다.':'AHU 자료는 2파트(AHU)에서 반영하세요.');
}
