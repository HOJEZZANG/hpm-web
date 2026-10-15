# 생산 1파트 업무 통합 진행 기록

## 기준과 운영 상태
- 작업 폴더: `C:\Users\H-NN1563\hpm-web-company`, 원본 자료는 Downloads의 `hpm-part1-source`에서 읽기만 수행.
- 저장소 `hojezzang/hpm-web`, main, 시작 HEAD `5e684ca`. 시작 작업 트리 깨끗함. origin fetch 후 main과 차이 0/0.
- 기존 Worker `hpmanagement-web`, D1 바인딩 `DB` / `hpmanagement-db`, R2 `PHOTOS` / `hpm-photos`. 배포 설정 변경하지 않음.
- 2026-10-15 사용자 **D1 계정 + 관리자 가입 승인 확정, 준비 후 백업·0004/0005·배포·commit·push·운영 확인 승인**. Cloudflare 공식 브라우저 로그인 완료(인증정보 미출력).
- 운영 배포, 원격 migration 적용, commit, push: 현재 준비 단계. 아래 최신 기록 우선.
- Node 24.22.0 / npm 11.19.1 / Git 2.56.0. Chrome, Edge 설치 확인. 프로젝트 의존성 설치 완료, lockfile 추가. workerd 실행에 필요한 Microsoft VC++ x64 런타임 정상 설치 완료.

## 원본 검토
- `database/db.py`, `components/theme.py` 누락. 원본 SQLite 구조를 복원하지 않음.
- 주간 이슈: 파트/제품/문제점/담당자/PND(자유문자)/계획/실행/특이사항. 신규 D1 설계, 한국 시간 ISO 주차.
- 생산 일정: Sheet1, 날짜 열 작업지시일/PND/FAT/ALIGN.완료일자/생산도접수일/SHELL PIPE 절단요청일/COND PIPE 절단완료일. 장비 열 우선순위 제조사양관리구분→분류→LINE 5000. CHILLER/DECK/AC/PROV/IGG 부분일치. 현공정 '납품준비' 포함=완료. PND<오늘 미완료=지연, 오늘~오늘+7일 미완료=임박. 준수율=완료/(PND<=오늘 또는 완료인 유효 PND 행). 완료일 자료가 없으므로 실제 납기 준수 여부의 증빙은 아님.
- 소모품: 원본은 위쪽 안내 행을 건너뛰는 비표준 엑셀, 폼목명→품목명 보정. 품목코드/품목명/규격/단위/단가/모델번호. 전체 초기화/월 일괄삭제 제외.
- 공정 문제점: 기존 issues를 사용. 원본 NO./발생일자/작성자/귀책부서/제품명/문제점/조치내용/사진은 기존 필드로 대응. 별도 문제점 저장소 금지. 누락된 제품 NO./YARD/HULL/비고 보완 검토. 기존 행 파트/공장 추정 금지.
- 차량: 원본 JSON 로컬 저장, 주간 배차/용도/신청자/시간/비고. 차량번호 자동 등록 금지. 신규 서버 충돌 검증 필요.
- 안전: AC B1~B5, AHU C1~C5, 소화설비/보호구/전기/정리정돈/비상통로 5항목, 양호/조치필요/해당없음. 원본은 저장 없이 성공 표시하는 화면. 신규 D1 저장 구현 필요.
- 식수: 원본 인원 명단과 사내 계정은 이전/출력/사용하지 않음. 주간 식사 입력과 수동 식단 이미지로 대체. 자동 로그인/수집 제외.
- AS: 기존 as_events에 원본 필드 모두 있음. 중복 데이터/달력 추가 불필요.
- 압력검사: 개발 예정 화면뿐. 이번 범위에서 제외하고 메뉴 추가하지 않음.
- DB/엑셀/JSON/사진/식단표 원본 미제공. 이번에 기존 데이터 이전 없음. 신규 테이블은 비어 있는 상태로 시작.
- app.py는 홈/검색/공지/현황 조회이며 직접 쓰기 호출은 없음. 원본의 사내 압력검사 링크와 임시 터널 링크는 사용하거나 연결하지 않음.

## 인증 확인
- 기존 계정과 로그인은 브라우저 저장소 기반이며 Worker API는 서버 인증이 없음. CORS는 인증이 아님.
- 서버 인증 방식(D1 계정/관리자 승인 권장 또는 회사 Access)을 사용자에게 질문함. 답변과 독립적인 업무 구현부터 진행.
- 기존 HTML에 발표용 내장 스냅샷과 렌더링된 예전 내용이 있어 공개 파일 개인정보 제거 필요. 운영 DB 데이터는 변경하지 않음.

