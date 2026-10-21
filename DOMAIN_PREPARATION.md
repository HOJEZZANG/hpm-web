# 도메인 검토 이력 — 현재 GitHub Pages 주소 유지

**최신 결정:** 사용자는 `portal.hpm.com` 사용 계획을 취소했다. 해당 주소 연결은 진행하지 않는다. 현재 `https://hojezzang.github.io/hpm-web/`을 유지하며 도메인·DNS·CNAME·Pages 도메인 설정 변경은 없다. 새 도메인은 확정 후 별도 승인된 작업으로 다룬다. 아래는 이전 검토 당시의 기술 참고 이력이며 현재 실행 계획이나 사용자 준비 요청이 아니다.

2026-10-21 작성. `hpm.com` 소유권·사용 허가·DNS 관리 권한은 확인되지 않았다. 사용 가능하거나 연결이 완료됐다는 의미가 아니다. 이번 작업에서는 구매/DNS/GitHub Pages custom domain/CNAME 파일/주소 전환을 하지 않는다.

## 사용자 준비사항

1. `hpm.com` 소유자와 관리 담당자를 확인하고 `portal.hpm.com` 사용 허가, DNS 레코드 변경 권한을 확보한다. 비밀번호·인증키를 채팅으로 전달하지 않는다.
2. 현재 `portal` 레코드 및 기존 서비스를 담당자와 확인한다. 기존 서비스와 충돌하면 전환 시점·복구 담당자를 먼저 정한다.
3. GitHub 저장소 Pages 설정 권한과 도메인 소유권 검증용 TXT 레코드 등록 담당자를 정한다. GitHub는 도메인 검증을 권장한다. [공식 소유권 검증 안내](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages)
4. 추후 별도 승인된 전환에서 GitHub Pages custom domain을 먼저 설정한 뒤 DNS의 `portal` CNAME을 `hojezzang.github.io`로 연결하고 인증서 발급·HTTPS 강제를 확인한다. CNAME 대상에는 `/hpm-web/` 경로를 넣지 않는다. 현재는 이러한 레코드/파일을 만들지 않았다. [공식 하위 도메인·HTTPS 안내](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)

## 현재 구조와 전환 영향

- 현재 프런트엔드는 `https://hojezzang.github.io/hpm-web/`, Worker는 `https://hpmanagement-web.lotusland1995.workers.dev`다. D1 `DB`와 R2 `PHOTOS`를 사용한다. 프런트 도메인만 변경해도 API 호스트가 자동으로 바뀌지 않는다.
- Worker의 허용 Origin/CORS와 Origin 검사, 로그인·로그아웃 요청의 검증을 새 HTTPS Origin에 맞춰야 한다. 전환 중 두 주소를 함께 제공할 경우 명시적인 허용 목록으로 설계하고 CORS를 인증 대용으로 사용하지 않는다. [Cloudflare CORS 공식 예제](https://developers.cloudflare.com/workers/examples/cors-header-proxy/)
- 현재 인증은 D1 계정 + Bearer 서버 세션이다. 토큰은 탭의 sessionStorage에 있으며 인증 쿠키를 사용하지 않는다. 새 Origin으로는 기존 세션 저장값을 자동 이전하지 않으며 사용자가 다시 로그인한다. 계정·승인·업무 데이터는 서버에 남는다. 향후 쿠키 방식으로 변경한다면 별도로 HttpOnly/Secure/SameSite/Domain/credentials/CSRF 설계를 검토해야 한다.
- `index.html`의 API 주소, `session.js`의 API·인증 사진 요청, Worker의 API/사진 URL 허용 규칙을 함께 확인한다. API 호스트까지 바꿀 때 기존 D1에 저장된 사진 URL이 계속 읽히도록 호환 정책을 먼저 준비한다. URL을 일괄 덮어쓰지 않는다.
- 상대 경로인 로고 `assets/hi-air-korea-logo.png`와 CSS/JS가 현재 `/hpm-web/` 및 새 도메인의 `/`에서 읽히는지 확인한다. 절대 경로/내보낸 문서/외부 링크/캐시도 검토한다.
- 테마 등 브라우저 저장 설정은 Origin별로 분리된다. 기존 주소에서 선택한 테마·로컬 파일 백업·탭 세션이 새 주소로 자동 이전되지 않는다. 저장소 전체 삭제나 자동 복사는 하지 않는다.
- 전환 전에 새 주소의 실제 로그인/권한/사진/읽기·쓰기·로그아웃/모바일/HTTPS를 검증하고, 기존 주소와 Worker 버전으로 돌아갈 절차를 준비한다. 현재 URL은 계속 유지한다.
