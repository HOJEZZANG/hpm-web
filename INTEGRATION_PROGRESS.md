# 생산 1파트 통합 진행 기록

2026-10-23 엑셀·뒤로/앞으로·구분선 개선 및 재부팅 후 재개 상태는 [EXPERIENCE_PROGRESS.md](EXPERIENCE_PROGRESS.md)에 기록한다. 생산 업로드는 새 분할 방식/10MiB로 전환하며 아래 10월 15일 제한은 과거 이력이다. 이번 작업에서 신규 migration·데이터 이전·초기화는 하지 않는다.

2026-10-21 사용자 승인 후 브랜드/상세/테마 변경의 운영 반영은 [BRAND_PROGRESS.md](BRAND_PROGRESS.md)에 기록한다. 과거 전체 문제점 누락 여부는 별도 미해결 항목이며 데이터 복원/초기화/이전은 하지 않는다. 현재 GitHub Pages 주소 유지, 도메인 변경 없음.

2026-10-16 메뉴·로그인·문제점 화면 정리의 최신 상태는 [UI_PROGRESS.md](UI_PROGRESS.md)를 따른다. 아래는 2026-10-15 통합 이력이다. 차량은 외부 서비스 메뉴로 전환했고 안전 체크리스트 진입은 제거했으며, 해당 테이블과 기록은 유지한다.

## 최신 상태 — 2026-10-15

**구현·로컬 검증·운영 반영·운영 읽기 확인 완료.** 사용자 승인으로 D1 계정 + 관리자 가입 승인으로 전환했다. 실제 원본 엑셀과 다른 물리 회사 PC는 미검증이다.

- 작업 폴더 `C:\Users\H-NN1563\hpm-web-company`. 원본은 Downloads의 `hpm-part1-source`에서 읽기만 수행. 기존 노트북 경로 사용 없음.
- 저장소 `hojezzang/hpm-web`, main, 시작 HEAD `5e684ca`, 시작 작업 트리 깨끗함. origin fetch 0/0, 기존 사용자 변경 없음. 원격 정규 주소는 `HOJEZZANG/hpm-web`으로 같은 저장소다.
- 구현 commit **`620d25e`** origin/main push 완료. Pages Actions 성공과 실제 파일 반영 확인. 이 문서와 운영 검사 스크립트는 마무리 commit에 추가한다.
- Worker **`853e4d3a-e18a-4712-bec7-7c56fb8b48a6`** 배포 완료. 기존 배포 설정과 바인딩 유지.
- 사이트 https://hojezzang.github.io/hpm-web/ , API https://hpmanagement-web.lotusland1995.workers.dev .
- D1 `DB` / `hpmanagement-db`, R2 `PHOTOS` / `hpm-photos` 유지. **0004·0005만 원격 적용 완료**. 기존 0001~0003 파일/이력 변경과 재실행 없음.
- 정상 Cloudflare/GitHub 브라우저 인증 완료. 회사 PC Git 작성자는 로그인한 저장소 소유자의 GitHub 비공개 이메일 형식으로 이 저장소에만 설정. 비밀번호·키·토큰의 대화/공개 파일/Git 기록 없음.

## 완료 기능

| 기능 | 상태 |
|---|---|
| 주간 이슈 | 신규 D1 CRUD·주차 필터·회의 확대, 한국 시간 ISO 주차 |
| 생산 일정 | XLSX 양식·검증·미리보기·명시적 반영·현황·장비 공정·PND·필터/다운로드, D1 이력/R2 원본 |
| 소모품 | 품목 XLSX·검색·바구니/수량·신청자/부서/용도·내역/다운로드, D1 보존 |
| 공정 문제점 | 기존 저장소/사진/이력/대시보드/PND 유지, yard/hullNo/productNo/remark/part/factory 보완 |
| 차량 | 관리자 목록 설정, 주간 예약·수정·취소, 동시 중복 예약 DB 트리거 |
| 식수 | 관리자 인원 설정, 주간 7일 식사/일별 합계, 수정 충돌 일괄 롤백, 수동 R2 식단 이미지 |
| 안전 | AC B1~B5 / AHU C1~C5, 5개 결과·이상/조치 D1 저장·조회·수정 |
| AS·팀·소화기 | 기존 기능/데이터/연동 유지, 별도 AS 달력/데이터 없음 |
| 홈·공지·검색·가입 승인 | 기존 테마, 업무 메뉴, 공지/권한 범위 검색, D1 서버 인증과 관리자 승인 |
| 압력검사 | 원본이 개발 예정 화면뿐이므로 제외. 빈 메뉴 없음 |

