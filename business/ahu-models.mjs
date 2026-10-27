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

// Distinct yard identities confirmed by Yard/project-company fields. No alias is inferred.
const distinctCodes=new Set(['KSB','HSH','HNW','HMD','SHI','DHS','HHI','KYT','HJS']);
export function confirmedYardConflict(erpYard,planYard,aliases={}){
  const a=String(erpYard??'').trim(),original=String(planYard??'').trim(),b=distinctCodes.has(original)?original:(Object.hasOwn(aliases,original)?aliases[original]:original);
  return distinctCodes.has(a)&&distinctCodes.has(b)&&a!==b;
}
