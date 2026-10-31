// Small, synchronous OOXML reader/writer for bounded tabular imports in Workers.
// No formula evaluation, macros, external fetches, DOM, Node APIs or event-loop shims.
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
import {SaxesParser} from 'saxes';
import {ensure} from './domain.mjs';
function xml(source,handlers,max=32*1024*1024){
  ensure(typeof source==='string'&&source.length<=max,'엑셀 XML 크기 제한을 초과했습니다.');
  const parser=new SaxesParser();parser.on('doctype',()=>ensure(false,'DOCTYPE/외부 엔티티는 허용하지 않습니다.'));
  parser.on('error',()=>ensure(false,'엑셀 XML 구조가 올바르지 않습니다.'));
  parser.on('opentag',node=>handlers.open?.(node.name.split(':').at(-1),node.attributes));
  parser.on('closetag',node=>handlers.close?.(node.name.split(':').at(-1)));
  parser.on('text',t=>handlers.text?.(t));parser.on('cdata',t=>handlers.text?.(t));parser.write(source).close();
}
export function readTable(bytes,kind,options={}){
  let files;try{files=unzipSync(bytes);}catch{ensure(false,'엑셀 압축 데이터를 읽을 수 없습니다.');}
  const get=name=>{ensure(files[name],'엑셀 내부 파일이 누락되었습니다: '+name);return strFromU8(files[name]);};
  let date1904=false;const sheets=[];
  xml(get('xl/workbook.xml'),{open(name,a){if(name==='workbookPr')date1904=['1','true'].includes(a.date1904);if(name==='sheet'){ensure(sheets.length<10,'시트는 최대 10개까지 허용합니다.');sheets.push({name:a.name,id:a['r:id']});}}});
  const sheet=kind==='production'?sheets.find(s=>s.name==='Sheet1'):sheets[0];ensure(sheet,kind==='production'?'Sheet1 시트가 필요합니다.':'시트가 없습니다.');
  let target;
  xml(get('xl/_rels/workbook.xml.rels'),{open(name,a){if(name==='Relationship'){ensure(a.TargetMode!=='External','외부 연결 파일은 허용하지 않습니다.');if(a.Id===sheet.id)target=a.Target;}}});
  ensure(typeof target==='string','워크시트 경로가 없습니다.');
  target=target.startsWith('/')?target.slice(1):'xl/'+target;
  ensure(/^xl\/worksheets\/[A-Za-z0-9_-]+\.xml$/.test(target),'지원하지 않는 워크시트 경로입니다.');
  const shared=[];let current='',inText=false,inString=false,phonetic=0;
  if(files['xl/sharedStrings.xml'])xml(get('xl/sharedStrings.xml'),{
    open(name){if(name==='si'){inString=true;current='';}if(name==='rPh')phonetic++;if(name==='t')inText=true;},
    text(t){if(inString&&inText&&!phonetic){current+=t;ensure(current.length<=32767,'셀 문자열은 Excel의 32,767자 이내로 입력하세요.');}},
    close(name){if(name==='t')inText=false;if(name==='rPh')phonetic--;if(name==='si'){shared.push(current);ensure(shared.length<=250000,'공유 문자열 처리 예산을 초과했습니다. 파일을 나누어 주세요.');inString=false;}}
  });
  const rows=new Map(),formulas=new Map(),usedColumns=new Set();let rowNumber=0,columnNumber=0,cell=null,capture=null,phoneticDepth=0,maxColumn=0,maxRow=0,lastRow=0,cellCount=0,textSize=0;const seenColumns=new Set();
  xml(get(target),{
    open(name,a){
      if(name==='row'){rowNumber=a.r?Number(a.r):rowNumber+1;ensure(Number.isInteger(rowNumber)&&rowNumber>lastRow&&rowNumber<=1048576,'행 위치 또는 중복 행 번호를 확인하세요.');lastRow=rowNumber;columnNumber=0;seenColumns.clear();}
      if(name==='c'){
        ensure(rowNumber,'셀에 행 정보가 없습니다.');
        let col=columnNumber+1;
        if(a.r){const m=/^([A-Z]+)(\d+)$/.exec(a.r);ensure(m&&Number(m[2])===rowNumber,'셀 위치를 확인하세요.');col=[...m[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);}
        ensure(col>0&&col<=16384&&!seenColumns.has(col),'Excel 열 위치 또는 중복 셀을 확인하세요.');seenColumns.add(col);columnNumber=col;cell={type:a.t||'n',value:'',inline:'',formula:''};
      }
      if(name==='f'){ensure(options.cachedFormulas,`${rowNumber}행: 수식은 값으로 붙여넣은 뒤 업로드하세요.`);capture='f';}
      if(name==='hyperlink'&&!options.cachedFormulas)ensure(false,'하이퍼링크는 일반 텍스트로 바꾼 뒤 업로드하세요.');
      if(name==='rPh')phoneticDepth++;
      if(cell&&(name==='v'||name==='t'))capture=name;
    },
    text(t){if(cell&&capture&&!phoneticDepth){const key=capture==='v'?'value':capture==='f'?'formula':'inline';cell[key]+=t;ensure(cell[key].length<=32767,`${rowNumber}행: 셀은 32,767자 이내로 입력하세요.`);}},
    close(name){
      if(name==='rPh')phoneticDepth--;
      if(name==='v'||name==='t'||name==='f')capture=null;
      if(name==='c'){
        let value='';ensure(cell,'셀 구조를 확인하세요.');
        if(cell.type==='s'){const i=Number(cell.value);ensure(cell.value!==''&&Number.isInteger(i)&&i>=0&&i<shared.length,'공유 문자열 참조를 확인하세요.');value=shared[i];}
        else if(cell.type==='inlineStr')value=cell.inline;
        else if(['str','d'].includes(cell.type))value=cell.value;
        else if(cell.type==='n'){value=cell.value===''?'':Number(cell.value);ensure(value===''||Number.isFinite(value),'숫자 셀 형식을 확인하세요.');}
        else if(options.cachedFormulas&&cell.type==='b')value=cell.value==='1'?'TRUE':'FALSE';
        else if(options.cachedFormulas&&cell.type==='e')value=cell.value;
        else ensure(false,`${rowNumber}행: 오류·참/거짓·지원하지 않는 셀 형식입니다.`);
        if(cell.type==='d'){ensure(/^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.0+)?Z?)?$/.test(value),'날짜 셀은 날짜만 입력하세요.');value=value.slice(0,10);}
        if(value!==''||cell.formula){cellCount++;textSize+=typeof value==='string'?value.length*2:8;ensure(cellCount<=250000&&textSize<=16*1024*1024,'유효 셀 250,000개 또는 텍스트 처리 예산 16MiB를 초과했습니다. 파일을 나누어 주세요.',413);if(!rows.has(rowNumber))rows.set(rowNumber,new Map());rows.get(rowNumber).set(columnNumber,typeof value==='string'&&!options.preserveText?value.trim():value);if(cell.formula){if(!formulas.has(rowNumber))formulas.set(rowNumber,new Map());formulas.get(rowNumber).set(columnNumber,cell.formula);}usedColumns.add(columnNumber);maxColumn=Math.max(maxColumn,columnNumber);maxRow=Math.max(maxRow,rowNumber);}cell=null;
      }
    }
  });
  return {date1904,maxColumn,maxRow,cellCount,usedColumns:[...usedColumns].sort((a,b)=>a-b),rowNumbers:[...rows.keys()].sort((a,b)=>a-b),formula:(r,c)=>formulas.get(r)?.get(c)||'',get:(r,c)=>rows.get(r)?.get(c)??'',row:r=>Array.from({length:maxColumn},(_,c)=>rows.get(r)?.get(c+1)??'')};
}
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
const column=n=>{let s='';for(;n>0;n=Math.floor((n-1)/26))s=String.fromCharCode((n-1)%26+65)+s;return s;};
export function writeTable(columns,rows,sheetName='Sheet1'){
  const titles=columns.map(c=>typeof c==='string'?c:c.title),values=[titles,...rows.map(r=>Array.isArray(r)?r:columns.map(k=>r[typeof k==='string'?k:k.id]??''))];
  const data=values.map((row,i)=>`<row r="${i+1}">${row.map((value,c)=>{const ref=column(columns[c]?.position||c+1)+(i+1);if(value?.type==='date'&&Number.isFinite(value.serial))return `<c r="${ref}" s="1"><v>${value.serial}</v></c>`;return typeof value==='number'&&Number.isFinite(value)?`<c r="${ref}"><v>${value}</v></c>`:`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`;}).join('')}</row>`).join('');
  const header='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const files={
    '[Content_Types].xml':`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    '_rels/.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml':`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml':`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${titles.map((k,i)=>`<col min="${columns[i]?.position||i+1}" max="${columns[i]?.position||i+1}" width="${Math.min(36,Math.max(15,k.length*2+2))}" customWidth="1"/>`).join('')}</cols><sheetData>${data}</sheetData></worksheet>`
  };
  files['[Content_Types].xml']=files['[Content_Types].xml'].replace('</Types>','<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
  files['xl/_rels/workbook.xml.rels']=files['xl/_rels/workbook.xml.rels'].replace('</Relationships>','<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  files['xl/styles.xml']='<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>';
  return zipSync(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,strToU8(header+v)])),{level:6});
}
