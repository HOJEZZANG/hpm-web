// Extension and container checks precede the format-specific reader. No file conversion.
import {openAhuWorkbook as openXlsx} from './ahu-xlsx.mjs';
import {openAhuXls} from './ahu-xls.mjs';
import {AHU_LIMITS as L} from './ahu-pnd.mjs';
export function openAhuWorkbook(bytes,filename=''){
  if(!bytes.length||bytes.length>L.file)throw Error('엑셀 파일은 10MiB 이하이어야 합니다.');
  const ole=[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1],format=ole.every((n,i)=>bytes[i]===n)?'xls':bytes[0]===0x50&&bytes[1]===0x4b?'xlsx':null;
  if(!format)throw Error('실제 .xls(BIFF) 또는 .xlsx 통합문서가 아닙니다. HTML·XML·텍스트를 .xls로 표시한 파일은 현재 지원하지 않습니다.');
  if(filename&&!filename.toLowerCase().endsWith('.'+format))throw Error(`파일 확장자와 실제 ${format==='xls'?'.xls(BIFF)':'.xlsx'} 형식이 다릅니다. 확장자만 변경한 파일은 사용할 수 없습니다.`);
  return {format,...(format==='xls'?openAhuXls(bytes):openXlsx(bytes))};
}
