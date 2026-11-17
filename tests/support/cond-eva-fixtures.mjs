import {DatabaseSync} from 'node:sqlite';
export const READ_TOKEN='b'.repeat(64),ADMIN_TOKEN='synthetic-original-admin';
export function sourceEnv({count=3,steps=true}={}){
  const sqlite=new DatabaseSync(':memory:'),sql=[];
  sqlite.exec(`CREATE TABLE production_orders(work_order TEXT PRIMARY KEY,hull TEXT,project TEXT,equipment TEXT,shell_request_date TEXT,cond_completion_date TEXT,eva_completion_date TEXT,updated_at TEXT);
    ${steps?'CREATE TABLE production_steps(work_order TEXT NOT NULL,step_code TEXT NOT NULL,completion_date TEXT NOT NULL,worker_name TEXT,updated_at TEXT,PRIMARY KEY(work_order,step_code));':''}`);
  const insert=sqlite.prepare('INSERT INTO production_orders VALUES(?,?,?,?,?,?,?,?)');
  for(let i=0;i<count;i++)insert.run(String(i).padStart(6,'0'),'호선 '+i,'프로젝트 '+(i%2),'장비 '+(i%3),i%2?'':'2026-11-11',i%3?'':'2026-11-12',null,'2026-11-17 01:00:00');
  if(steps&&count)for(const [i,code]of ['FU','WD','TP','EXP','MT','HYDRO'].entries())sqlite.prepare('INSERT INTO production_steps VALUES(?,?,?,?,?)').run('000000',code,`2026-11-${String(11+i).padStart(2,'0')}`,'노출 금지 작업자','2026-11-17 04:00:00');
  const env={sqlite,sql,ADMIN_TOKEN,HPM_READ_TOKEN:READ_TOKEN,DB:{prepare(query){sql.push(query);const args=[];const statement={query,args,bind(...values){return {...statement,args:values};},async all(){return {success:true,results:sqlite.prepare(query).all(...this.args)};},async first(){return sqlite.prepare(query).get(...this.args)||null;},async run(){const r=sqlite.prepare(query).run(...this.args);return {success:true,meta:{changes:Number(r.changes)}};}};return statement;},async batch(statements){sqlite.exec('BEGIN');try{const values=[];for(const s of statements)values.push(await s.all());sqlite.exec('COMMIT');return values;}catch(e){sqlite.exec('ROLLBACK');throw e;}}}};
  return env;
}
