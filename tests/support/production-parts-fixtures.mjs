import {writeTable} from '../../business/ooxml.mjs';
import {ahuFields} from '../../business/production-ahu-sheet.mjs';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
export function ahuBytes(count=3,{shift=true,rows}={}){
 const values=rows||Array.from({length:count},(_,i)=>['합성 야드',i===0?'00001':'00002',i%3===0?'완료':i%3===1?'조립2[HA2]':'','2026-10-31',i%2+1,'0008-'+i,'00000'+i,'AHU','HKA-08SN','','2026-09-01']);
 let bytes=writeTable(ahuFields,values);if(!shift)return bytes;
 const z=unzipSync(bytes),s=strFromU8(z['xl/worksheets/sheet1.xml']).replace(/r="([A-Z]+)(\d+)"/g,(_,c,n)=>'r="'+c+(+n+1)+'"').replace(/<row r="(\d+)"/g,(_,n)=>'<row r="'+(+n+1)+'"').replace('<sheetData>','<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>프로젝트 생산 진행조회_hiair</t></is></c></row>').replace('</sheetData>','</sheetData><mergeCells count="1"><mergeCell ref="A1:K1"/></mergeCells>');z['xl/worksheets/sheet1.xml']=strToU8(s);return zipSync(z);
}
