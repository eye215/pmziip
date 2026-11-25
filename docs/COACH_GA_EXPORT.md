# Galaxy Coach GA 가져오기 (Apps Script 내보내기 → PM.zip)

기준: 2026-11-25 · 결정 근거: [ADR 0002](adr/0002-apps-script-export-bridge.md)

GCP 콘솔 MFA와 GA 사용자 관리 권한이 확보되기 전까지 쓰는 **임시 수동 경로**다. 흐름은 다음과 같다.

1. 본인 Google 계정에서 **새** 내보내기용 Apps Script를 실행한다. GA4 Data API는 읽기 전용(`analytics.readonly`)으로 호출한다.
2. 스크립트가 만든 JSON 파일을 받는다.
3. PM.zip에서 `백업·가져오기 > Galaxy Coach GA 가져오기`로 가져온다. 순서는 미리보기 → 확인 → 저장이다.

PM.zip은 GA나 Apps Script에 접속하지 않는다. 저장소와 프론트엔드에는 GA 속성 ID나 인증 정보가 없다.

> 실제 회사 수치를 가져오기 전에 조직 승인을 받는다. 승인 전에는 `tests/fixtures/coach-export.synthetic.json` 같은 합성 파일로만 확인한다.

## 지키는 것

- 기존 CoachData·CoachGlobalData Apps Script, 시트, 원본 데이터는 **읽지도 수정하지도 않는다**.
- 조회 정의는 `coach-ga4-1.2`(`src/lib/connectors/coach-definition.ts`)를 따른다. 파일 안의 정의가 다르면 PM.zip이 거부한다. 예를 들어 완료 이벤트가 `galaxy_coach_simulation_Done`이면 거부한다.
- **Done Count**는 `GALAXY_COACH_REPORT` 전체 횟수다. **유효 점수 건수**는 `nsp_value`가 1~5인 건수다. 둘을 따로 저장하고 차이("점수 없는 REPORT")를 표시한다.
- 기간 UU는 GA에 기간 전체로 **직접 조회**한 값이다. 일별, 국가별, Sales Case별 UU를 더하지 않는다.
- GA가 행을 돌려주지 않은 값은 `null`(미집계)로 두고 0으로 바꾸지 않는다. 분모가 0이면 N/A로 표시한다.
- GA 품질 신호를 경고로 표시한다. 임계값 적용, 샘플링, (other) 행 손실, 행 수 제한이 대상이다.
- 같은 내용을 다시 가져오면 중복으로 보고 제외한다. 같은 기간의 값이 달라진 재수집본은 새 이력으로 추가하고 최신 값을 표시한다. 삭제하지 않는다.
- 가져온 데이터는 이 브라우저의 별도 저장 키(`pmzip:coach-ga:v1:…`)에만 둔다. 기존 기록 저장 형식은 바꾸지 않는다.

## Apps Script 설정 (본인 계정에서 1회)

코드: [`tools/apps-script/coach-ga-export/Code.gs`](../tools/apps-script/coach-ga-export/Code.gs), [`appsscript.json`](../tools/apps-script/coach-ga-export/appsscript.json)

1. https://script.google.com 에서 **새 프로젝트**를 만든다. 기존 Coach 스크립트에 붙여넣지 않는다.
2. 프로젝트 설정에서 "편집기에 appsscript.json 매니페스트 파일 표시"를 켠다. 그다음 두 파일 내용을 붙여넣는다.
3. 프로젝트 설정의 **스크립트 속성**에 `GA_PROPERTY_ID` = GA4 속성 번호(숫자만)를 추가한다. 이 값은 저장소, 채팅, 이슈에 쓰지 않는다.
4. 편집기에서 `exportToDrive`를 한 번 실행하고 권한을 승인한다. 요청 권한은 GA 읽기 전용, 이 스크립트가 만든 Drive 파일, 트리거 관리다.
5. 결과 파일 `pmzip-coach-ga-export.json`이 내 Drive에 생긴다. 이 파일을 내려받아 PM.zip에서 가져온다.

### 내려받는 다른 방법 (선택)

- **웹앱**: 배포 → 새 배포 → 웹앱으로 설정한다. 실행 계정은 "나", 액세스 권한은 **"나만"**으로 한다. "모든 사용자"로 바꾸지 않는다. 배포한 URL을 열면 JSON이 바로 내려받아진다. `?start=2026-10-01&end=2026-10-31`을 붙이면 사용자 지정 기간을 받는다.
- **자동 갱신(반자동)**: `installDailyTrigger`를 한 번 실행하면 매일 06시대에 Drive 파일을 덮어쓴다. PM.zip으로 가져오는 단계는 수동이다. 현재 미리보기는 공개 정적 웹이라 스크립트를 직접 부를 수 없다.

기본 기간은 다음 4개다. 날짜는 스크립트 시간대(Asia/Seoul) 기준이다. GA 속성 시간대가 다르면 파일에 경고가 기록된다.

- 최근 7일(어제까지)
- 이번 달 1일~어제
- 지난 2개월 각각의 전체 기간

## 처음 실행한 뒤 확인할 것

- [ ] 같은 기간의 기존 Apps Script 보고서와 Main·Start·Done UU/Count를 비교한다. CoachGlobalData는 구 완료 이벤트와 UU 합산을 쓰므로 **차이가 나는 것이 정상일 수 있다**. 차이의 원인을 기록한다.
- [ ] `customEvent:nsp_value`, `customEvent:nsp_category`가 GA에 이벤트 범위 맞춤 측정기준으로 등록되어 있는지 확인한다. 등록되어 있지 않으면 API 오류가 난다.
- [ ] 점수 값이 정확히 `1`~`5` 문자열인지 확인한다. `5.0` 같은 값은 "1~5가 아닌 점수 값"으로 분리된다.
- [ ] 임계값 경고가 뜨면 기간을 늘리거나, 해당 값이 하한 추정치임을 보고서에 적는다.

## 검증 상태

- 단위 테스트: 파일 계약, 정의 동기화(Apps Script 상수 ↔ `coachDefinition`), 지표 계산, N/A·미집계, 중복 제외와 재수집 이력, 다른 탭 충돌을 검증한다.
- e2e: Chromium desktop과 WebKit 375×812·320×640에서 합성 파일로 거부 → 미리보기 → 확인 → 저장 → 새로고침 → 중복 제외를 확인한다.
- **미검증**
  - 실제 GA 속성에서 Apps Script 실행
  - `drive.file` 범위에서 DriveApp으로 파일을 만들고 덮어쓰는 동작
  - 실제 수치와 기존 보고서 비교
  - 실제 iPhone Safari
