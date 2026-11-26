# Phase 1 기록 화면 UI·접근성 개선 결과 (Claude)

- 기준: `feat/p1-projects-inbox` @ `1b996db2b6e4e1941df359f64cad1a7350a0b95a`
- 작업 브랜치: `feat/p1-records-ux` → PR base `feat/p1-projects-inbox` (병합하지 않음)
- 작성일: 2026-11-25 · 모든 입력은 합성 데이터(`example.invalid`/`synthetic.invalid` 링크, 가상 제목)

## 변경 파일 (허용 범위 내)

| 파일 | 내용 |
|---|---|
| `src/features/records/editors.tsx` | 포커스 복귀, 오류-필드 연결, 표시 문구 한국어화, 측정 안내 문구 변경 |
| `src/features/records/records.css` | 긴 텍스트 줄바꿈, 링크 터치 영역, 하단 메뉴 가림 방지, 오류 박스 포커스 표시 |
| `tests/e2e/records-ux.spec.ts` | 새 회귀 테스트 5개 × 3개 프로젝트 = 15개 |
| `docs/screenshots/claude-records-*` | 375×812 / 320×640 전후 캡처 20장 |
| `docs/handoffs/CLAUDE_RECORDS_UX_RESULT.md` | 이 문서 |

금지 파일(`workspace-app.tsx`, `model.ts`, `persistence.ts`, `browser-store.ts`, `legacy.ts`, `src/lib/**`, `src/app/**`, `src/features/measurement/**`), 패키지·설정·CI·기존 테스트는 수정하지 않았다. 저장 스키마·키·UUID와 저장/승인/병합/가져오기 로직도 그대로다. 공통 CSS 클래스 이름과 export된 컴포넌트(`RecordEditor`, `SourceDetails`, `InitiativeDetails`, `statusNames`, `Editor`)의 props 계약도 유지했다.

## 문제별 재현 → 수정 → 회귀 테스트

각 테스트는 수정 전 코드(기준 커밋)에서 실패하고 수정 후 통과하는 것을 확인했다. 수정 전 실행 결과: 15개 중 14개 실패. desktop 가로 넘침 테스트는 원래 통과하는 것이 정상이다.

### 1. 320px/375px 가로 넘침

- **재현**: 공백 없는 긴 영문 제목, 긴 URL, 긴 원문, 긴 프로젝트·고객사 이름. WebKit 320px에서 문서 폭이 865~1003px로 늘어났다. 요소 상자는 288px로 정상이었고 넘친 것은 **텍스트**였다. 원인은 `h3`(원문·과제·프로젝트·고객사 제목), `details h4`(이전 원문 제목), `label.check`(원문·과제 선택 체크박스)에서 `word-break: keep-all` 때문에 긴 토큰이 줄바꿈되지 않은 것이다.
  - WebKit 모바일은 넘친 내용에 맞춰 layout viewport 자체를 넓힌다. 그래서 `clientWidth` 비교로는 잡히지 않는다. 테스트는 설정된 viewport 폭과 텍스트 Range 경계를 직접 비교한다.
- **수정**: 위 요소와 `summary`·`legend`·`dt`·`dd`·`.badge`·`.field label`·`details li/p`에 `overflow-wrap: anywhere; min-width: 0` 적용. 한국어 단어는 `keep-all`로 계속 묶여 있고, 넘칠 때만 긴 토큰을 끊는다.
- **테스트**: `long titles, English, URLs and raw text do not overflow horizontally`. 프로젝트 탭, 수집함(모든 details 펼침), 기존 과제 연결 편집창, 과제 탭(모든 details 펼침), 과제 수정 편집창에서 넘침 0을 확인한다.

### 2. 편집창 닫은 뒤 포커스 복귀

- **재현**: 키보드로 연 편집창을 취소하거나 저장하면 포커스가 `body`로 사라졌다.
- **수정**: `RecordEditor`가 첫 렌더 시점에 연 버튼을 기억한다. 취소나 저장으로 닫힐 때만 그 버튼에 `focus()`한다. 다른 편집창으로 교체될 때는 새 제목 포커스를 유지한다. WebKit은 마우스나 터치 클릭으로 버튼에 포커스를 주지 않기 때문에, 마지막으로 활성화된 버튼을 document capture 클릭 리스너로 따로 기록한다. 키보드 Enter/Space도 click 이벤트를 발생시키므로 함께 기록된다.
- **테스트**: `closing an editor returns focus to the button that opened it`. 키보드 취소, 키보드 저장, 행 단위 `수정` 버튼(저장 후에도 같은 버튼), 포인터 클릭 후 취소를 확인한다.
- **한계**: 저장 결과로 연 버튼 자체가 사라지면 포커스를 옮기지 않는다. 예를 들어 보관 보기에서 숨겨지는 경우다. 현재 편집창 경로에서는 해당 사례가 없다.

