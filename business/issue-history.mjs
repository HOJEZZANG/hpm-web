// Only the Worker chooses the actor and timestamp of automatic entries.
export function issueChanges(previous,next){
  if(!previous)return ['문제점 신규 등록'];
  const labels={occurDate:'발생일자',product:'제품명',title:'문제 제목',description:'문제점 상세내용',responsibleDept:'귀책부서',status:'처리 상태',processPnd:'공정 PND',actionDetail:'조치내용',yard:'Yard',hullNo:'Hull No.',productNo:'제품 규격',remark:'비고',process:'공정',issueType:'문제 유형',projectNo:'기존 Yard/Hull 정보',priority:'우선순위',dueDate:'조치 예정일',deliveryDate:'납품일',completedDate:'실제 완료일',finder:'발견자',feedbackOwner:'담당자',causeFeedback:'원인 분석',verifier:'효과 확인자',prevention:'재발방지',followupFlag:'후속 반영',part:'파트',factory:'공장',sample:'자료 구분',images:'현장 사진(조치 전)',afterImages:'조치 후 사진'};
  return Object.entries(labels).filter(([key])=>JSON.stringify(previous[key]??'')!==JSON.stringify(next[key]??'')).map(([key,label])=>key==='status'||key==='processPnd'?`${label}: ${previous[key]||'미입력'} → ${next[key]||'미입력'}`:`${label} 변경`);
}
