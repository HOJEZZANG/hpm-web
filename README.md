# hpm-web

GitHub Pages + Cloudflare Worker + D1/R2 생산관리 플랫폼.

- [생산 1파트 통합 검토본](PART1_INTEGRATION.md): 기능, 데이터 규칙, 인증 전환, 검증과 운영 반영 절차.
- [작업 진행 기록](INTEGRATION_PROGRESS.md): 완료 단계, 파일, 테스트, migration/commit/배포 여부와 재개 방법.
- [운영 로그인·가입·복구 안내](OPERATIONS_GUIDE.md): 최초 관리자 등록, 기존 사용자 가입 승인과 배포 실패 복구.

로컬 검사: `npm ci`, `npm test`, `npm run check`, `npm run test:runtime`.
실제 브라우저 검사는 `npm run test:browser -- "<Chrome 또는 Edge 실행 파일>"`.
운영 SQL/배포/commit/push는 운영 반영 확인 후 수행한다.