### 3. 오류 안내와 폼 접근성, 저장 실패 시 입력 유지

- **재현**: 오류 문구가 `reference: http 또는 https 링크…`처럼 내부 키로 표시되고 Zod 기본 영어 문구가 섞였다. 입력 필드에는 `aria-invalid`나 `aria-describedby`가 없었다. 실패하면 저장 버튼이 비활성화되면서 포커스가 `body`로 빠졌다.
- **수정**:
  - 오류 박스에 `id="editor-error"`와 `tabIndex=-1`을 주고, form에 `aria-labelledby`(제목)와 오류 시 `aria-describedby`를 연결했다.
  - Zod 경로나 필드 오류를 실제 화면 라벨로 바꿔 표시한다(예: `원문 링크: http 또는 https 링크를 입력해 주세요.`). Zod 기본 문구도 한국어로 바꿨다(`n자 이하로…`, `형식을 확인해…`).
  - 해당 컨트롤에 `aria-invalid="true"`와 `aria-describedby="editor-error"`를 걸고, 실패하면 첫 오류 컨트롤로 포커스를 옮긴다. 컨트롤을 특정할 수 없으면(저장소 쓰기 실패 등) 오류 박스로 옮긴다. 값을 고치면 그 필드의 오류 표시만 해제한다.
  - 날짜 변환 오류는 수집·기획 일시, 중복 제목 확인은 확인 체크박스에 연결했다. 병합·가져오기 승인은 승인 체크박스, 가져오기 미리보기는 `미리보기` 버튼에 연결했다. 던지는 조건과 메시지 문구는 바꾸지 않고 연결할 필드만 붙였다.
  - 가져오기 전용 오류 박스는 `id="import-error"`로 JSON 입력란에 연결했다.
  - 입력값은 편집기 state에 그대로 남는다. 저장 로직은 바꾸지 않았다.
- **테스트**: `errors are linked to fields, focus moves to them, and typed input is kept`. 잘못된 링크, `setItem` quota 실패, 같은 제목 중복의 세 경우에서 포커스 위치, aria 연결, 입력값 유지, 저장소 미변경을 확인한다.

### 4. 상세 표시 문구 한국어화

- **재현**: 상세 화면에 `manual`, `internal`, `improvement`, `high`, `initiative.save` 같은 원래 값이 그대로 보였다.
- **수정**: 표시할 때만 매핑한다. 출처(직접 입력·메일·Slack·Teams·기타), 민감도(공개·내부·기밀), 유형(개선·오류·신규·기타), 우선순위(높음·보통·낮음), 변경 이력 동작(과제 저장 등)이 대상이다. 매핑에 없는 값은 저장된 값 그대로 보여 준다. 상세 문장도 `출처: 직접 입력 · 민감도: 내부`, `… · 수집: <시각>`처럼 라벨을 붙였다.
- **불변**: 저장 값은 그대로다. `collectedAt`·`plannedAt`·`editedAt`·`audit.at`은 저장된 ISO 문자열(초·offset·`Z` 포함)을 그대로 표시한다.
- **테스트**: `detail labels are Korean while stored values and times stay unchanged`.

### 5. 측정 준비 안내

- `측정 준비: 미준비 · 측정 계획은 후속 단계`를 `업무 상태와 측정 준비는 별도로 관리합니다`로 바꿨다. 실제 준비 상태 계산은 구현하지 않았다(Codex 담당).
- 같은 테스트에서 이전 문구가 없음을 확인한다.

### 6. 터치 영역, 하단 메뉴 접근, 마지막 저장 버튼 가림

- **재현**:
  - 상세의 `원문 링크 열기` 링크가 85×15px였다.
  - 하단 메뉴(700px 이하)가 고정된 상태에서, 저장 버튼이 이미 화면 안에 있지만 메뉴 아래에 깔린 경우가 있었다. 이때 Tab으로 포커스해도 브라우저가 스크롤하지 않아 버튼이 가려졌다. 수정 전 375px에서 버튼은 758–802px, 메뉴 상단은 743px였고, 320px에서는 586–630px, 571px였다.