신규 업무는 모두 빈 상태. 운영 업무 샘플·원본 인원·차량·품목 자동 등록과 기존 자료 이전 없음.

## 백업과 기존 데이터 보존

- D1 백업 `backups/hpmanagement-before-part1-2026-10-15T05-44-39-987Z.sql`, **24,105바이트**.
- SHA256 `f25c095fbbfaee61831b9fe738eeeae1d383026fbc95b70db77795a7f5c23b5f`. 로컬 메모리 복원으로 기존 테이블 값/건수 해시 일치 검증. 백업과 비공개 비교 자료는 Git 제외 확인.
- 변경 전후 기존 열 전체 해시 동일: 문제점 **4건**, AS **12건**, 팀 **16건**. 기존 사진 참조 **2개**의 인증된 R2 읽기와 바이트 SHA256 일치.
- 기존 part/factory는 모두 빈 값 유지. 등록자 ID 추정 없음. 과거 소유자 없는 문제점 삭제는 관리자 제한이며 조회 유지.
- 2026-10 소화기 집계 200, summary/companies가 변경 전과 동일. 기존 연동 secret 유지 확인(값 미출력).
- 운영 업무 쓰기 시험/삭제/초기화 없음. 최초 관리자/일회성 가드, 확인용 로그인/로그아웃과 인증 요청 제한 기록만 정상 생성.

## 인증과 관리자 시작

- 사용자가 임시 loopback 화면에 직접 ID/이름/비밀번호를 입력해 최초 활성 관리자 **1명** 등록. Cloudflare 관리 권한으로 D1에 salt/해시만 저장, DB 트리거로 일회성 가드 동시 확정.
- 공개 최초 설정 secret 미등록, 최초 설정 닫힘. 일반 가입은 pending/user. 서버에서 활성 계정·만료 세션·역할 검증.
- 운영 관리자 HTTPS 로그인 통과. 문제점 4/AS 12/팀 16/사진 2개와 신규 빈 업무 조회 통과. 확인 세션 로그아웃 후 잔여 세션 0 확인. 임시 입력 서버 종료.
- 첫 배포 직후 자동 확인은 실패했으며 통과로 보고하지 않음. 사용자 재입력으로 운영 로그인/조회 재실행 후 통과. 비밀번호/토큰은 메모리에서 제거.
- 관리자는 운영 사이트의 **로그인**에서 직접 정한 ID/비밀번호 사용. 일반 사용자는 **가입 신청 → 관리자 공통/사용자 승인 → 승인 후 로그인**. 예전 브라우저 계정/비밀번호 이전 없음.
- 상세 안내/복구: `OPERATIONS_GUIDE.md`.

## 검증 결과

