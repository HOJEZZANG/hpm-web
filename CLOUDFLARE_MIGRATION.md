# HPM Cloudflare 전환 및 배포 안내

## 현재 작업 상태

2026-09-17 AS 출장·팀 일정 작업을 재개했습니다. 시작 시 HEAD와 origin/main은
84c38fe로 같았고, 일정 구현은 미커밋 상태였습니다. 원격 D1의 0001/0002/0003 적용 기록,
일정 테이블 각 14개 컬럼, 기존 Worker d287879c-bc22-4e74-aa9e-9c0acbbb5d0a를 확인했습니다.
0003_shared_calendars.sql은 2026-09-16 13:28:24 UTC에 이미 적용되어 재적용하지 않았습니다.
재개 시 원격 문제점은 3건, AS·팀 일정은 각각 0건이며 조회 API와 CORS는 정상이었습니다.

AS·팀 일정은 이제 D1에 단건 저장·수정·삭제합니다. 초기 조회나 이전 실패 시 쓰기를 차단하고
재시도 버튼을 표시합니다. 일정 메뉴를 다시 열면 다른 PC의 변경 사항을 불러옵니다.
localStorage의 asEvents/teamEvents는 첫 접속 시 한 번 이전하고 원본을 보존합니다.
완료 표시는 두 목록의 저장 및 재조회가 모두 성공한 뒤 hpmCalendarsCloudMigrationV1에 기록합니다.
ID 없는 구형 일정에는 내용 기반의 고정 ID를 부여하며 date/workDetail도 변환합니다.
이전 요청의 ?migration=1은 INSERT ON CONFLICT DO NOTHING을 사용하므로 재시도나
다른 PC의 오래된 백업이 같은 ID의 최신 D1 일정을 덮어쓰지 않습니다.
발표용 HTML은 내장 일정만 조회하며 원격 이전·수정을 실행하지 않습니다.

기존 일정이 들어 있는 각 브라우저에서 새 웹페이지를 열어야 그 브라우저의 실제 이전이 실행됩니다.
배포 도구는 사용자 브라우저의 localStorage에 직접 접근할 수 없습니다.

최종 Worker 배포 버전: 17adadb2-ba1c-4787-be43-51834242972e.
검증 결과: 로컬 SQLite API 테스트 16개, 문법·설정 검사, Chromium 실제 DOM 검사,
84c38fe 대비 CSS/HTML·계정·필터·일정 표시 보존 비교 모두 통과했습니다.
원격에서는 health/문제점/AS/팀 조회 HTTP 200 및 CORS preflight를 확인하고,
각 일정의 임시 UUID로 등록·수정·이전 재시도·조회·삭제를 검증했습니다.
검증용 일정만 삭제했으며, 전후 문제점 3건의 전체 API 응답 SHA256은
91bf5851240865f67ab6c131167818a3e9c399992d7fb9541ec0740339d43dbf로 일치합니다.
원격 일정은 검증 전후 각각 0건입니다. 실제 브라우저 일정의 이전 완료를 뜻하지는 않습니다.

일정 검증 재실행:

~~~powershell
npm.cmd test
npm.cmd run check
node scripts/browser-check.mjs 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node scripts/check-remote-calendars.mjs
# 임시 UUID 일정만 생성·수정한 뒤 정리하는 원격 쓰기 검증:
node scripts/check-remote-calendars.mjs --write
~~~

아래는 문제점·사진 이전 당시의 기록입니다.

로컬 프로젝트의 실제 파일을 수정했습니다. GitHub Pages는 단일 index.html,
문제점은 D1, 사진은 비공개 R2, 통신은 Worker API를 사용합니다.
기존 데이터 서비스의 SDK/클라이언트/조회/전체 저장/삭제 호출과 관련 메시지를 제거했습니다.
문제점의 localStorage 저장 및 장애 fallback은 없습니다.

원본 작업 폴더에는 .git 디렉터리가 없어 로컬 원본을 기준으로 분석·수정했습니다.
2026-09-15 원격 D1에 0001/0002 migration을 적용했으며,
2026-09-16 적용 기록과 필수 32개 컬럼 + 기존 payload 컬럼을 확인했습니다.
원격 테이블에는 데이터가 0건이었으며 적용 후에도 0건입니다.
기존 payload TEXT NOT NULL 제약은 유지하고 Worker가 호환 JSON 값을 함께 저장합니다.
Worker 배포 버전은 777361ad-4ab5-46f8-a55b-dfcf29b975df입니다.
/api/health와 /api/issues의 HTTP 200 및 GitHub Pages Origin CORS를 확인했습니다.
실제 원격 사진 업로드·문제점 등록/수정/삭제 테스트는 아직 수행하지 않았습니다.

