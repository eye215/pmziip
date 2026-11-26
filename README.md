# PM.zip — Product Impact Tracker

요구사항부터 측정 계획·배포·성과 검증을 연결하는 멀티 프로젝트 PM 워크스페이스.

**현재는 Phase 0 기반입니다.** 합성 프로젝트 화면과 개발 환경만 제공합니다. 실제 로그인, CRUD, 운영 DB, GA4/Teams/Slack/Gmail 연결, AI 호출·자동 보고 및 배포는 구현하거나 실행하지 않았습니다. 화면의 미수집 값은 0이나 실제 성과가 아닙니다.

## 실행

Node **24 이상**과 npm이 필요합니다. 실제 계정이나 API 키 없이 실행됩니다.

```sh
npm ci --ignore-scripts
# 선택: .env.example을 .env.local로 복사해 Next telemetry를 끕니다.
npm run dev
```

<http://127.0.0.1:3000>을 엽니다. 모바일 기기 실사용 배포는 아직 없습니다.

## 검증

```sh
npm run check
# lint → typecheck → unit → production build
npx playwright install --with-deps chromium webkit
npm run test:e2e
```

브라우저 테스트는 직전 빌드 결과를 `127.0.0.1:4310`에서 실행합니다. CI는 Playwright 1.56.1 패키지와 동일 버전의 공식 컨테이너를 사용하므로 브라우저 설치 단계가 없습니다. Node 버전은 CI에서 24로 고정합니다. 결과는 [진행 현황](docs/PROGRESS.md)에 구분해 기록합니다.

ESLint는 Next의 React/import/accessibility 플러그인 peer 범위와 맞는 9.39.5로 고정했습니다. npm이 해당 메이저의 지원 종료 경고를 표시합니다. ESLint 10은 현재 번들의 peer 범위를 벗어나므로 강제로 설치하지 않습니다. 플러그인 호환 업그레이드는 후속 유지보수 항목입니다.

## 명세와 진행

- [공통 개발 규칙](AGENTS.md)
- [PRD](docs/01-PRD.md) / [FRD](docs/02-FRD.md) / [Architecture](docs/03-architecture.md)
- [Phase 순서](docs/04-phases.md) / [인수 테스트](docs/05-tests.md)
- [v1.2 확장 명세](docs/06-v1.2-spec.md) / [F01~F44 추적표](docs/07-requirements-trace.md)
- [기반 ADR](docs/adr/0001-foundation.md) / [첨부 코드 검토](docs/REFERENCE_REVIEW.md)

v1.1 원본의 F01~F28/T01~T28은 보존하고 F29~F44/T29~T44를 추가했습니다. Phase 0의 테스트를 제품 기능 인수 완료로 표시하지 않습니다. 원본 HTML은 `reference/pmzip.html`에 바이트 그대로 보존했습니다. 이전 개발 README도 `reference/README-v1.1.md`에 있습니다.

저장소: [eye215/pmziip](https://github.com/eye215/pmziip). Phase별 브랜치/PR로 진행하며 main 직접 기능 반영·무단 운영 배포는 하지 않습니다. 첨부 Apps Script 원본과 실제 리소스 식별자는 저장소에 포함하지 않습니다.
