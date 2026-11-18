// Current input choices; stored historical labels are never rewritten.
export const issueDepartments=Object.freeze(['A/C생산팀','생산계획팀','구조설계팀','기술팀','구매/자재팀','QM팀','외주업체','공통/협의필요']);
export const validIssueDepartment=(value,previous)=>typeof value==='string'&&(value===''||issueDepartments.includes(value)||previous!==undefined&&value===previous);
