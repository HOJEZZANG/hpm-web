// Official Wrangler OAuth; filter console output so authorization material stays off chat.
import {spawn} from 'node:child_process';
const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','login'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
console.log('Cloudflare 공식 로그인 브라우저를 여는 중입니다. 브라우저에서 로그인 후 권한을 허용하세요.');
let output='';child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{output+=b;});
child.on('error',()=>{console.error('Wrangler 로그인 실행에 실패했습니다.');process.exitCode=1;});
child.on('exit',code=>{if(code===0&&/successfully|logged in/i.test(output))console.log('Cloudflare 정상 로그인 완료. 인증정보는 출력하지 않았습니다.');else{console.log('Cloudflare 로그인이 완료되지 않았습니다. 브라우저 상태를 확인하세요.');process.exitCode=code||1;}});
