// Only the HKA forms verified in the input schemas are normalized. Hull identifiers are untouched.
export function normalizeAhuModel(value,side='plan'){
  const raw=String(value??'').trim(),model=side==='erp'?raw.split('/')[0].trim():raw;
  if(!model)return {raw,model,key:'',value:'',reason:side==='erp'?'ERP 품번 누락':'생산계획 규격 누락'};
  const text=model.toUpperCase();
  if(side==='erp'?/^HKA[\s-]*0*1312$/.test(text):/^HKA[\s-]*0*13\s*\/\s*0*12$/.test(text))return {raw,model,key:'HKA|13/12',value:'HKA-13/12',reason:''};
  const match=/^HKA[\s-]*(\d+)[\s-]*(SN|SO)((?:[\s-]+[A-Z0-9]+)*)$/.exec(text);
  if(match){const number=match[1].replace(/^0+(?=\d)/,''),options=match[3].trim().replace(/\s*-\s*/g,'-').replace(/\s+/g,'-').replace(/^-+/,'');
    return {raw,model,key:JSON.stringify(['HKA',number,match[2],options]),value:`HKA-${number}${match[2]}${options?'-'+options:''}`,reason:''};}
  return {raw,model,key:'',value:'',reason:'확인되지 않은 규격 형식: 원본 모델을 보존하며 자동 연결하지 않음'};
}

// Only these user-confirmed pairs share a yard identity.
export const CONFIRMED_YARD_PAIRS=Object.freeze([
  ['HSH','HSHI'],
  ['JO-ENG','제이오 엔지니어링'],
  ['KYT','한국야나세 통영조선소'],
  ['DHS','DHSCO'],
  ['HNW','DSME'],
  ['HSM','HIPSON MARINE']
].map(pair=>Object.freeze(pair)));
const yardKey=value=>String(value??'').replace(/\s+/g,'').toUpperCase();
const confirmedYards=new Map();
for(const [code,label] of CONFIRMED_YARD_PAIRS){
  const group={code,relation:code+'/'+label+' 동일 야드 적용'};
  confirmedYards.set(yardKey(code),group);
  confirmedYards.set(yardKey(label),group);
}
export function canonicalYardCode(value){
  const key=yardKey(value);
  return confirmedYards.get(key)?.code??key;
}
export function confirmedYardRelation(a,b){
  const left=yardKey(a),right=yardKey(b),group=confirmedYards.get(left);
  return left!==right&&group&&group===confirmedYards.get(right)?group.relation:'';
}

const distinctCodes=new Set(['KSB','HMD','SHI','HHI','HJS',...CONFIRMED_YARD_PAIRS.map(([code])=>code)]);
export function confirmedYardConflict(erpYard,planYard,aliases={}){
  const a=canonicalYardCode(erpYard),original=String(planYard??'').trim(),planCode=canonicalYardCode(original);
  const b=distinctCodes.has(planCode)||!Object.hasOwn(aliases,original)?planCode:canonicalYardCode(aliases[original]);
  return distinctCodes.has(a)&&distinctCodes.has(b)&&a!==b;
}
