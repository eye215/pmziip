# 개발 진행 현황

기준일: 2026-11-25 · 대상: eye215/pmziip · 브랜치: feat/p0-foundation

## 현재 범위

Phase 0: 명세 인수, 재현 가능한 Next.js 실행 기반, 고객사/프로젝트 합성 fixture, GA v1.2 이벤트 상수 계약, 시간대 월 처리, 전체 요구사항 추적표, 자동 검사와 CI. 코드 구현과 운영 연결은 구분한다.

기존 ZIP은 명세·프로토타입만 있는 상태였다. 기존 데이터/앱을 덮어쓰거나 변환하지 않는다. Apps Script는 정적 검토만 했고, 원본·공유 ID·실제 성과값을 새 앱에 복사하지 않는다.

## 검증 기록

- 로컬 단위 테스트: 11개 통과. 관계 검증·이름 변경 후 ID 보존·시간대 월 경계·유효하지 않은 날짜·GA 완료 이벤트·추적표·원본 HTML 해시.
- lint / TypeScript / production build: 통과. fresh 설치에서 라우트 타입이 없어 실패하지 않도록 typecheck가 next typegen을 먼저 실행한다.
- Playwright: Chromium desktop·Windows WebKit 375×812·320×640에서 3개 통과. 합성 표시·필터·미수집 값·가로 넘침·외부 요청 없음 확인. [375px](screenshots/phase0-375.png), [320px](screenshots/phase0-320.png), [desktop](screenshots/phase0-desktop.png).
- GitHub CI: PR 등록 후 확인.
- 실제 iPhone Safari/PWA: 미검증. Playwright WebKit을 실기기 검증으로 표시하지 않는다.
- 실제 GA/DB/AI/메시지 연동: 미구현·미연결. 실제 수치를 조회하거나 발송하지 않았다.
- npm production dependency audit: 알려진 취약점 0개(실행 시점). ESLint 9 지원 종료 경고와 10 peer 비호환은 README에 유지보수 항목으로 기록.

## 보안과 데이터

공개 저장소에 실제 첨부 Apps Script 원본·실제 스프레드시트/GA 식별자·인증 정보·회사 자료를 올리지 않는다. Zod 합성 fixture 관계 검사는 API 인증/DB RLS가 아니다. 앱에는 아직 사용자 입력 저장이나 업로드 API가 없다. 비밀값은 .env.example에 쓰지 않으며 .env.local과 빌드/테스트 산출물을 Git에서 제외한다.

## 남은 기능 및 다음 조건

F01~F44의 제품 인수 상태는 모두 계획됨이다. Phase 0 CI 및 화면 확인 후 Phase 1에서 실제 고객사/프로젝트 CRUD, 원문 수집함, 다대다 연결, 저장·복원과 인증/권한 계약을 구현한다. 실제 인증/DB를 연결하기 전에는 합성 모드로만 완료 범위를 보고한다.

다음 Phase 착수 조건: Phase 0 PR의 필수 검사 통과, 요구사항 추적·UUID/소유 관계·시간대 계약 인수, 기존 프로토타입 보존 확인. 운영 배포 또는 실제 회사 데이터 처리는 추가 승인이 필요하다.
