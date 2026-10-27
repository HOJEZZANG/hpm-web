// Bounded OOXML reader dedicated to the local comparison. Existing production import is untouched.
import {unzipSync,strFromU8} from 'fflate';
import {SaxesParser} from 'saxes';
import {inspectZip} from './excel.mjs';
import {AHU_LIMITS as L,calendarDate,identity} from './ahu-pnd.mjs';
import {formattedNumber} from './ahu-cells.mjs';
const requireValue=(ok,message)=>{if(!ok)throw Error(message);};
export function columnLabel(n){let s='';for(;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
function xml(source,handlers){
  requireValue(source!=null,'엑셀 내부 XML이 누락되었습니다.');const p=new SaxesParser();
  p.on('doctype',()=>{throw Error('DOCTYPE/외부 엔티티는 지원하지 않습니다.');});p.on('error',()=>{throw Error('엑셀 XML이 손상되었습니다.');});
  p.on('opentag',n=>handlers.open?.(n.name.split(':').at(-1),n.attributes));p.on('closetag',n=>handlers.close?.(n.name.split(':').at(-1)));p.on('text',t=>handlers.text?.(t));p.on('cdata',t=>handlers.text?.(t));p.write(source).close();
}
export function openAhuWorkbook(bytes){
  inspectZip(bytes,{file:L.file,expanded:L.expanded});
  const files=unzipSync(bytes),get=name=>files[name]?strFromU8(files[name]):null,sheets=[],rels=new Map(),formats=new Map(),styles=[],shared=[];let date1904=false;
  xml(get('xl/workbook.xml'),{open(n,a){if(n==='workbookPr')date1904=['1','true'].includes(a.date1904);if(n==='sheet')sheets.push({name:a.name,relation:a['r:id']});}});
  requireValue(sheets.length>0,'워크시트가 없습니다.');
  xml(get('xl/_rels/workbook.xml.rels'),{open(n,a){if(n==='Relationship'&&a.TargetMode!=='External'){const path=a.Target.startsWith('/')?a.Target.slice(1):'xl/'+a.Target.replace(/^\.\//,'');rels.set(a.Id,path);}}});
  for(const sheet of sheets){sheet.path=rels.get(sheet.relation);requireValue(/^xl\/worksheets\/[A-Za-z0-9_.-]+\.xml$/.test(sheet.path),'지원하지 않는 워크시트 경로입니다.');}
  if(files['xl/styles.xml']){let inXfs=false;xml(get('xl/styles.xml'),{open(n,a){if(n==='numFmt')formats.set(Number(a.numFmtId),a.formatCode);if(n==='cellXfs')inXfs=true;else if(n==='xf'&&inXfs)styles.push(Number(a.numFmtId||0));},close(n){if(n==='cellXfs')inXfs=false;}});}
  if(files['xl/sharedStrings.xml']){let active=false,capture=false,text='',phonetic=0;xml(get('xl/sharedStrings.xml'),{open(n){if(n==='si'){active=true;text='';}if(n==='rPh')phonetic++;if(n==='t')capture=true;},text(t){if(active&&capture&&!phonetic)text+=t;},close(n){if(n==='t')capture=false;if(n==='rPh')phonetic--;if(n==='si'){requireValue(text.length<=32767&&shared.length<L.cells,'공유 문자열 처리 한계를 초과했습니다.');shared.push(text);active=false;}}});}
  function readSheet(index){
    requireValue(Number.isInteger(index)&&sheets[index],'시트를 선택하세요.');const rows=[],used=new Set();let row=null,cell=null,capture='',count=0,textSize=0,lastRow=0,lastColumn=0;
    xml(get(sheets[index].path),{open(n,a){
      if(n==='row'){const number=a.r?Number(a.r):lastRow+1;requireValue(Number.isInteger(number)&&number>lastRow&&number<=1048576,'원본 행 위치 또는 중복 행을 확인하세요.');lastRow=number;row={number,cells:new Map()};lastColumn=0;}
      if(n==='c'){requireValue(row,'행 정보 없는 셀입니다.');const ref=a.r?/^([A-Z]+)(\d+)$/.exec(a.r):null;let column=lastColumn+1;if(a.r){requireValue(ref&&+ref[2]===row.number,'셀 위치를 확인하세요.');column=[...ref[1]].reduce((v,c)=>v*26+c.charCodeAt(0)-64,0);}requireValue(column>0&&column<=16384&&!row.cells.has(column),'열 위치 또는 중복 셀을 확인하세요.');lastColumn=column;cell={column,type:a.t||'n',style:+a.s||0,value:'',inline:'',formula:false};}
      if(n==='f'&&cell){cell.formula=true;capture='f';}if(cell&&(n==='v'||n==='t'))capture=n;
    },text(t){if(!cell||!capture)return;if(capture==='v')cell.value+=t;if(capture==='t')cell.inline+=t;requireValue(cell.value.length<=32767&&cell.inline.length<=32767,'셀 텍스트는 32,767자 이내이어야 합니다.');},close(n){
      if(['v','t','f'].includes(n))capture='';
      if(n==='c'){
        let value=cell.value,issue='';if(cell.type==='s'){requireValue(/^\d+$/.test(value)&&+value<shared.length,'공유 문자열 참조 오류입니다.');value=shared[+value];}else if(cell.type==='inlineStr')value=cell.inline;
        else if(cell.type==='n'&&value!==''){requireValue(Number.isFinite(Number(value)),'숫자 셀 오류입니다.');value=Number(value);}else if(!['n','str','d'].includes(cell.type))issue='오류 또는 지원하지 않는 셀 형식';
        if(cell.formula&&cell.value==='')issue='수식의 저장된 계산값 없음 (수식은 실행하지 않음)';
        const numFmt=styles[cell.style]||0,builtins={0:'General',1:'0',2:'0.00',3:'#,##0',4:'#,##0.00',9:'0%',10:'0.00%',11:'0.00E+00',12:'# ?/?',13:'# ??/??',49:'@'},format=formats.get(numFmt)||([14,15,16,17,22,27,30,36,50,57].includes(numFmt)?'yyyy-mm-dd':builtins[numFmt]||'unsupported');
        const formatted=typeof value==='number'?formattedNumber(cell.value,format):{display:String(value)};
        const display=typeof value==='number'&&/[yd]/i.test(format.replace(/"[^"]*"/g,''))?(calendarDate(value,date1904).iso||String(value)):formatted.display;
        if(value!==''||cell.formula||issue){count++;textSize+=display.length*2;requireValue(count<=L.cells&&textSize<=L.text,'유효 셀 250,000개 또는 텍스트 16MiB 한계를 초과했습니다. 자료를 나누세요.');row.cells.set(cell.column,{value,display,issue,keyIssue:issue||formatted.keyIssue||'',formula:cell.formula});used.add(cell.column);requireValue(used.size<=L.columns,'사용 열 256개 한계를 초과했습니다. 필요한 열만 포함한 파일을 준비하세요.');}cell=null;
      }
      if(n==='row'&&row.cells.size){rows.push(row);requireValue(rows.length<=L.rows,'시트의 유효 행 20,000개 한계를 초과했습니다. 자료를 나누세요.');}
    }});
    const columns=[...used].sort((a,b)=>a-b);return {name:sheets[index].name,date1904,rows,columns,preview:{columns,rows:rows.map(r=>({number:r.number,values:columns.map(c=>r.cells.get(c)?.display||'')})),cellCount:count}};
  }
  return {sheets:sheets.map(s=>s.name),readSheet};
}
export function extractAhuRows(sheet,config,file){
  const {header,yard,hull,pnd,selected}=config;
  requireValue(Number.isInteger(header)&&header>=1&&sheet.rows.some(r=>r.number===header),'내용이 있는 헤더 행 번호를 선택하세요.');
  requireValue(new Set([yard,hull,pnd]).size===3&&[yard,hull,pnd].every(c=>sheet.columns.includes(c)),'야드·호선번호·PND에 서로 다른 열을 선택하세요.');
  const picks=new Set(selected);requireValue(picks.size>0||config.targetConfirmed===true,'AHU 대상 행을 직접 선택하세요. 0행이라면 현재 필터 전체 0행 선택으로 확인하세요.');
  const rows=sheet.rows.filter(r=>picks.has(r.number));requireValue(rows.length===picks.size&&rows.every(r=>r.number>header),'대상 행은 선택 시트의 헤더 다음 데이터 행이어야 합니다.');
  return rows.map(r=>{const y=r.cells.get(yard),h=r.cells.get(hull),p=r.cells.get(pnd);return {file,sheet:sheet.name,row:r.number,yard:identity(y?.display),hull:identity(h?.display),pnd:p?.value??'',notices:sheet.notices||[],keyIssue:[y?.keyIssue?`야드: ${y.keyIssue}`:'',h?.keyIssue?`호선번호: ${h.keyIssue}`:''].filter(Boolean).join(' / '),date:p?.issue?{iso:'',reason:p.issue}:calendarDate(p?.value??'',sheet.date1904)};});
}
