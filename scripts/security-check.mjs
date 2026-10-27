import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
const tracked=spawnSync('git',['ls-files','-co','--exclude-standard','-z'],{encoding:'utf8'});assert.equal(tracked.status,0);
const files=[...new Set(tracked.stdout.split('\0').filter(Boolean))];
const forbidden=['.dev.vars','.env','credentials.json'];
assert.ok(!files.some(f=>forbidden.includes(f)||f.startsWith('backups/')||(/\.(?:db|sqlite|py|xlsx|xls|xlsm|xlsb|jpg|png)$/i.test(f)&&f!=='assets/hi-air-korea-logo.png')),'Source must exclude credentials, source Python, operational files and local backups.');
const html=readFileSync('index.html','utf8'),{document}=parseHTML(html);
assert.equal(document.querySelector('#hpmEmbeddedSnapshot'),null,'Remove public embedded data/account snapshot.');
assert.equal(document.querySelectorAll('#issueList .issue-item').length,0,'Public HTML must not contain rendered historical issues.');
assert.ok(!/localStorage\.(?:setItem|getItem)/.test(html),'Operational HTML must use server data and identities.');
for(const file of files){
  const content=readFileSync(file,'utf8');
  assert.ok(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9_]{25,}|sb_publishable_[A-Za-z0-9_-]{20,}/.test(content),'Possible secret in '+file);
}
let sourceLiteralsChecked=0;
if(process.argv[2]){
  const raw=readFileSync(join(process.argv[2],'07_식수인원_관리.py'),'utf8'),sensitive=new Set();
  for(const line of raw.split(/\r?\n/)){
    for(const m of line.matchAll(/\.fill\(\s*(['"])([^'"\r\n]{6,})\1\s*\)/g))sensitive.add(m[2]);
    const assignment=line.match(/^\s*(?:LOGIN_ID|LOGIN_PW|USER_ID|USERNAME|USER_NAME|PASSWORD|PASSWD|PW|ID)\s*=\s*(['"])([^'"\r\n]{6,})\1/i);if(assignment)sensitive.add(assignment[2]);
  }
  const members=raw.match(/MEMBERS\s*=\s*\[([\s\S]*?)\]/)?.[1]||'';for(const m of members.matchAll(/(['"])([^'"]+)\1/g))sensitive.add(m[2]);
  // Never print compared literals, even on failure.
  for(const file of files){const content=readFileSync(file,'utf8');for(const literal of sensitive)assert.ok(!content.includes(literal),'Provided internal account/staff literal found in '+file);}
  sourceLiteralsChecked=sensitive.size;
}
console.log(`PASS public source/secret checks across ${files.length} files; ${sourceLiteralsChecked} internal account/staff literals compared without printing values.`);
