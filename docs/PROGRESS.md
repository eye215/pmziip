# 개발 진행 현황

기준일: 2026-11-26 · 대상: eye215/pmziip · 최신 브랜치: preview/development (= main)

## 현재 범위

**Phase 0~2와 Phase 3 데이터 연결 일부를 `main`과 개발 미리보기(https://eye215.github.io/pmziip/)에 반영했다.** 최신 상태는 아래 Phase 3 기록을 따른다. 실제 로그인·DB·AI와 GA4 서버 직접 연동, 운영 인수는 미완료다.

아래 Phase 0 검증 기록은 기반 인수 당시의 증거이며 후속 Phase의 제품 기능·운영 인수 상태와 구분한다.

Phase 0: 명세 인수, 재현 가능한 Next.js 실행 기반, 고객사/프로젝트 합성 fixture, GA v1.2 이벤트 상수 계약, 시간대 월 처리, 전체 요구사항 추적표, 자동 검사와 CI. 코드 구현과 운영 연결은 구분한다.

기존 ZIP은 명세·프로토타입만 있는 상태였다. 기존 데이터/앱을 덮어쓰거나 변환하지 않는다. Apps Script는 정적 검토만 했고, 원본·공유 ID·실제 성과값을 새 앱에 복사하지 않는다.

## 검증 기록

- 로컬 단위 테스트: 11개 통과. 관계 검증·이름 변경 후 ID 보존·시간대 월 경계·유효하지 않은 날짜·GA 완료 이벤트·추적표·원본 HTML 해시.
- lint / TypeScript / production build: 통과. fresh 설치에서 라우트 타입이 없어 실패하지 않도록 typecheck가 next typegen을 먼저 실행한다.
- Playwright: Chromium desktop·Windows WebKit 375×812·320×640에서 3개 통과. 합성 표시·필터·미수집 값·가로 넘침·외부 요청 없음 확인. [375px](screenshots/phase0-375.png), [320px](screenshots/phase0-320.png), [desktop](screenshots/phase0-desktop.png).
- GitHub CI: 코드 커밋 cc19d63의 [quality / browsers 모두 통과](https://github.com/eye215/pmziip/actions/runs/45536236658). Node 24/Linux의 lint·typecheck·unit·build 및 Chromium desktop/Linux WebKit 375×812·320×640 확인. 문서 변경 후 최신 상태는 PR의 Checks를 따른다.
- 실제 iPhone Safari/PWA: 미검증. Playwright WebKit을 실기기 검증으로 표시하지 않는다.
- 실제 GA/DB/AI/메시지 연동: 미구현·미연결. 실제 수치를 조회하거나 발송하지 않았다.
- npm production dependency audit: 알려진 취약점 0개(실행 시점). ESLint 9 지원 종료 경고와 10 peer 비호환은 README에 유지보수 항목으로 기록.

## 보안과 데이터

공개 저장소에 실제 첨부 Apps Script 원본·실제 스프레드시트/GA 식별자·인증 정보·회사 자료를 올리지 않는다. Zod 합성 fixture 관계 검사는 API 인증/DB RLS가 아니다. Phase 0 시점에는 사용자 입력 저장이나 업로드 API가 없었다. Phase 1의 로컬 저장은 아래 별도 인수 기록을 따른다. 비밀값은 .env.example에 쓰지 않으며 .env.local과 빌드/테스트 산출물을 Git에서 제외한다.

## 남은 기능 및 다음 조건

Phase 0 시점의 F01~F44 제품 인수 상태는 모두 계획됨이었다. 최신 상태는 요구사항 추적표와 Phase 1 기록을 따른다. Phase 0 CI 및 화면 확인 후 Phase 1에서 실제 고객사/프로젝트 CRUD, 원문 수집함, 다대다 연결, 저장·복원과 인증/권한 계약을 구현한다. 실제 인증/DB를 연결하기 전에는 합성 모드로만 완료 범위를 보고한다.

다음 Phase 착수 조건: Phase 0 PR의 필수 검사 통과, 요구사항 추적·UUID/소유 관계·시간대 계약 인수, 기존 프로토타입 보존 확인. 운영 배포 또는 실제 회사 데이터 처리는 추가 승인이 필요하다.


## Phase 1 진행 (2026-11-25)

합성 로컬 기능·검증·미연결 범위는 [Phase 1 인수 기록](PHASE1.md)을 따른다. 실제 로그인/API/DB 인수가 없으므로 전체 Phase 1 운영 완료로 표시하지 않는다. Phase 0은 PR #1에서 보존하며 후속 PR은 별도 브랜치로 제출한다.

## Phase 2 진행 (2026-11-25)

`feat/p2-measurement-plans`에서 지표 사전/승인 버전·복수 KPI 계획·월별 전략·준비 체크·요청서·검토 후 원문 분리를 구현했다. 규칙 추천과 mock provider만 있으며 실제 AI는 연결하지 않았다. v1 저장은 최초 쓰기 전 정확한 원본 문자열을 보존한다. 단위 40개와 lint/typecheck/build를 통과했다. 최종 브라우저·CI 증거, 모바일 캡처, 미완료 항목은 [Phase 2 인수 기록](PHASE2.md)과 해당 PR Checks를 따른다. Claude의 기존 기록 편집 UI 담당 파일은 변경하지 않았다. 병합·배포·운영 연결은 수행하지 않는다.

## Phase 3 데이터 연결 (2026-11-26)

PR #5~#17로 `preview/development`에 병합·배포했고 `main`에도 반영했다. 실제 데이터 흐름은 다음과 같다.

```
새 스프레드시트 + 새 Apps Script (회사 계정, 매일 06시대 dailyExport)
  ├ Code.gs        GA4 Data API 읽기 전용 → pmzip_export / pmzip_summary
  ├ Dart.gs        OpenDART 단일회사 주요계정(여러 회사) → pmzip_dart / pmzip_dart_summary
  └ StatCounter.gs 국가별 모바일 제조사 점유율(나눠 받기·이어받기) → pmzip_statcounter(_summary, _cache)
링크 보기 공유 → PM.zip이 gviz CSV를 읽기 전용으로 동기화(조각 수·SHA-256 검증, 정의 검증, 중복 제외, 실패 시 미기록)
```

- 화면: **성과** 탭(Coach 요약 타일·월별 추이·전체 지표, 공시 쉽게 보기·분기 매출, 국가별 점유율)과 **백업·가져오기**(연결·동기화·다른 기기 연결 링크)로 나눴다. Coach 프로젝트 카드에 완료율(UU·횟수)과 평균 점수를 표시한다.
- 쉽게 보기는 규칙 기반(`easy-fin-1`) 문장이며 AI를 쓰지 않는다. 숫자는 모두 코드로 계산한다.
- 저장은 브라우저별이다. GA·공시·점유율은 같은 시트를 각 기기에서 연결해 동기화하고, 과제·원문은 기기 간 공유되지 않는다.
- 검증(마지막 병합 기준): 단위 72, 결합 e2e 69(Chromium desktop, WebKit 375·320), 정적 배포 검사 3. Apps Script는 실제 코드를 가짜 GA·DART·StatCounter·Sheets 응답으로 실행해 계약을 검증했다.
- 실제 환경: 사용자 회사 계정에서 세 수집과 PM.zip 동기화를 실행했다. 기존 보고서와 수치 대조, 실제 iPhone Safari 확인은 미기록이다.
- 결정 기록: [ADR 0002](adr/0002-apps-script-export-bridge.md), 설정 방법: [COACH_GA_EXPORT.md](COACH_GA_EXPORT.md).

남은 일: 로그인·DB(기기 간 기록 공유), Business Impact 비교·통계(F39), Gmail·Slack·Teams 수집, AI 해석, GA4 서버 직접 연동(MFA·권한 확보 후).

### 요구사항 수집 (2026-11-26)

통합 수집함에 **요구사항 수집**을 추가했다. 붙여넣기(카카오톡·Teams·Slack·회의록·메일)와 Gmail 라벨·캘린더(비공개 웹앱 파일)를 지원하며, 규칙 기반으로 후보를 뽑고 확인 후 원문·과제 초안으로 등록한다. 설정은 [REQUIREMENT_INTAKE.md](REQUIREMENT_INTAKE.md)를 따른다. Slack·Teams 자동 수집(관리자 승인 필요)과 AI 추출은 미구현이다.
