import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {preferredProductionBucket} from '../business/ui/production-presentation.js';
import {createProductionPriority} from '../business/ui/production-priority.js';
import {noticePreview} from '../business/ui/home.js';
test('automatic first inspection chooses the first real bucket and explicit card choices survive filtered empty results',()=>{
 const {document}=parseHTML('<main><section data-production-priority></section></main>'),root=document.querySelector('main'),panel=createProductionPriority(root,'part1'),today='2026-11-24',row=(id,pnd,process='조립')=>({id,PND:pnd,현공정:process,Yard:'SHI',HullNo:'2659'});
 const ready=row('ready',today,'완료'),upcoming=row('soon','2026-12-07'),unknown=row('unknown',today,'');
 for(const [rows,expected]of [[[ready],'all'],[[ready,unknown],'unknown'],[[unknown,upcoming],'upcoming'],[[upcoming,row('late','2026-11-23')],'overdue']]){panel.update(rows,{today});assert.equal(panel.getState().selected,expected);assert.equal(panel.getState().manual,false);}
 const button=root.querySelector('[data-priority="upcoming"]');root.addEventListener('focusin',()=>{});document.defaultView.HTMLElement.prototype.focus=()=>{};document.defaultView.HTMLElement.prototype.scrollIntoView=()=>{};button.dispatchEvent(new document.defaultView.Event('click',{bubbles:true}));panel.update([ready],{today});assert.equal(panel.getState().selected,'upcoming');assert.equal(panel.getState().manual,true);assert(root.textContent.includes('조건에 해당하는 대상이 없습니다'));assert.equal(preferredProductionBucket({overdue:[],upcoming:[],unknown:[]}), 'all');
});
test('compact home notices retain title/date/author and link to full content without displaying a long body',()=>{
 const html=noticePreview({id:'notice-id',title:'<합성 공지>',content:'긴 본문'.repeat(300),authorName:'기록자',noticeDate:'2026-11-24'},{compact:true});assert(html.includes('data-home-notice="notice-id"'));assert(html.includes('&lt;합성 공지&gt;'));assert(html.includes('기록자'));assert(html.includes('2026. 11. 24.'));assert(!html.includes('긴 본문'));
});
