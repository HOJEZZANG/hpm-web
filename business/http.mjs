import {BusinessError,ensure} from './domain.mjs';
import {MIME,MAX_FILE} from './excel.mjs';
export async function limitedBytes(request,max){
  ensure(Number(request.headers.get('content-length')||0)<=max,'파일/요청 크기 제한을 초과했습니다.',413);
  const reader=request.body?.getReader();ensure(reader,'요청 본문이 필요합니다.');const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new BusinessError(413,'파일/요청 크기 제한을 초과했습니다.');}chunks.push(value);}
  const bytes=new Uint8Array(size);let p=0;for(const chunk of chunks){bytes.set(chunk,p);p+=chunk.length;}return bytes;
}
export async function bodyJson(request){
  ensure(request.headers.get('content-type')?.includes('application/json'),'JSON 요청이 필요합니다.');
  try{const b=JSON.parse(new TextDecoder().decode(await limitedBytes(request,128*1024)));ensure(b&&typeof b==='object'&&!Array.isArray(b),'JSON 객체를 입력하세요.');return b;}catch(e){if(e instanceof BusinessError)throw e;throw new BusinessError(400,'JSON 형식을 확인하세요.');}
}
export async function multipart(request,max=MAX_FILE){
  const type=request.headers.get('content-type')||'';ensure(type.startsWith('multipart/form-data'),'파일 업로드 형식이 필요합니다.');
  let form;try{form=await new Response(await limitedBytes(request,max+65536),{headers:{'Content-Type':type}}).formData();}catch(e){if(e instanceof BusinessError)throw e;throw new BusinessError(400,'파일 요청을 읽지 못했습니다.');}
  const file=form.get('file');ensure(file instanceof File&&file.size>0&&file.size<=max,'파일 크기를 확인하세요.',413);return {form,file};
}
export function binary(bytes,name,contentType=MIME){
  return new Response(bytes,{headers:{'Content-Type':contentType,'Content-Disposition':`attachment; filename="download.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
