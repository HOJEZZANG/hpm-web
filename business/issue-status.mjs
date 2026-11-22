// Exact legacy aliases only. No dates, history or other record values are inferred.
export const issueStatuses=Object.freeze(['접수','원인검토중','조치중','조치완료']);
export const normalizeIssueStatus=value=>value==='종결'||value==='조치 완료'?'조치완료':value;
export const isCompletedIssueStatus=value=>normalizeIssueStatus(value)==='조치완료';