## 단계별 상태
1. 환경/원본/기존 구조 조사: 완료.
2. 신규 추가 migration, 업무 규칙/엑셀/API: 로컬 구현 완료. `0004_part1_business.sql`, `0005_server_identity.sql` 추가; 기존 migration 수정 없음.
3. 기능별 UI/기존 기능 연결/인증: 로컬 구현 완료. D1 계정/서버 세션/관리자 승인 권장안을 검토 가능한 형태로 구현. 운영 인증 방식 선택은 답변 대기. 신규 공유 데이터의 localStorage 저장 없음.
4. 합성 데이터 로컬 검증: **API/회귀 66건 전부 통과, 실패/건너뜀 0건.** 실제 Chrome(2개 독립 세션 공용 조회, 저장 실패/재시도, 세션 만료 후 입력 보존, 로그아웃 후 재로그인/중복 이벤트 차단, 주간/안전/차량/식수/엑셀/검색/기존 문제점/인증 사진/AS/팀/390px 모바일) 통과. 실제 workerd+로컬 D1/R2에서 migration, 서버 로그인, **500행 XLSX 읽기/반영/다운로드**, 분류 대체 필터, 인증 R2 다운로드, **동시 차량 예약 차단, 식수 일괄 롤백** 통과. Worker dry-run 및 구문/설정 검사 통과.
5. 공개 파일/원본 사내 계정·명단 비교 검사 통과(값 미출력), npm audit 0건, git diff --check 통과. 최초 1.5MB ExcelJS 브라우저 런타임은 실제 workerd의 500행 처리에서 중단되어 제거하고 fflate+saxes 기반 제한된 OOXML 처리로 교체함. 수정 후 실제 500행 검증 통과. ExcelJS는 테스트에서 출력 호환성을 읽는 용도로만 사용.
6. 운영 반영 전 보고/사용자 확인: 검토본 `PART1_INTEGRATION.md` 작성 완료, 사용자 답변 대기. **원격 migration/백업/배포/commit/push/운영 쓰기 테스트 모두 미실행.** 작업 종료 전 origin fetch 재확인 0/0. Cloudflare CLI는 미인증으로 정상 로그인 필요.

## 재개 방법
이 문서와 git status/diff를 먼저 확인. 기존 migration을 수정하거나 운영 데이터를 초기화하지 말 것. 테스트 결과와 실제 배포 여부를 구분할 것. 인증정보를 출력하지 말 것.

## 현재 구현 파일
- `business/domain.mjs`: 한국 날짜/ISO 주차, 입력 검증, 원본 PND/장비 집계.
- `business/excel.mjs`: 서버 XLSX 검증/ZIP 실제 압축해제 상한/양식/다운로드.
- `business/api.mjs`: 업무별 API 라우팅. `records.mjs`, `bookings.mjs`, `meals.mjs`, `imports.mjs`, `supplies.mjs`, `search.mjs`로 기능 분리. `access.mjs`, `http.mjs`에 공용 권한/입력/파일 응답 처리.
- `business/ooxml.mjs`: Worker에서 실행되는 동기 OOXML 표 읽기/쓰기. 수식 실행, 외부 연결, Node/DOM 의존성 없음.
- `business/auth.mjs`: D1 PBKDF2 계정, 8시간 세션 토큰 해시, 가입 승인/서버 역할 검증/요청 제한/일회성 관리자 설정.
- `business/ui/`: 업무별 파일, 공용 폼/표/세션/사진/조회 전용 회의자료, 모바일 CSS.
- `worker.js`, `index.html`: 기존 기능 보존 연결, 추가 문제점 필드, 공개 내장 스냅샷/렌더링된 과거 기록 제거. 기존 직원/계정/운영 데이터를 새 DB에 넣지 않음.
- `tests/business.test.mjs`, `tests/support/env.mjs`, `scripts/business-browser-check.mjs`, `scripts/local-test-server.mjs`, `scripts/runtime-check.mjs`, `scripts/check.mjs`: 합성 로컬 검증. 기존 worker 테스트를 서버 인증 픽스처로 갱신.
- `package.json`, `package-lock.json`: 재현 가능한 설치. npm audit 0건(설치 시점). ExcelJS의 uuid 의존성 override 적용.
- `README.md`, `PART1_INTEGRATION.md`: 사용/검증/운영 전환 안내. `SCHEDULE_INTEGRATION.md`는 개인정보 이름 한 곳만 제거.

## 검증 적용·산출물
- 0004/0005는 메모리 SQLite 및 임시 workerd D1에만 적용함. 기존 migration 파일은 수정하지 않음. 원격 D1에는 미적용.
- `npm test` 66/66, `npm run check`, `npm run test:runtime`, `npm run test:browser -- <Chrome 경로>`, `npm run check:security -- <원본 폴더>`, `npm audit`, `git diff --check` 통과.
- 브라우저 서버/Chrome과 임시 workerd는 검사 종료 시 정리함. 스크린샷 `.wrangler/business-mobile-qa.png`는 Git 제외된 로컬 합성 자료임.
- 실제 운영 D1/R2/Pages API 조회·쓰기는 이번 로컬 단계에서 검사하지 않음. 실제 생산 Excel 원본과 다른 물리 PC 검증도 미실행.

