# 첨부 코드 대조 결과

검토일: 2026-11-25. 아래는 로컬 첨부 코드의 정적 검토 결과다. 운영 코드 변경이나 GA 조회를 실행하지 않았다.

| 자료 | 확인한 상태 | v1.2 적용 계약 |
|---|---|---|
| CoachData Apps Script | 완료 이벤트가 이미 GALAXY_COACH_REPORT | 그대로 참조. 운영 스크립트 수정 없음 |
| CoachGlobalData Apps Script | 구 완료 이벤트 조회 3곳, Done Count를 점수 1~5 합계로 계산 | 완료 전체/국가/Sales Case 모두 REPORT, REPORT 횟수와 유효 점수 횟수 분리 |
| CoachGlobalData 합계 함수 | Sales Case별 UU를 더해 합계로 표시 | 전체 기간 UU 별도 조회. 차원별 중복 사용자 단순 합산 금지 |
| 웹 HTML | Apps Script의 응답을 표시 | 신규 Next 앱에서 프로젝트별 모델 사용, GAS 호출 의존성 제외 |
| appsscript.json | GA 고급 서비스·Sheets·외부 요청·익명 웹앱 설정 | 기존 GAS 설정 참고일 뿐 PM.zip 인증·배포 설정으로 복사하지 않음 |

실제 리소스 ID와 첨부 원본 코드는 저장소에 복사하지 않았다. GA 데이터 API 연결은 아직 구현하지 않았으며 현재 상수 계약의 단위 테스트만 제공한다. 실제 값이 기존 리포트와 일치하는지는 인증 후 별도 비교해야 한다.
