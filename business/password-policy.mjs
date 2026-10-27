// Shared by the browser and Worker. The account's policy is assigned by the server.
export const NUMERIC_PASSWORD='numeric';
export const LEGACY_PASSWORD='legacy';
export const PASSWORD_MAX=128;
export function passwordRule(policy){
  return policy===NUMERIC_PASSWORD
    ?{min:4,max:PASSWORD_MAX,pattern:'[0-9]{4,128}',inputMode:'numeric',description:'숫자만 4자리 이상 (최대 128자리, 앞자리 0 유지)'}
    :{min:12,max:PASSWORD_MAX,pattern:null,inputMode:'text',description:'12~128자 · 문자·숫자·특수문자 사용 가능'};
}
export function newPasswordError(value,policy){
  if(typeof value!=='string')return '비밀번호는 문자열로 입력하세요. 앞자리 0도 그대로 입력하세요.';
  if(policy===NUMERIC_PASSWORD)return value.length>=4&&value.length<=PASSWORD_MAX&&!/[^0-9]/.test(value)?'':'새 비밀번호는 숫자만 4자리 이상, 최대 128자리로 입력하세요.';
  return value.length>=12&&value.length<=PASSWORD_MAX?'':'기존 계정의 새 비밀번호는 12~128자로 입력하세요. 문자·숫자·특수문자를 사용할 수 있습니다.';
}