- Node24.22.0 / npm11.19.1 / Git2.56 / Chrome/Edge. 의존성/lockfile 설치. workerd 필수 Microsoft VC++ x64 런타임 정상 설치.
- `npm test`: **66/66**, 실패/건너뜀 0. CRUD/권한/입력 검증/오류/재시도/기존 문제점·사진·일정·소화기 회귀.
- `npm run check`, Worker dry-run 통과. 기존 migration 파일 diff 없음.
- `npm run test:runtime`: 실제 로컬 workerd+D1/R2의 migration/로그인, **500행 XLSX 입출력**, 인증 원본 다운로드, 동시 차량 충돌, 식수 일괄 롤백 통과.
- `npm run test:browser`: 합성 데이터와 독립 Chrome 2세션의 공용 조회, 입력 보존/실패/재시도/만료 후 재로그인, 안전/차량/식수/엑셀/검색, 기존 문제점/사진/AS/팀, 390px/회의 확대 통과.
- `npm run check:security -- <원본 폴더>`: 공개 자료/키 및 원본 사내 계정·직원 명단 11개 값 비교 통과(값 미출력). npm audit 0건, git diff --check 통과.
- **운영 인증 읽기**: 관리자 로그인, 기존 기록/사진 보존, 신규 10개 빈 컬렉션 조회 통과. 운영 CRUD 쓰기 시험 없음.
- `node scripts/production-read-check.mjs`: HTML/JS/CSS **13개 일치**, 미인증 보호 경로 401, health 200, 최초 설정 닫힘, 소화기 집계 동일.
- `node scripts/production-browser-check.mjs <Chrome>`: 실제 Pages 비로그인 화면·로그인/가입 UI·메뉴 로그인 안내·390px 배치, JavaScript 예외 0. **운영 브라우저 관리자 로그인 검사는 아님**. 관리자 인증은 HTTPS API로 확인.
- 복구 Worker dry-run/build 통과. 실제 운영 rollback 시험 없음.

## 수정 파일과 규칙

- `worker.js`, `index.html`: 기존 기능 연결/인증/추가 필드, 공개 과거 스냅샷/렌더링 기록 제거. 기존 Git 이력 재작성 없음.
- `business/*.mjs`: 인증·권한·주차/PND·레코드·엑셀·업로드·차량·식수·소모품·검색. `business/ui/`: 기능별 화면/공용 컴포넌트/사진·세션/회의 자료/모바일 CSS.
- `migrations/0004_part1_business.sql`, `0005_server_identity.sql`: 추가 schema/트리거, 업무 초기 데이터 없음.
- `tests/`, `scripts/`: 합성 검증, 최초 관리자 임시 UI, 인증정보 미출력 CLI, 백업/보존 비교, 운영 읽기/브라우저 검사, 복구본 생성.
- README/PART1_INTEGRATION/OPERATIONS_GUIDE/진행 문서, package/lockfile. SCHEDULE_INTEGRATION은 직원 이름 1곳만 제거.
- XLSX만 지원: 2MB/500행/40열/10시트/ZIP200항목/실제 해제12MB/JSON1MB. R2 원본/D1 미리보기·명시적 반영. 기존 배치 삭제/추정 병합 없음.
- 주차: 한국 시간 ISO 월요일 기준. 2021-01-01→2020-W53, 2024-12-30→2025-W01, 2027-01-01→2026-W53, 2027-01-04→2027-W01 검증.
- ExcelJS Worker 500행 실행 중단은 제한된 fflate+saxes OOXML로 교체해 해결. ExcelJS는 출력 호환성을 읽는 개발 테스트 의존성.

## 복구와 남은 확인

- 이전 Worker `8962fb31-f473-4a57-a38a-5fc5afad0e0d`, 원래 HEAD `5e684ca`. 버전/해시는 `.wrangler/production/`에 비공개 보관.
- Pages 전환 후 `.wrangler/recovery/`의 **서버 인증을 유지하는 핵심 기능 복구본** 사용. 공개 스냅샷이 있던 구 commit 전체 재게시 금지. 신규 migration은 남김. 상세 명령은 `OPERATIONS_GUIDE.md`.
- 실제 생산/소모품 원본 엑셀·행 식별 기준 미검증. 원본 DB/엑셀/JSON/사진, database/db.py, components/theme.py 미제공. 과거 DB 구조 복원/데이터 이전을 주장하지 않음.
- 실제 다른 물리 PC의 가입/관리자 승인/로그인·조회와 실제 엑셀 반영 전 미리보기 검토는 현장 확인 대상. 로컬 2세션 검증과 구분.
- 압력검사·사내 식단 자동 로그인/수집·원본 사내 계정 사용·ERP·Streamlit 실시간 동기화 제외. 사내 IP/터널/서버 변경 없음.
- 재개 시 문서와 git status/log/remote 확인. 원격 변경을 안전하게 반영. 운영 데이터/기존 migration 초기화, force push 금지.
