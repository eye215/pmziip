# PM.zip — Product Impact Tracker

요구사항부터 측정 계획·배포·성과 검증을 연결하는 멀티 프로젝트 PM 워크스페이스.

**[웹 개발 화면 열기](https://eye215.github.io/pmziip/)** · [미리보기 반영 방법](docs/PREVIEW.md). 개발 미리보기는 `preview/development` 브랜치에서 게시합니다.

**현재는 Phase 2 합성 로컬 모드입니다.** 고객사·프로젝트 관리, 원문 수집함·과제 연결·검토 후 분리, 이전 JSON 미리보기 가져오기에 프로젝트 지표 사전·복수 KPI 측정 계획·월별 전략·데이터 요청서 복사/내려받기를 추가했습니다. 지표/계획 승인과 측정 준비 완료는 구분하며, 승인된 버전은 새 버전으로 수정합니다. 추천은 규칙 기반 미승인 초안입니다. 실제 AI·로그인·API/DB 권한·외부 연결은 아직 없습니다. 실제 회사 자료는 입력하지 마세요. 미수집 KPI는 0이나 실제 성과가 아닙니다.

입력은 해당 브라우저에만 보관됩니다. 브라우저 저장소를 지우기 전에 ‘백업·가져오기’에서 JSON을 내려받으세요. 새 형식 백업 복원은 Phase 5 예정이며 현재 가져오기는 v0.1 배열 JSON만 지원합니다. 저장이 실패하면 입력값을 보존하고, 다른 탭의 변경·알 수 없는 데이터 버전·손상된 데이터는 덮어쓰지 않습니다. Web Locks를 지원하지 않는 환경은 쓰기를 거부합니다.

Phase 1 형식은 읽을 때 변경하지 않으며 첫 저장 전에 기존 문자열을 별도 로컬 백업으로 남깁니다. 이 과정이 실패하면 기존 저장을 유지합니다. [Phase 2 구현·검증·제한](docs/PHASE2.md)을 확인하세요.

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

v1.1 원본의 F01~F28/T01~T28은 보존하고 F29~F44/T29~T44를 추가했습니다. 합성 모드 검증을 실제 인증·DB 인수 완료로 표시하지 않습니다. [Phase 1 구현 및 검증](docs/PHASE1.md)에 완료 범위와 보류 항목을 기록합니다. 원본 HTML은 `reference/pmzip.html`에 바이트 그대로 보존했습니다. 이전 개발 README도 `reference/README-v1.1.md`에 있습니다.

저장소: [eye215/pmziip](https://github.com/eye215/pmziip). Phase별 브랜치/PR로 진행하며 main 직접 기능 반영·무단 운영 배포는 하지 않습니다. 첨부 Apps Script 원본과 실제 리소스 식별자는 저장소에 포함하지 않습니다.