## 파일

- index.html: API 연결, 단건 저장, 삭제, 사진 업로드·정리, JSON 병합, 샘플 저장, 발표용 사진 내장.
- worker.js: D1/R2 API, 검증, 고정 Origin CORS, 공통 JSON 응답.
- wrangler.jsonc: 실제 DB/PHOTOS 바인딩 설정.
- migrations/0001_cloudflare_schema.sql: 32개 필드의 신규 테이블 정의. 기존 테이블/데이터 유지.
- migrations/0002_missing_issue_columns.sql: 원격 스키마 검사로 생성·적용한 누락 컬럼 21개 보완 migration.
- scripts/prepare-migration.mjs: 원격/로컬 PRAGMA 결과를 보고 누락된 컬럼만 추가하는 SQL 생성.
- scripts/check.mjs: 문법·설정·제거 대상 문자열·API 연결 검사.
- scripts/compare-baseline.mjs: 원본 대비 CSS/HTML 및 보존 대상 코드 비교.
- scripts/browser-check.mjs: 숨김 Chromium과 모의 API를 사용하는 실제 DOM 검사.
- tests/worker.test.mjs: 실제 메모리 SQLite + 모의 R2를 사용하는 API 테스트.
- package.json: Node 검사 명령. 프레임워크나 프론트엔드 빌드 의존성 없음.

## 원본 분석과 데이터 모델

원본 loadIssues는 클라우드 목록을 읽어 camelCase로 변환했고, saveIssues는
전체 issues 배열을 매번 저장했습니다. reporterId/sample 일부가 저장·읽기 매핑에서
누락돼 있었습니다. 폼 저장은 서버 완료 전 메모리 목록을 변경했습니다.
단건 삭제와 선택 삭제도 이전 데이터 서비스 호출을 사용했습니다.
선택 삭제는 권한 확인을 거친 targets 대신 전체 선택 ID를 전송하던 문제를 수정했습니다.

전체 D1 필드(32개):

| 프론트엔드 | D1 |
|---|---|
| id | id |
| issueNo | issue_no |
| occurDate | occur_date |
| registerDate | register_date |
| product | product |
| projectNo | project_no |
| processPnd | process_pnd |
| deliveryDate | delivery_date |
| process | process |
| issueType | issue_type |
| title | title |
| description | description |
| finder | finder |
| reporter | reporter |
| reporterId | reporter_id |
| responsibleDept | responsible_dept |
| status | status |
| priority | priority |
| dueDate | due_date |
| feedbackOwner | feedback_owner |
| causeFeedback | cause_feedback |
| actionDetail | action_detail |
| completedDate | completed_date |
| verifier | verifier |
| prevention | prevention |
| followupFlag | followup_flag |
| images | images |
| afterImages | after_images |
| createdAt | created_at |
| updatedAt | updated_at |
| history | history |
| sample | sample |

images/after_images/history는 JSON 문자열, followup_flag/sample은 0/1입니다.
사진 배열은 D1에 R2 key로 저장하며 조회 API는 Worker URL로 반환합니다.
created_at은 수정 시 보존하고 updated_at은 서버가 갱신합니다.
구형 배열 JSON, null, 잘못된 JSON은 안전하게 정규화합니다.
구형 조립1/2/3 → 조립 변환도 유지합니다.

로그인·회원가입·마이페이지는 기존 localStorage/sessionStorage 방식입니다.
AS 출장 및 팀 일정은 D1을 사용하며, 기존 브라우저 저장 데이터는 1회 이전 후 백업으로 보존합니다.
기존 CSS, 반응형 구조, 메뉴, 필터, PND 경고, 이력, 통계, 사진 확대를 보존했습니다.
원본에는 CSV 내보내기와 JSON 가져오기/내보내기가 있었으며 이 기능들을 유지했습니다.
원본에 CSV 가져오기 파서는 없었습니다.

## API

기본 주소: https://hpmanagement-web.lotusland1995.workers.dev

