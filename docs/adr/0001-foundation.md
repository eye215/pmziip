# ADR 0001 — Phase 0 기반과 구현 경계

날짜: 2026-11-25 · 승인 범위: 신규 개발 및 GitHub 저장소 준비. 운영 연결·배포 제외.

## 기존 상태

- v1.1 ZIP에는 명세 9개와 localStorage 기반 참고 HTML 1개가 있다. 앱, 서버, DB, 테스트, 배포 구현은 없다.
- 사용자 지정 작업 저장소는 `eye215/pmziip`. 준비 중 생성한 별도 비공개 `eye215/pmzip`에는 초기 README만 있으며 이 앱 코드를 올리지 않는다.
- `reference/pmzip.html`은 바이트 그대로 보존하고 SHA-256으로 검사한다. 기존 localStorage 키에 접근하지 않는다.
- 첨부 Apps Script 두 개와 HTML은 로컬 참고로만 검토했다. 소스 원본, 실제 스프레드시트·GA 리소스 ID, appsscript.json은 업로드하지 않는다.

## 결정

Next.js App Router + TypeScript + React + Zod + Vitest + Playwright를 사용한다. npm 레지스트리의 실제 버전과 peer/engine 조건을 확인하고 package-lock으로 고정한다. 개발/CI 기준 Node 24, CI Playwright 이미지와 npm 패키지 버전은 일치시킨다. Next 빌드와 lint를 독립 실행한다.

공식 근거: [Next 설치](https://nextjs.org/docs/app/getting-started/installation), [Vitest 설치](https://vitest.dev/guide/), [Playwright Docker](https://playwright.dev/docs/docker).

Phase 0에는 합성 데이터 전용 화면, UUID 기반 고객사·프로젝트 계약, 프로젝트 시간대 월 표시 함수, GA 이벤트 정의, 추적표와 자동 검사만 포함한다. 지표 수치는 미수집으로 표시한다. CRUD·인증·원문·지표 계산·실제 GA adapter·AI·자동화는 후속 Phase다.

## 관계 및 날짜 계약

- 워크스페이스 > 고객사(선택) > 프로젝트. 고객사 없는 독립 프로젝트 허용.
- 프로젝트 소유 데이터는 project_id, 원문은 workspace_id 소유. 프로젝트 간 연결은 명시적 관계이며 원문 객체 중복을 만들지 않는다.
- 프로젝트 이름은 식별자가 아니다. 관계는 UUID로 유지한다.
- 타임스탬프는 명시적 offset이 있는 ISO instant. 저장은 UTC, 조회 월은 프로젝트 IANA 시간대. 기간은 `[start,end)`.
- 실제 PROD 노출 단위는 release_scope. 예정/QA 시각은 성과 기준이 아니다. D0 현지 날짜와 UTC 경계 변환·DST 전체 기간 계산은 Phase 3에서 추가 검증한다.
- 합성 UI 필터는 접근 권한 검증이 아니다. 실제 인증 및 DB 정책은 Phase 1 API/DB 인수 조건을 통과해야 한다.

## GA 및 통계 계약

완료 UU와 Count는 모두 `GALAXY_COACH_REPORT`를 조회한다. 전체 REPORT eventCount와 유효 S1~S5 합계는 별도 필드로 저장한다. 점수 누락을 완료 0으로 바꾸지 않는다. 일별/국가별/Sales Case별 UU를 더해 전체 UU로 표시하지 않는다. 필요 기간의 전체를 별도 조회한다.

Apps Script/Sheets는 운영 의존성이 아니다. 인증 전에는 mock만 허용한다. 읽기 전용 GA API·자격 증명 암호화·quota·품질 메타데이터는 Phase 3 계약/Phase 7 승인 연결에서 구현한다. 비율·통계는 결정적 코드, AI는 근거 있는 해석 초안만 제공한다.

## 대안 및 한계

원본 HTML을 바로 확장하는 방식은 단일 배열·문자열 월 검색·추천값 자동 덮어쓰기 문제 때문에 채택하지 않는다. 운영 DB와 인증을 바로 연결하지 않아 지금 UI를 보안 격리 또는 실제 분석 완료로 평가할 수 없다. 배포 계정·유료 AI·실제 조직 자료 사용은 승인 범위가 아니다.