## 운영 반영 전에 필요한 확인
- D1 계정/서버 세션 + 관리자 가입 승인 방식 채택 여부. 기존 브라우저 계정/비밀번호는 이전하지 않음. 기존 문제점의 소유자 ID도 추측해서 채우지 않음.
- 최종 변경/보안/제한사항 보고 후 운영 반영 확인. 확인 전 백업/원격 SQL/배포/commit/push는 하지 않음.
- 운영 전 D1 백업 확보 후 실제 스키마 확인, 신규 0004/0005만 적용. 이미 있는 열/테이블에는 재적용하지 않음.
- 최초 관리자 설정키는 Cloudflare secret으로 정상 설정, 계정/키는 채팅에 요청하거나 출력하지 않음. 운영 사이트에서 직접 관리자 계정을 설정하고 가입 승인.
- Cloudflare 인증이 없으면 `npx wrangler login` 정상 브라우저 로그인. Git push 인증은 Git Credential Manager 정상 로그인. 인증정보를 저장소에 기록하지 않음.
- 운영 쓰기 테스트는 승인 전 진행하지 않음. 필요 시 테스트 기록 종류/ID와 한정된 정리 범위를 별도로 먼저 제시.

## 2026-10-15 운영 전환 최신 기록
- 사용자 승인으로 D1 인증 확정. 이전의 승인 대기/Cloudflare 미인증 문구는 과거 로컬 단계 기록이다.
- 정상 Cloudflare 로그인 완료. 원격 실제 스키마/0001~0003 이력, 기존 Worker 버전 `8962fb31-f473-4a57-a38a-5fc5afad0e0d` 확보.
- 변경 전 기존 열 기준 해시/건수: issues 4 / as_events 12 / team_events 16. 기존 사진 참조 2개 모두 200, 바이트 해시 확보. 2026-10 소화기 집계 200.
- 최초 관리자: Cloudflare 운영 권한 + 임시 loopback 입력 화면, 비밀번호 메모리 처리, D1 salt/해시만 저장. 새 0005에 관리자/일회성 가드 동시 확정 트리거 추가. 일반 가입은 pending/user로만 생성. 공개 설정 secret은 등록하지 않음.
- `OPERATIONS_GUIDE.md`에 관리자 시작/가입 승인/기존 데이터 접근/복구 안내 작성. `.wrangler/recovery/`에 서버 인증을 유지하는 기존 핵심 기능 복구본 생성. 실제 rollback 미실행.
- 새 트리거 후 `npm test` 66/66, `npm run check`, `npm run test:runtime` 재통과. 백업/신규 migration/최초 관리자 입력/배포는 다음 단계.
- D1 백업 `backups/hpmanagement-before-part1-2026-10-15T05-44-39-987Z.sql` 24,105바이트, SHA256 `f25c095fbbfaee61831b9fe738eeeae1d383026fbc95b70db77795a7f5c23b5f` 확보. 로컬 메모리 복원과 기존 3테이블 해시 일치 검증 완료. Git 제외 확인.
- **운영 0004·0005만 적용 완료**, d1_migrations에 해당 2개 이력 추가. 기존 migration 파일/행 변경 없음. 적용 직후 기존 issues 4 / AS 12 / 팀 16의 기존 열 전체 해시 동일.
- 최초 관리자 임시 loopback 화면에서 사용자 직접 등록 완료, 활성 관리자와 일회성 가드 확인. 계정 정보는 파일·대화에 기록하지 않음. 공개 bootstrap secret 등록하지 않음.
- Chrome 회귀와 보안 검사 재통과. 복구 Worker dry-run 통과. 다음: Worker 배포, 인증 운영 조회, commit/push/Pages 확인.
- Worker `853e4d3a-e18a-4712-bec7-7c56fb8b48a6` 배포 완료(2026-10-15 14:47 KST). health 200, 미인증 기존/신규 데이터·사진 401, 소화기 2026-10 조회 200.
- 운영 관리자 HTTPS 로그인과 실제 읽기 확인 **통과**: 문제점 4 / AS 12 / 팀 16, 기존 문제점 응답값 동일, R2 사진 2개 바이트 SHA256 동일. 신규 주간/안전/차량/인원/공지/생산·품목 업로드/행/소모품 신청 모두 0건. 관리자/확인 인증 외 업무 쓰기 없음. 확인 세션은 로그아웃 처리.
- 첫 배포 직후 자동 인증 확인은 실패하여 통과로 보고하지 않았고, 사용자가 임시 화면에 기존 계정을 다시 입력한 운영 로그인/조회 검사를 재실행해 통과함. 비밀번호/토큰은 파일에 저장하지 않고 확인 후 메모리에서 제거.
- GitHub 정상 로그인 완료. 다음: commit/push 후 실제 Pages HTML·모듈 내용과 운영 화면 검사.
