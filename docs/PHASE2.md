# Phase 2 — 합성 로컬 측정 계획·지표 사전

기준일: 2026-11-25. 브랜치 `feat/p2-measurement-plans`, 기준 `feat/p1-projects-inbox`의 `1b996db`. Phase 1 PR #2가 미병합이므로 그 위에 쌓은 별도 PR이다. 병합·배포·운영 연결은 수행하지 않는다.

## 코드 구현

- F05: 프로젝트별 월별 목표·여러 테마·연결 과제·집중 지표. 다른 월로 복사하면 새 ID를 만들고 원본과 연결 버전을 보존한다.
- F06/F08/F34: 프로젝트별 지표 정의, 분자·분모·값 필드·단위·방향·대상·제외·집계 방식·필드·차원·로그 상태. 승인 버전은 불변이며 새 버전으로 수정한다. 모니터링 종료·재개는 시리즈 메타데이터만 바꾼다.
- F06: 과제별 복수 핵심/보조/가드레일 KPI, 목표·기준값·근거·가설·대상·교란 변수·관측 일정을 편집한다. 같은 달 세 과제는 서로 다른 KPI를 쓰고, 같은 정의는 프로젝트 안에서 재사용한다. 템플릿 이름이 같아도 산식·대상이 바뀐 지표는 자동 재사용하지 않는다.
- F07: 필요 필드·이벤트·단위·필터·기준/관측 기간·집계 수준·요청 형식·담당·확인 근거를 Markdown 요청서에 포함한다. 복사 실패 안내와 내려받기를 제공한다.
- F09 부분: 지표 승인 → 계획 승인을 구분한다. 승인만으로 준비 완료가 되지 않는다. 기준값/로그/담당/QA/미확인 항목 누락을 표시하고 예외 사유를 저장한다. 예외를 이용한 실제 배포 기록은 Phase 3에서 연결한다.
- T02: 원문 행 기반 후보는 미승인 초안이다. 사용자가 후보와 프로젝트를 선택하고 확인한 뒤 과제로 연결한다. 원문 본문과 revision은 그대로 남고 연결 상태만 갱신된다. 기존 과제 중복·프로젝트 미선택·중복 후보는 전체 저장 전에 거절한다.
- T05: 규칙 기반 추천과 mock 전용 provider 계약. 잘못된 JSON/스키마·임의 목표·연결되지 않은 근거·provider 오류·timeout은 명시적 규칙 fallback이다. 실제 AI 클라이언트·네트워크·키는 없다. 문서 안 명령은 실행하지 않는다.
- F35 부분: AI 품질 정의의 척도·재현 조건·국가/언어/모델/버전 차원을 기록할 수 있다. 실제 평가 자료 수집·실측·정확도 검증은 미구현이다.

## 데이터 안전 계약

`schemaVersion: 1`을 읽을 때 저장하지 않고 메모리에서만 v2로 해석한다. 첫 쓰기 전에 기존 저장 문자열을 `<원래 key>:before-v2:<revision>`에 그대로 보존한다. 백업 실패·같은 백업 키의 내용 충돌·다른 탭 변경은 기존 값을 덮어쓰지 않는다. v2 저장은 기존 Web Locks와 revision/token 검사, 단일 primary 쓰기를 재사용한다. 백업 후 primary 쓰기가 실패해도 기존 primary와 백업이 남는다.

저장 키의 `v1` 부분은 기존 데이터 탐색을 위해 유지한다. 구 앱은 v2를 알 수 없는 버전으로 거절한다. 이는 합성 브라우저 저장소 계약이며 서버 인증·DB 마이그레이션·기기간 동기화가 아니다. 초안 편집은 명시적 저장까지 확정 값을 바꾸지 않고, 화면 이탈 확인을 취소하면 입력을 보존한다. 지표 초안 간 전환 때 다른 초안의 입력이 섞이지 않도록 편집기 키를 분리한다.

미확보 값은 null, 실제 0은 숫자 0이다. 로그 확인/QA 통과/기준값 확보에는 근거가 필요하다. 추천은 목표 null·로그 unknown으로 시작한다. 기간 UU는 period_unique만 허용하며 일별·국가별·Sales Case별 합산을 금지한다. REPORT 전체 횟수와 유효 1~5 점수 건수는 별도 정의로 남긴다. 실제 집계 계산과 노출 기준 기간 생성은 후속 Phase이다.

## 자동 테스트와 화면 증거

- `npm run check`: lint·TypeScript·단위·production build. 단위 40개 통과: 기존 25개 + 측정/승인 불변/복수 KPI/규칙·mock 오류/원문 분리/무손실 이전 15개.
- 로컬 브라우저 39개 통과: 기존 24개 + Phase 2 흐름 5개 × Chromium desktop, Windows WebKit 375×812, Windows WebKit 320×640. Linux 최종 CI 결과는 PR Checks를 따른다.
- 새 흐름: v1 백업→규칙 초안→지표/계획 승인→새 계획에 기준값 0·근거/QA 등록→준비 상태→요청서 복사/실패/다운로드→재접속, 세 과제 KPI와 편집기 전환, 월 복사·승인 정의 불변, 원문 분리 승인, quota/이탈 취소 시 기존 바이트·입력 보존.
- 캡처 검토 중 KPI 이름이 기존 공통 strong 너비 40px의 영향을 받는 것을 발견했다. 실패하는 너비 회귀 검사로 재현하고 측정 화면 CSS에서만 이름을 전체 너비로 표시하도록 수정했다.
- [375px 계획](screenshots/phase2-375-plans.png) · [320px 계획](screenshots/phase2-320-plans.png) · [375px 지표](screenshots/phase2-375-metrics.png) · [320px 지표](screenshots/phase2-320-metrics.png) · [375px 전략](screenshots/phase2-375-strategies.png) · [320px 전략](screenshots/phase2-320-strategies.png).
- 실제 iPhone Safari/PWA·마이크·운영 환경: 미검증. Windows/Linux Playwright WebKit을 실제 iPhone 검증으로 표시하지 않는다.

## 파일 범위와 병렬 작업

추가: `src/features/measurement/*`, `src/lib/ai/measurement-provider.ts`, 전용 unit/e2e. 기존 변경: records의 model/persistence/workspace-app과 알 수 없는 버전 테스트, README/추적표/검증 문서. Claude 담당 `src/features/records/editors.tsx`, `records.css`, `tests/e2e/records-ux.spec.ts`는 변경하지 않는다.

## 운영 확인과 다음 작업

실제 운영 확인은 하지 않았다. 실제 AI·로그인/API/DB/RLS·GA/Teams/Slack·회사 자료·배포 서버 연결, 새 형식 전체 백업 복원은 미구현이다. Phase 2 결과를 실측 성과나 전체 MVP 완료로 해석하지 않는다. 다음은 Phase 3의 실제 노출·부분 배포/롤백·관측 일정·수동/CSV 데이터와 mock GA 계약이다. 실제 서비스 연결·비용 발생·운영 배포는 별도 승인 대상이다.
