# 기술 설계 초안
## 스택 결정 제안
Next.js + TypeScript + React, PostgreSQL/Supabase Auth 및 RLS, Zod, Vitest, Playwright. AI는 서버 전용 provider adapter; 미설정 시 규칙 기반. 기존 저장소에 합리적 스택이 있으면 유지하고 ADR 기록. 로컬 개발은 합성 seed와 mock adapter. 운영 배포는 별도 승인. 라이브러리 버전은 실제 구현 시 공식 문서/호환성 확인 후 lockfile 고정.

## 논리 데이터 모델
모든 프로젝트 소유 데이터는 project_id와 생성/수정 시각, 필요 시 created_by. UUID PK, 관계 FK, 프로젝트 간 교차 FK 방지. 삭제보다 archive 우선.
| 테이블 | 주요 속성 |
|---|---|
| projects | id, owner_id, name, timezone, archived_at |
| requirement_sources | id, project_id, raw_text, source_type, collected_at, sensitivity, reference, status |
| initiatives | id, project_id, title, problem, target_segment, category, status, priority, target_month, contribution, decision_reason |
| initiative_sources | initiative_id, source_id |
| monthly_strategies | id, project_id, month, theme, goal, status |
| strategy_initiatives | strategy_id, initiative_id |
| metrics | id, project_id, name, scope, lifecycle_status |
| metric_versions | id, metric_id, version, unit, direction, formula_spec JSON, population, exclusions, aggregation, approved_at |
| strategy_metrics | strategy_id, metric_version_id, priority |
| measurement_plans | id, initiative_id, version, hypothesis, status, comparison_spec, approved_at |
| plan_metrics | plan_id, metric_version_id, role, target_value nullable, baseline_window, observation_windows |
| data_requests | id, plan_id, fields JSON, grain, filters, availability, owner, status |
| releases | id, project_id, planned_at, actual_at, version, audience, event_type, change_summary |
| release_initiatives | release_id, initiative_id |
| external_events | id, project_id, type, start_at, end_at, audience, description |
| datasets | id, project_id, source, checksum, schema_mapping, imported_at, status |
| observations | id, project_id, metric_version_id, dataset_id, start_at, end_at, segment_key, numerator, denominator, value, sample_size, status, evidence_ref |
| reports | id, project_id, scope_type, scope_id/month, version, as_of, status, snapshot JSON |
| audit_events | id, project_id, actor_id, entity_type, entity_id, action, timestamp, safe_metadata |

## 데이터 규칙
승인된 버전 immutable. 관측 중복키: project + metric_version + period + segment + source identity; 재입력은 수정 이력과 supersede. 기간 [start,end) 규약. 월은 timezone 기준. 합산 가능한 numerator/denominator만 집계. 백분율은 표시 단위 0~100, 내부 비율은 0~1 등 한 규약으로 고정하고 테스트. CSV는 템플릿 기반 집계값 우선, UTF-8/BOM 지원, 수식 삽입 방지, 크기 제한 제안 10MB. 검증 실패 시 부분 저장 금지 기본. 관측값 미확보/무효/정상 구분.

## 모듈/API 계약 (REST 또는 server actions 동일 의미)
- projects CRUD/archive; sources create/list/review; initiatives create/update/link/merge.
- strategies list/upsert; metrics draft/version/approve; plans suggest/update/approve; data-requests export/update.
- releases create/link/list; external-events CRUD; datasets preview/commit/rollback; observations create/list/supersede; reports preview/finalize/export.
- AI suggest endpoints: 인증·프로젝트 소유 검증, 길이 제한, timeout, rate limit, schema validation, 민감도 확인; provider 장애 시 draft fallback. 모델·프롬프트 버전/근거 ID 기록, 민감 원문 로그 금지.
- 모든 쓰기 서버 검증; RLS deny-by-default. 소유자 A가 B 데이터/파일/AI 요청을 접근하지 못함을 테스트. 업로드는 기본 private. 계정 삭제/백업 경로 문서화.

