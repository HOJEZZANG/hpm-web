import {BusinessError} from './domain.mjs';
export const LOGIN_WINDOW_MS=15*60*1000;
export const LOGIN_ACCOUNT_FAILURES=5;
export const LOGIN_IP_FAILURES=30;
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
function blocked(until){
  const seconds=Math.max(1,Math.ceil((until-Date.now())/1000));
  const error=new BusinessError(429,`로그인 시도가 제한되었습니다. ${seconds}초 후 다시 시도하세요.`);
  error.code='LOGIN_RETRY';error.retryAfterSeconds=seconds;throw error;
}
export async function reserveCredentialCheck(req,env,accountId){
  const stamp=Date.now(),cutoff=stamp-LOGIN_WINDOW_MS,
    key=await digest('account:'+accountId.toLowerCase()),ipKey=await digest('ip:'+ (req.headers.get('CF-Connecting-IP')||'local'));
  const ip=await env.DB.prepare('SELECT retry_at FROM portal_login_limits WHERE key=?').bind(ipKey).first();
  if(ip?.retry_at>stamp)blocked(ip.retry_at);
  const nonce=crypto.randomUUID();
  // Reserve the guess atomically before hashing: parallel requests cannot exceed the budget.
  // A verified success clears only its own reservation, never a newer concurrent attempt.
  const ticket=await env.DB.prepare(`INSERT INTO portal_login_limits(key,attempts,window_start,retry_at,nonce) VALUES(?,1,?,0,?)
    ON CONFLICT(key) DO UPDATE SET
      attempts=CASE WHEN window_start<=? THEN 1 ELSE attempts+1 END,
      window_start=CASE WHEN window_start<=? THEN excluded.window_start ELSE window_start END,
      retry_at=CASE WHEN window_start<=? THEN 0 WHEN attempts+1>=? THEN ? ELSE 0 END,
      nonce=excluded.nonce
    WHERE retry_at<=? RETURNING attempts,retry_at`)
    .bind(key,stamp,nonce,cutoff,cutoff,cutoff,LOGIN_ACCOUNT_FAILURES,stamp+LOGIN_WINDOW_MS,stamp).first();
  if(!ticket){const row=await env.DB.prepare('SELECT retry_at FROM portal_login_limits WHERE key=?').bind(key).first();blocked(row?.retry_at||stamp+LOGIN_WINDOW_MS);}
  return {key,ipKey,nonce,retryAt:ticket.retry_at};
}
export async function finishCredentialCheck(env,ticket,correct){
  if(correct){await env.DB.prepare('DELETE FROM portal_login_limits WHERE key=? AND nonce=?').bind(ticket.key,ticket.nonce).run();return 0;}
  const stamp=Date.now(),cutoff=stamp-LOGIN_WINDOW_MS;
  const ip=await env.DB.prepare(`INSERT INTO portal_login_limits(key,attempts,window_start,retry_at,nonce) VALUES(?,1,?,0,?)
    ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window_start<=? THEN 1 ELSE attempts+1 END,
      window_start=CASE WHEN window_start<=? THEN excluded.window_start ELSE window_start END,
      retry_at=CASE WHEN window_start<=? THEN 0 WHEN attempts+1>=? THEN ? ELSE 0 END,
      nonce=excluded.nonce RETURNING retry_at`)
    .bind(ticket.ipKey,stamp,ticket.nonce,cutoff,cutoff,cutoff,LOGIN_IP_FAILURES,stamp+LOGIN_WINDOW_MS).first();
  return Math.max(0,Math.ceil((Math.max(ticket.retryAt,ip.retry_at)-stamp)/1000));
}
