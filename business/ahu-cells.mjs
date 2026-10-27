// Identifier formatting shared by the XLSX and BIFF XLS readers. Never coerce text identifiers.
export function formattedNumber(raw,format){
  const n=Number(raw);if(!Number.isFinite(n))return {display:raw,keyIssue:'숫자 셀 오류'};
  if(!Number.isSafeInteger(n)||String(Math.abs(n)).length>15)return {display:raw,keyIssue:'숫자형 식별자의 정밀도·표시 형식 확인 필요'};
  if(!format||['General','@','0'].includes(format))return {display:String(n)};
  if(format.includes(';'))return {display:raw,keyIssue:'다중 구간 식별자 숫자 서식 확인 필요 (원본을 텍스트로 확인)'};
  const section=format;let mask='',quoted=false;
  for(let i=0;i<section.length;i++){
    const c=section[i];if(c==='"'){quoted=!quoted;continue;}if(c==='\\'){mask+='L'+(section[++i]||'');continue;}
    if(quoted){mask+='L'+c;continue;}if(c==='0')mask+='0';else if(c==='-'||c===' ')mask+='L'+c;else return {display:raw,keyIssue:'식별자 숫자 표시 서식을 안전하게 해석할 수 없음 (원본을 텍스트로 확인)'};
  }
  const count=[...mask.matchAll(/0|L[\s\S]/g)].filter(x=>x[0]==='0').length;
  if(!count||n<0)return {display:raw,keyIssue:'식별자 숫자 서식 확인 필요'};
  let digits=String(n).padStart(count,'0'),cursor=0;const extra=digits.length-count;let display=digits.slice(0,extra);digits=digits.slice(extra);
  for(const token of mask.matchAll(/0|L[\s\S]/g))display+=token[0]==='0'?digits[cursor++]:token[0].slice(1);
  return {display};
}