## 폴더 제안
src/app, src/features/{projects,requirements,strategies,metrics,measurement,releases,data,reports}, src/lib/{auth,db,metrics,ai,validation}, supabase/migrations, tests/{unit,integration,e2e}, docs/adr.

## v1.1 스키마 변경 계약 (기존 논리 모델보다 우선)
| 엔티티 | 추가/변경 |
|---|---|
| workspaces | id, owner_id, timezone; 개인 워크스페이스 기본 |
| client_groups | id, workspace_id, name, archived_at |
| projects | workspace_id, client_group_id nullable; 그룹 이동 감사 이력 |
| requirement_sources | workspace_id 필수, project_id nullable(분류 확정값 아님); 원문 접근은 워크스페이스 단위 |
| initiative_sources | workspace 일치 검증; 프로젝트 간 원문 연결 허용, 과제 자체는 단일 프로젝트 |
| initiatives | planned_at nullable, target_month nullable; 수집월은 연결 원문에서 조회 |
| releases | environment, status, planned_at, actual_at nullable, rollback_of nullable, redeploy_of nullable, evidence_ref |
| release_scopes | release_id, segment_key, country/legal_entity/os/audience, exposed_at, ended_at nullable; 실제 PROD 노출 단위 |
| release_initiatives | release_id, initiative_id, as_is, to_be, change_type, evidence_ref; 같은 프로젝트 FK |
| release_revisions | release_id, previous_values, reason, changed_at, actor_id |
| measurement_tasks | release_scope_id, plan_id, window_key, due_at, status, supersedes_id, observation_refs, reason; 재생성 idempotency key |
| reports | workspace_id, client_group_id/project_id nullable, scope_type, period_start/end, report_type, as_of, version, supersedes_id, snapshot, finalized_at, finalized_by, revision_reason |

RLS: 워크스페이스 소유자만 접근; 프로젝트/고객사 관계의 workspace_id 일치 복합 FK 또는 DB 검증. 프로젝트 관계는 project_id 일치 강제, 원문 다중 프로젝트 연결만 의도적 예외. 통합 쿼리는 권한 범위 안에서만 수행. 고객사 이동은 보고서 스냅샷에 영향을 주지 않는다.
월별 쿼리: 수집=연결 원문 collected_at, 기획=planned_at, 목표=target_month, 배포=PROD 실제 노출, 관측=관측 기간 종료일(기본); 입력일 별도 표시. 각 역할별 distinct initiative ID, 전체 합집합도 distinct. 기간 중첩 분석은 별도 옵션. 그룹 집계는 지표 정의/단위/분모/대상 중복 제거 가능 조건이 모두 일치할 때만 허용; 기본은 분리 표시.
측정 기간 기본: D0 프로젝트 현지 날짜, 기준 [D-28,D0), 배포일 제외 후 [D+1,D+29) 28일 완결 비교; D+1/7/14/30 중간 일정은 별도. 실제 시각 기반 분석 필요 시 계획에 별도 명시. 롤백/부분 노출은 비교 기간에 표시; 계획과 산식 버전 저장. D7/D30 코호트는 관측 종료일까지 성숙한 분모만 사용.
API 추가: clients CRUD, workspace inbox, month-filter(role,period,scope), release scopes/revisions, measurement tasks generate/reschedule/complete, timeline markers, reports preview/finalize/revise/latest/export. 확정 보고서는 참조 ID뿐 아니라 표시값·산식·필터·근거·이벤트·그룹명 스냅샷 저장. 서버 계산 결과와 AI 해석 분리.


## v1.2 확장 계약 (2026-11-25)

[ADR 0001](adr/0001-foundation.md)에 Phase 0 스택과 경계를 기록했다. Apps Script/Sheets를 PM.zip 런타임에 포함하지 않는다. 연결 계정은 워크스페이스 소유, 프로젝트 데이터 소스는 계정 참조를 갖는다. 원문 객체는 중복 제거하되 프로젝트 연결별 접근 권한은 확장하지 않는다. 이 계약의 실제 DB/API 구현은 후속 Phase이며 현재 운영 DB·OAuth·수집 스케줄러는 없다.