- **수정**:
  - 링크에 `.source-link`(inline-flex, `min-height: 44px`)를 적용했다. 새 창으로 열리는 링크임을 알리도록 화면에 보이지 않는 `(새 창)` 안내를 추가했다(`.visually-hidden`).
  - 700px 이하에서 `html { scroll-padding-bottom }`과 main 안 컨트롤에 `scroll-margin-bottom: 84px + safe-area`를 지정했다. 수정 후 저장 버튼 위치는 375px에서 600–644px, 320px에서 428–472px다.
  - 체크박스는 여러 줄 라벨에서도 첫 줄에 맞춰지도록 위로 정렬했다.
- **테스트**: `touch targets ≥44px, bottom menu reachable, save button not covered`.
  - main 안의 모든 버튼·링크·입력·select·textarea·summary가 44×44 이상인지 확인한다. 체크박스는 감싸는 label을 측정한다.
  - 저장 버튼이 메뉴 영역과 겹치지 않고 `elementFromPoint`로 최상단에 있는지 확인한다.
  - 메뉴 4개 버튼이 모바일에서 52px 이상이고 viewport 안에 있는지, 키보드 Enter로 탭이 전환되는지 확인한다.

## 검증 명령과 실제 결과 (Linux 컨테이너, Node v24.22.3)

```
npm ci --ignore-scripts   → 성공 (0 vulnerabilities)
npm run check             → 성공: eslint 0 warnings · typecheck · vitest 3 files / 25 tests passed · next build 성공
npm run test:e2e          → 39 passed (기존 24 + 신규 15)
```

- 컨테이너의 기본 Node가 v22.23.5여서, 공식 배포본 v24.22.3(SHA256 확인)을 컨테이너 안 `/opt/node24`에 설치해 사용했다. 저장소 설정은 바꾸지 않았다.
- Playwright 1.56.1용 Chromium·WebKit(26.0, build 2215)은 별도 경로(`PLAYWRIGHT_BROWSERS_PATH`)에 설치했다.
- 캡처 재생성 방법: 기준 코드에서 `CAPTURE=before npx playwright test records-ux`, 수정 코드에서 `CAPTURE=after …`를 실행한다. `CAPTURE`가 없으면 파일을 쓰지 않는다. 저장소 크기를 줄이려고 PNG를 2배 해상도·256색으로 줄였다.

## 실기기 검증과 자동화 검증 구분

- **Playwright WebKit**: `devices["iPhone 13"]` 프로필(UA, 터치, DPR 3)에서 viewport만 375×812와 320×640으로 바꿔 실행한 Linux WebKit 엔진 결과다. 위의 모든 e2e와 캡처는 이 환경과 Chromium desktop에서 나왔다.
- **실제 iPhone Safari/PWA**: **미검증**. Linux WebKit은 iOS Safari와 다르다. 예를 들어 `env(safe-area-inset-bottom)` 실제 값, 동적 툴바·키보드가 올라올 때 viewport 변화, VoiceOver 낭독 순서, 터치로 포커스할 때의 동작이 다를 수 있다. 실제 기기에서는 다음 항목을 확인해야 한다.
  - 하단 메뉴와 저장 버튼의 겹침(특히 소프트 키보드가 열린 상태)
  - 오류 발생 시 VoiceOver 안내
  - 편집창을 닫은 뒤 포커스 복귀

## 허용 범위 밖이라 수정하지 않은 사항 (후속 제안)

1. `workspace-app.tsx`의 `백업·가져오기 > 전체 변경 이력`은 여전히 `a.action` 원래 코드(`initiative.save` 등)와 entityId를 표시한다. 표시 매핑이 필요하면 `editors.tsx`의 `actionNames`를 export해서 재사용하는 방식을 제안한다.
2. `workspace-app.tsx`의 `act()`(보관·복원·검토함으로) 실패 안내는 `role="status"` 공지로만 표시되고 해당 버튼과 연결되지 않는다.
3. 과제 편집창 하단의 `측정 준비 상태는 업무 상태와 별개입니다. 측정 계획은 다음 단계에서 작성합니다.` 안내는 이번 범위(상세 화면 고정 문구)가 아니어서 유지했다. Phase 2 측정 계획 UI와 맞출지는 Codex 쪽에서 결정할 필요가 있다.
4. `records.css`는 전역으로 import되므로 700px 이하의 `html { scroll-padding-bottom }`가 앱 전체에 적용된다. 현재 앱은 단일 화면이어서 영향은 의도한 범위 안이다.
5. 편집창 열림·닫힘 때 `workspace-app`이 띄우는 `편집창을 닫았습니다…` 상태 공지는 그대로다.

## 다음 작업

- 실제 iPhone Safari에서 위 실기기 항목 확인
- 위 1·2번 사항을 `workspace-app.tsx` 담당 작업에서 처리할지 결정
