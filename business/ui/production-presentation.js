import {esc} from './common.js';
import {productionProcessState,ahuProcessState} from './production-view.js?v=20261124-requests';
export const preferredProductionBucket=model=>['overdue','upcoming','unknown'].find(key=>model[key].length)||'all';
export function productionKpi({label,value,unit='건',foot='',tone='all',attrs='',valueAttrs='',className=''}){
 return `<button type="button" class="hpm-kpi production-tone-${tone} ${className}" ${attrs}><span class="kpi-label">${esc(label)}</span><strong class="kpi-value" ${valueAttrs}>${value}<small>${esc(unit)}</small></strong><span class="kpi-foot">${esc(foot)||'&nbsp;'}</span></button>`;
}
export function productionProcess(value,part){
 const state=(part==='part2'?ahuProcessState:productionProcessState)(value),label={active:'진행',ready:'완료',unknown:'확인 필요'}[state];
 return `<span class="production-process-cell"><span class="process-badge state-${state}">${label}</span><span>${esc(value||'공정 미기재')}</span></span>`;
}
// Production-only table: selection is an independent narrow column; no global table contracts change.
export function productionTable(columns,records,{select,selectAll='',actions,empty='조건에 해당하는 대상이 없습니다'}={}){
 return `<div class="business-table-wrap production-table-scroll"><table class="business-table production-data-table"><thead><tr>${select?`<th class="production-select-col" scope="col">${selectAll}</th>`:''}${columns.map(c=>`<th scope="col" class="${esc(c.className||'')}">${esc(c.label||c.key)}</th>`).join('')}${actions?'<th class="production-action-col" scope="col">관리</th>':''}</tr></thead><tbody>${records.length?records.map((r,i)=>`<tr>${select?`<td class="production-select-col">${select(r)}</td>`:''}${columns.map(c=>`<td class="${esc(c.className||'')}">${c.render?c.render(r):esc(c.value?c.value(r):r[c.key])}</td>`).join('')}${actions?`<td class="production-action-col">${actions(r,i)}</td>`:''}</tr>`).join(''):`<tr><td class="production-empty" colspan="${columns.length+Boolean(select)+Boolean(actions)}">${esc(empty)}</td></tr>`}</tbody></table></div>`;
}