| 요청 | 응답/동작 |
|---|---|
| GET /api/health | SELECT 1 AS ok 실행; DB/R2 binding 상태. 정상 200, 연결 불가 503 |
| GET /api/issues | {ok:true, issues:[...]} / updated_at·created_at 최신순 |
| GET /api/as-events, /api/team-events | {ok:true, events:[...]} / 날짜순 공유 일정 |
| PUT /api/as-events/:id, /api/team-events/:id | 단건 검증·UPSERT, 등록자·등록 시각 보존; ?migration=1이면 기존 행 보존 |
| DELETE /api/as-events/:id, /api/team-events/:id | 지정한 일정 1건만 삭제; 없는 ID도 성공 |
| PUT /api/issues/:id | 한 건 검증·UPSERT; {ok:true, issue, photosCleaned} |
| DELETE /api/issues/:id | 단건 삭제 + 미참조 사진 정리 |
| POST /api/issues/bulk-delete | {ids:[...]} / 1~100개; D1 batch로 삭제 |
| POST /api/photos | multipart file, issueId, category(before/after); {ok:true,key,url,contentType} |
| GET /api/photos/* | R2 객체 스트림, Content-Type, ETag, private 캐시(300초), 조건부 304 |
| DELETE /api/photos/* | 미참조 사진 삭제; 없어도 성공. 사용 중이면 deleted:false |
| OPTIONS /* | 204 preflight |

모든 API 응답에 https://hojezzang.github.io Origin의 CORS를 포함합니다.
GET/POST/PUT/DELETE/OPTIONS와 Content-Type을 허용합니다.
외부 Origin의 브라우저 변경 요청은 403이며 SQL 내부 오류는 응답에 노출하지 않습니다.
JPEG/PNG/WebP의 MIME과 파일 헤더를 확인합니다. 파일당 5MB 제한,
클라이언트는 기존 1280px/품질 0.76 압축과 조치 전·후 각 3장 제한을 유지합니다.
키는 서버에서 UUID로 생성하며 경로 검증으로 임의 경로를 차단합니다.
R2 버킷을 공개로 전환하는 설정은 없습니다.

데이터 손상 방지를 위해 단건/일괄 삭제 모두 D1 성공 후 R2를 정리합니다.
사진부터 지우면 D1 실패 시 기존 행의 사진이 손실될 수 있기 때문입니다.
D1 트랜잭션과 R2 삭제는 하나의 트랜잭션이 될 수 없습니다.
정리 실패는 photosCleaned:false로 알리며 이미 완료된 D1 변경을 실패로 표시하지 않습니다.

## 프론트엔드 동작

- 초기 API 응답을 기다린 뒤 문제점 화면을 갱신합니다.
- 조회 실패 시 한국어 안내와 변경 차단을 적용합니다. 빈 목록을 D1에 저장하지 않습니다.
- 등록·수정·가져오기는 한 건씩 PUT하고, 성공한 건만 메모리에 반영합니다.
- 단건/선택 삭제도 API 성공 후에만 목록에서 제거합니다.
- 등록자 ID(구형 데이터는 이름) 기반 삭제 판단을 그대로 유지합니다.
- 사진 선택 → 압축 → Blob → R2 업로드 → Worker URL만 편집 배열에 보관합니다.
- 업로드·저장 중 상태를 표시하고 중복 요청과 편집 대상 변경을 막습니다.
- 저장 실패, 초기화, 다른 항목 편집 시 임시 업로드 사진을 가능한 범위에서 정리합니다.
- 기존 사진 제거는 저장 성공 후 Worker가 정리하며 공유 참조는 보존합니다.
- 기존 Base64 사진은 읽을 수 있습니다. 수정·JSON 가져오기 시 R2로 옮긴 후 저장합니다.
- JSON 가져오기는 ID 기준 병합입니다. 백업에 없는 항목을 삭제하지 않습니다.
  ID/제목/사진 형식을 먼저 확인하며 중간 실패 시 완료된 건수와 부분 저장 사실을 알립니다.
  실패 후 같은 ID의 백업으로 재시도할 수 있습니다.
- 샘플도 실제 D1에 개별 저장합니다. 부분 실패 후 재시도하면 누락된 샘플만 추가합니다.
- JSON 내보내기는 Worker 사진 URL을 포함합니다. 사진 원본을 별도 백업하는 기능은 아닙니다.
- 발표용 HTML은 문제점·사진·계정·일정을 파일에 내장합니다.
  file://에서는 내장 문제점을 조회하며 원격 API 호출/변경을 차단합니다.
  발표용 데이터는 D1 장애 fallback이 아니고 내보낸 시점의 조회 전용 복사본입니다.

## Cloudflare에서 실행할 정확한 순서

Node.js 24 이상과 npm/npx가 PATH에 있는 터미널을 사용하세요.
현재 Windows 환경에서는 Node가 C:\Users\lotus\AppData\Local\Programs\nodejs-v24에 있습니다.

프로젝트 폴더에서:

~~~powershell
cd C:\Users\lotus\hpm-web
$env:Path = 'C:\Users\lotus\AppData\Local\Programs\nodejs-v24;' + $env:Path
npx wrangler login
~~~

D1 원격 백업을 먼저 만듭니다. 백업에는 업무 데이터가 있으므로 GitHub에 올리지 마세요.

~~~powershell
npx wrangler d1 export hpmanagement-db --remote --output ../hpmanagement-db-before-migration.sql
~~~

현재 hpmanagement-db에는 아래 migration이 이미 적용됐습니다. 재배포 시 migration을 다시 만들 필요는 없습니다.
다른 DB에 처음 설치하거나 기존 테이블을 보완할 때는 아래 순서를 지키세요.
**그 DB의 컬럼을 검사하기 전에 migrations apply를 실행하지 마세요.**

~~~powershell
npx wrangler d1 execute hpmanagement-db --remote --file migrations/0001_cloudflare_schema.sql
node scripts/prepare-migration.mjs --remote
Get-Content migrations/0002_missing_issue_columns.sql
npx wrangler d1 migrations apply hpmanagement-db --remote
npx wrangler d1 execute hpmanagement-db --remote --command "PRAGMA table_info(issues)"
npx wrangler deploy
~~~

첫 명령은 CREATE TABLE IF NOT EXISTS만 실행하므로 기존 행을 건드리지 않습니다.
검사기는 실제 컬럼을 확인한 후 0002에 누락 컬럼의 ALTER TABLE ADD COLUMN만 기록합니다.
SQLite는 ADD COLUMN IF NOT EXISTS를 지원하지 않아 정적인 ADD COLUMN 목록을
무조건 실행하는 방식은 사용하지 않았습니다.
migrations apply에서 0001이 재실행돼도 기존 테이블/행은 유지됩니다.

검사기는 id가 없거나 중복/빈 ID가 있으면 자동 수정을 중단합니다.
0002가 이미 적용된 뒤 추가 누락이 발견되면 기존 이력을 덮어쓰지 않고 중단합니다.
수동 변경된 0002 파일도 덮어쓰지 않습니다.
그 경우 실제 스키마를 보고 새로운 번호의 migration으로 보완해야 합니다.
원격의 기존 컬럼 타입/제약은 자동으로 변경하지 않습니다.

Cloudflare Worker에 DB → hpmanagement-db, PHOTOS → hpm-photos가 연결됐는지 확인하세요.
R2 public access와 r2.dev 공개 접근은 비활성 상태를 유지하세요.
health의 photos:true는 binding 존재 검사이며 실제 R2 읽기/쓰기 성공은 사진 테스트로 확인합니다.

근거:
- [D1 PRAGMA 및 SQL](https://developers.cloudflare.com/d1/sql-api/sql-statements/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)

## 자동 검증과 결과

수행한 검사:

- Worker JavaScript 문법 및 index.html의 inline script 2개: 통과.
- wrangler.jsonc: 엄격 JSON 파싱까지 통과, 실제 값/DB/PHOTOS 일치 확인.
- 프로젝트 전체의 제거 대상 서비스 문자열(대소문자 무시): 0건.
- 메모리 SQLite와 모의 R2 API 테스트 9개: 통과. 기존 필수 payload 컬럼 저장 호환성 포함.
- 실제 Chromium + 요청을 가로채는 모의 API:
  초기 조회, 등록, 새로고침, 수정, 저장/삭제 실패 시 목록 보존,
  압축·업로드·미리보기·확대, 사진 저장, 다른 등록자를 포함한 선택 삭제,
  조회 실패 후 쓰기 차단, 샘플, Base64 JSON 가져오기, 조치 후 사진,
  오프라인 발표용 HTML과 API 변경 차단: 통과.
- 원본 대비 CSS 및 HTML 비교: 업로드 상태 요소/파일 accept만 변경.
  계정/마이페이지, 압축, 이력, 필터, 대시보드/통계/내보내기, 일정 코드 보존 확인.

재실행:

~~~powershell
node scripts/check.mjs
node --test tests/worker.test.mjs
node scripts/browser-check.mjs "C:\Program Files\Google\Chrome\Application\chrome.exe"
node scripts/compare-baseline.mjs C:\Users\lotus\hpm-migration-backup\index.original.html
~~~

브라우저 검사는 임시 프로필을 사용하며 운영 API 요청을 전달하지 않습니다.
실제 D1/R2 바인딩 표시, 원격 migration 및 컬럼, Worker 배포,
health/issues 응답과 GitHub Pages Origin CORS는 원격에서도 확인했습니다.
사진 업로드·변경·삭제, GitHub Pages 화면 연동, 다중 사용자 동시 편집 및
실서비스 권한 보호는 원격 환경에서 추가 확인해야 합니다.

## 배포 후 확인 URL과 수동 테스트

1. https://hpmanagement-web.lotusland1995.workers.dev/api/health
   → {"ok":true,"database":true,"photos":true}
2. https://hpmanagement-web.lotusland1995.workers.dev/api/issues
   → 문제점 배열의 정상 JSON.
3. GitHub에 수정 파일을 반영하고 Pages 배포 후
   https://hojezzang.github.io/hpm-web/ 접속 및 강력 새로고침.
4. 로그인 → 테스트 문제점 등록(제목/PND 및 필수 항목, 조치 전 사진).
   저장 완료 메시지 이후 목록에 나타나는지 확인.
5. 새로고침 → 동일 ID/내용/사진 재조회.
6. 수정 → 상태/이력/조치 후 사진 추가 → 저장 → 새로고침해 유지 확인.
7. 전·후 사진 미리보기/확대, 개발자 도구에서 /api/photos/... 200 확인.
   D1의 images/after_images에 data:image 원본 없이 key 배열이 저장됐는지 확인.
8. 기존 사진 제거 → 저장 → 삭제된 사진을 다른 항목이 사용하지 않으면 R2 정리 확인.
9. 본인 등록 문제점 단건 삭제 → 새로고침 후 부재 확인.
   다른 등록자 항목의 삭제 버튼 비활성, 본인 항목 선택 삭제 확인.
10. 샘플/JSON 병합/CSV·JSON 내보내기, 계정/마이페이지, AS·팀 일정,
    발표용 파일을 네트워크 없이 열어 사진까지 표시되는지 확인.

## 제한사항 및 보안

**기존 로그인은 브라우저 내부 로그인입니다. Worker 서버 인증은 아직 없습니다.**
현재 API를 직접 호출하는 사용자의 신원을 검증하지 않습니다.
브라우저 삭제 권한과 CORS는 서버 인증/인가를 대신하지 못합니다.
URL을 아는 사람은 API에 직접 접근할 수 있으며 사진 GET도 인증되지 않습니다.
R2 버킷 자체는 비공개지만 Worker를 통한 사진 접근이 사용자별 비공개인 것은 아닙니다.
업무용 접근 통제가 필요하면 서버에서 검증하는 세션/토큰 및 등록자별 인가를
별도 구현한 후 외부에 공개해야 합니다. 프론트엔드에 공용 비밀키를 넣으면 안 됩니다.

다른 제한:
- 사진 정리와 D1 커밋은 분산 트랜잭션이 아닙니다. 네트워크 단절/탭 강제 종료 시
  미참조 R2 파일이 남을 수 있으며 정리 실패를 자동 재시도하는 예약 작업은 없습니다.
- 공유 사진 참조를 삭제 전 확인하지만 동시에 다른 요청이 같은 사진을 재사용하는
  경합까지 직렬화하지는 않습니다. 대규모 동시 사용에는 참조 관리/잠금 보완이 필요합니다.
- 문제점 전체 조회와 사진 참조 검사에 페이지네이션이 없으므로 규모가 커지면 보완이 필요합니다.
- 동시 수정은 마지막 저장이 적용되며 버전 기반 충돌 감지는 없습니다.
- 구형 데이터 서비스에서 원격 D1로 기존 행을 자동 복사하지 않았습니다.
  보유 JSON 백업을 가져오면 행과 Base64 사진을 API로 이전할 수 있습니다.
- JSON 백업에 들어 있는 사진 URL은 해당 R2 사진을 나중에 삭제하면 유효하지 않습니다.
  오프라인 사진 보존이 필요하면 발표용 HTML 또는 별도 R2 백업을 함께 보관하세요.
- 발표용 HTML에는 기존 방식대로 계정 비밀번호 해시와 업무 데이터·사진이 포함됩니다.
  신뢰할 수 있는 대상에게만 전달하세요.
