# AS출장·팀 일정 통합

기존 HPM 주소, `hpmanagement-web`, `hpmanagement-db`, `as_events` 및 `team_events`를 그대로 사용한다. 새 저장소·사이트·Worker·DB·일정 테이블을 만들지 않았다. 기존 migration 0001~0003이 적용되어 있고 필요한 컬럼이 모두 있어 추가 migration은 없다.

## 화면과 데이터 흐름

주선우 부장님 제공 HTML의 입력 폼, 기본 선택값/기타 직접입력, 두 캘린더 탭, 42칸 월 달력, 다일 일정, 상세 선택/수정/삭제, 기간 겹침 필터, AS구분 복수 선택, 팀 유형 필터, 전체 목록과 JSON 백업 기능을 HPM 카드·버튼 디자인으로 통합했다. 기존 헤더·사이드바와 다른 메뉴는 유지한다. 모바일 입력 폼은 한 열이며 월 달력은 가로 스크롤할 수 있다.

웹사이트 일정은 Worker API가 읽은 D1 데이터만 사용한다. 기존 localStorage 자동 이전과 원본 HTML의 localStorage 저장/전체 교체 가져오기를 제거했다. 예전 브라우저 백업 자체는 삭제하지 않는다. API 조회 실패 시 브라우저 데이터로 대체하지 않는다. 저장·수정·삭제는 API 성공 후에만 일정 배열과 화면에 반영한다. 새로고침·일정 메뉴 재진입 시 서버에서 다시 읽는다.

발표용 파일은 기존에 내장된 스냅샷으로 일정을 읽기 전용 표시한다. 운영 D1의 대체 저장소로 사용하지 않는다. 동적 일정 내용은 textContent 또는 기존 escaping 함수로 표시한다.

## API와 병합 규칙

- 기존 `GET /api/as-events`, `GET /api/team-events`와 ID별 PUT/DELETE를 재사용한다.
- `GET /api/calendars/export`: 최신 D1 일정의 `backup` 객체를 반환한다.
- `POST /api/calendars/import?mode=preview`: 쓰기 없이 신규·중복·충돌 ID 및 차이가 있는 필드를 반환한다. mode 생략 시에도 preview다.
- `POST /api/calendars/import?mode=apply`: 요청 시점의 D1을 다시 비교하고 신규 ID만 추가한다.
- ID가 없거나 날짜/시간/필수값이 잘못된 파일은 쓰기 전에 거부한다. `date`, `workDetail`은 각각 시작/종료일과 작업상세로 정규화한다. 기존 ID는 변경하지 않는다.
- 같은 ID의 업무 필드가 다르면 충돌로 보존한다. 파일에 제공된 등록자·생성/수정시각도 비교하며, 이전 백업에 없는 메타데이터 때문에 거짓 충돌을 만들지 않는다.
- 파일 내부에서 같은 ID의 내용이 다르면 그 ID를 모두 제외하고 나머지 신규 ID만 처리한다. 같은 내용의 반복은 한 번만 추가한다.
- 미리보기 확인 후에는 그때 신규로 표시된 ID만 전송한다. 서버는 고정 prepared statement와 `ON CONFLICT(id) DO NOTHING`을 사용하므로 조회와 저장 사이 다른 PC가 같은 ID를 등록해도 덮어쓰지 않는다.
- 양쪽 테이블의 신규 INSERT는 D1 batch의 한 트랜잭션으로 처리한다. 실패 시 롤백하며, 응답 유실 후 재시도해도 중복되지 않는다.
- 최대 파일 1MB, 한 번에 500개 일정. 원본에 없는 createdAt/updatedAt은 이전 시각을 사용하며, 있는 시각은 보존한다.

다운로드 파일은 `{app:"AS출장_팀캘린더",version:1,exportedAt,asEvents,teamEvents}` 형식으로 원본과 호환된다. UI에서 파일을 선택하면 미리보기와 충돌 목록을 표시하고 사용자가 **신규 일정만 저장**을 누른 뒤 반영한다.

## 기존 로그인 범위

기존 HPM 로그인·세션 유지·계정 방식은 변경하지 않는다. 로그아웃 상태에서 입력 폼과 가져오기 버튼을 비활성화하고 저장·삭제·가져오기 함수에서도 로그인 여부를 확인한다. 기존 사용자별 일정 소유자 제한은 없었으므로 임의의 소유자 제한이나 권한 완화를 추가하지 않았다.

기존 HPM 로그인은 브라우저 기반 시제품이며 Worker가 검증하는 서버 세션이 없다. CORS는 인증을 대신하지 않는다. 이번 작업은 기존 권한 흐름을 보존하는 범위이며 API 자체의 서버 인증 도입은 별도 과제다.

## 이전과 검증

`node scripts/import-calendars.mjs <백업 JSON 경로>`는 읽기 전용 dry-run이다. 실제 신규 데이터 이전은 `--apply`를 붙인다. 전체 삭제나 UPDATE는 하지 않는다. 원본 HTML/JSON은 저장소에 복사하지 않는다.

2026-09-25 이전 전 확인: 운영 AS 0건, 팀 0건. 제공 백업 AS 12건, 팀 13건. ID 누락·파일 내부 중복·운영 ID 중복·충돌 모두 0건, 신규 총 25건. 원본에는 createdAt/updatedAt이 없으므로 신규 이전 시각이 기록된다.

이전 실행 결과: 원본 ID와 업무 필드를 유지하여 AS 12건·팀 13건을 실제 저장했다. 재검사 시 신규 0건·동일 내용 중복 25건·충돌 0건이며 기존 문제점 3건의 데이터 해시는 이전 전후 동일하다. 원본 HTML/JSON 파일의 SHA-256 해시도 작업 전후 동일하다.

검증 결과: 자동 테스트 48개 및 Chrome mock 회귀 검사 통과. Worker 배포 버전 `01854cfc-d559-4c21-9f5f-273003bc0b05`. 운영 일정 CRUD는 임시 전용 ID로 통과하고 해당 테스트 ID만 정리했다. 운영 health·문제점·일정·소화기 API도 정상이다.

검사 명령:

```text
npm.cmd run check
npm.cmd test
node scripts/browser-check.mjs "C:\Program Files\Google\Chrome\Application\chrome.exe"
node scripts/check-remote-calendars.mjs
node scripts/check-remote-fire.mjs
```

자동 검사는 기존 문제점·R2·로그인·발표·소화기 기능과 일정 CRUD, 날짜/시간, 월 경계, 기간 겹침, 다중/기타 필터, XSS, 미리보기 취소, 가져오기 실패/재시도/중복/충돌/동시 삽입, 내보내기 최신성, 모바일을 포함한다. 원격 CRUD 검사가 필요한 경우 `check-remote-calendars.mjs --write`는 새로 생성한 전용 smoke-test ID만 작성·삭제하며 기존 데이터 불변을 검사한다.
