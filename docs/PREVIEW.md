# 웹 개발 미리보기

주소: https://eye215.github.io/pmziip/

`preview/development`는 Phase 2 `a37d0b0`와 Claude 기록 UX `012782c`를 모은 개발 미리보기 브랜치다. 기존 PR #1~#4와 main은 별도로 유지한다. 이 문서의 배포 상태는 개발 미리보기에 한정한다. 실제 서버/AI/GA 연결이나 MVP 운영 완료를 의미하지 않는다.

Pages는 `main` 소스 파일 대신 GitHub Actions가 생성한 Next 정적 빌드 결과를 게시한다. 경로 `/pmziip`는 정적 내보내기에서만 적용하며 기존 로컬 Next 서버 실행은 그대로 제공한다. 빌드가 실패하면 게시 단계를 실행하지 않는다.

## 변경 반영

개발자는 각자 브랜치/PR에서 작업한다. 검토한 변경을 이 브랜치에 통합하고 push하면 `Development preview`가 lint·TypeScript·단위·기존 결합 E2E를 실행한다. 이후 정적 빌드를 생성하고 실제 Pages 경로의 HTML/JS/CSS·저장/재진입·측정 메뉴를 Chromium/WebKit에서 확인한 뒤 게시한다. GitHub Pages 설정은 `GitHub Actions`를 사용한다.

```sh
npm ci --ignore-scripts
npm run check
npm run test:e2e
# 정적 빌드 (셸에 맞춰 환경변수 설정)
PMZIP_STATIC_EXPORT=1 npm run build
npx playwright test --config playwright.preview.config.ts
```

미리보기 입력은 해당 브라우저의 로컬 저장소에만 남는다. PC와 휴대폰 입력은 자동으로 공유되지 않는다. 합성 데이터만 사용하며 실제 회사 자료·개인정보·키를 입력하지 않는다. 브라우저 저장소를 삭제하기 전에 JSON 백업을 내려받는다.

실제 iPhone Safari/PWA는 별도 실기기 검증이 필요하다. Playwright WebKit 검사와 실기기 검증을 구분한다. 배포/검사 기록은 GitHub Actions `Development preview`를 따른다.
