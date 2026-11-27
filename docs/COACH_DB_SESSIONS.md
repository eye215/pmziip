# Galaxy Coach DB 세션 집계 (V1 Stage · V2 Sales)

PM.zip → 설정 → **Galaxy Coach DB 세션 가져오기**. MongoDB에서 내보낸
`voice_sessions`, `stage_infos`, `sales_infos`, `users` JSON(배열 또는 줄마다 한 문서,
Extended JSON `$oid`/`$date`/`$number*` 허용)을 **브라우저 안에서만** 읽어 계산한다.
파일은 업로드하지 않고, 저장소·대화에도 넣지 않는다. 브라우저에는 월별 집계와 품질
점검만 남는다(사용자 ID 없음). 세션 CSV는 집계 직후에만 내려받을 수 있다.

코드: `src/lib/coach-db/` (ejson, normalize, aggregate, export), 화면:
`src/features/coach-db/`. 테스트: `tests/unit/coach-db.test.ts`, `tests/e2e/coach-db.spec.ts`
(합성 데이터).

## 규칙 요약

- V1: `voice_sessions._id` = 진입 1건(Stage 1·2·3 구분 없이). `stage_infos.state.stage_info.stage1~3`
  (객체 또는 배열)을 세션 단위로 펼쳐 `session`으로 연결, `step == "completed"`면 완료.
  연결 실패는 잠정 미완료 + 품질 보고서. 국가: `state.countryCode` → 없으면 users.
- V2: `state.sales_info.session` = 진입 1건(객체 또는 배열, 미완료 포함). `status == "completed"`면 완료,
  `goal_complete`는 쓰지 않음. step·report 교차 검증. 국가: `users.personalData.countryCode`.
- 국가를 알 수 없으면 `UNKNOWN`(추정 안 함). (버전, session_id)로 중복 제거, 입력 순서와 무관하게 같은 결과.
- 완료율 = 전체 완료 건수 ÷ 전체 진입 건수(평균의 평균 아님), 분모 0은 N/A.
- 월 = 진입 일시 기준, 시간대 설정(UTC 기본 / Asia/Seoul). 진입 월에 완료 여부 반영.
- 삭제 데이터 기본 제외, 집계 채널·테스트 채널은 화면 설정. 전환일은 고정하지 않고
  품질 보고서의 V1·V2 최초/최종 일시·중첩 구간으로 확인.

## 산출물 (화면에서 내려받기)

galaxy_coach_sessions.csv, monthly_country_summary.csv, monthly_global_summary.csv,
monthly_version_summary.csv, data_quality_report.csv, galaxy_coach_statistics.xlsx, README.md

## 필드 경로가 다를 때

실제 문서의 필드명이 다르면(예: 채널, 점수, 시뮬레이션 유형) `src/lib/coach-db/normalize.ts`의
후보 경로 목록에 추가한다. 품질 보고서의 "레코드 오류"·"매핑 실패" 건수로 먼저 확인한다.
