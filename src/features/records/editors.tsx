"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { z } from "zod";
import {
  clientInput,
  projectInput,
  sourceInput,
  initiativeInput,
  workStatuses,
  type RecordsState,
  type Source,
  type Initiative,
  type Command,
} from "./model";
import { previewLegacy, importLegacy } from "./legacy";
import { runtime, saveRecords, session } from "./browser-store";
import { localDateTime, instantFromLocal } from "../../lib/time";

export const statusNames: Record<string, string> = {
  draft: "초안",
  approved: "승인",
  planned: "계획",
  in_progress: "진행 중",
  released: "배포됨",
  archived: "보관",
  canceled: "취소",
  inbox: "미분류",
  reviewed: "검토함",
  linked: "연결됨",
};
// Display-only Korean labels. Stored values are never rewritten.
const sourceTypeNames: Record<string, string> = {
  manual: "직접 입력",
  mail: "메일",
  slack: "Slack",
  teams: "Teams",
  other: "기타",
};
const sensitivityNames: Record<string, string> = {
  public: "공개",
  internal: "내부",
  confidential: "기밀",
};
const categoryNames: Record<string, string> = {
  improvement: "개선",
  fix: "오류",
  new: "신규",
  other: "기타",
};
const priorityNames: Record<string, string> = {
  high: "높음",
  medium: "보통",
  low: "낮음",
};
const actionNames: Record<string, string> = {
  "client.save": "고객사 저장",
  "client.archive": "고객사 보관 상태 변경",
  "project.save": "프로젝트 저장",
  "project.archive": "프로젝트 보관 상태 변경",
  "source.save": "원문 저장",
  "source.status": "원문 상태 변경",
  "source.link": "원문 연결",
  "initiative.save": "과제 저장",
  "initiative.merge": "과제 병합",
  "legacy.import": "이전 버전 가져오기",
};
/** Unknown values are shown as stored so nothing is hidden. */
function named(names: Record<string, string>, value: string) {
  return Object.hasOwn(names, value) ? names[value] : value;
}

/** Error raised for a specific form value (path matches the input field). */
class FieldError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
  }
}
function atField<T>(path: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof FieldError || error instanceof z.ZodError) throw error;
    throw new FieldError(path, error instanceof Error ? error.message : "");
  }
}
const ERROR_ID = "editor-error";
type FormErrors = { invalid: string[]; clear: (path: string) => void };
const FormErrorContext = createContext<FormErrors>({
  invalid: [],
  clear: () => {},
});
/** aria props linking a control to the editor error when its value is invalid. */
function useInvalid(path?: string) {
  const ctx = useContext(FormErrorContext);
  const invalid = !!path && ctx.invalid.includes(path);
  return {
    props: {
      "data-path": path,
      "aria-invalid": invalid || undefined,
      "aria-describedby": invalid ? ERROR_ID : undefined,
    },
    clear: () => {
      if (invalid && path) ctx.clear(path);
    },
  };
}

export type Editor = {
  kind:
    | "client"
    | "project"
    | "source"
    | "initiative"
    | "link"
    | "merge"
    | "import";
  id?: string;
  sourceId?: string;
  projectId?: string;
  revision: number;
};
function Field({
  name,
  label,
  value,
  change,
  area = false,
  type = "text",
  required = false,
  path,
  hint,
}: {
  name: string;
  label: string;
  value: string;
  change: (v: string) => void;
  area?: boolean;
  type?: string;
  required?: boolean;
  /** Input key used in validation errors (e.g. "title"). */
  path?: string;
  /** id of a visible hint/error that describes this field. */
  hint?: string;
}) {
  const invalid = useInvalid(path);
  const describedBy =
    [invalid.props["aria-describedby"], hint].filter(Boolean).join(" ") ||
    undefined;
  const common = {
    id: name,
    value,
    required,
    ...invalid.props,
    "aria-describedby": describedBy,
  };
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      {area ? (
        <textarea
          {...common}
          onChange={(e) => {
            invalid.clear();
            change(e.target.value);
          }}
        />
      ) : (
        <input
          {...common}
          type={type}
          onChange={(e) => {
            invalid.clear();
            change(e.target.value);
          }}
        />
      )}
    </div>
  );
}
function Select({
  name,
  label,
  value,
  change,
  children,
  disabled = false,
  path,
}: {
  name: string;
  label: string;
  value: string;
  change: (v: string) => void;
  children: ReactNode;
  disabled?: boolean;
  path?: string;
}) {
  const invalid = useInvalid(path);
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <select
        id={name}
        value={value}
        onChange={(e) => {
          invalid.clear();
          change(e.target.value);
        }}
        disabled={disabled}
        {...invalid.props}
      >
        {children}
      </select>
    </div>
  );
}
function issueText(issue: z.core.$ZodIssue) {
  if (issue.code === "custom") return issue.message;
  if (issue.code === "too_big" && typeof issue.maximum === "number")
    return `${issue.maximum}자 이하로 입력해 주세요.`;
  if (issue.code === "invalid_format") return "형식을 확인해 주세요.";
  return "입력값을 확인해 주세요.";
}
/** Confirmation checkbox; same markup as before plus error linking. */
function Confirm({
  path,
  checked,
  change,
  children,
}: {
  path: string;
  checked: boolean;
  change: (checked: boolean) => void;
  children: ReactNode;
}) {
  const invalid = useInvalid(path);
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => {
          invalid.clear();
          change(e.target.checked);
        }}
        {...invalid.props}
      />
      {children}
    </label>
  );
}
function message(error: unknown) {
  return error instanceof z.ZodError
    ? error.issues
        .map((i) => `${i.path.join(".")}: ${issueText(i)}`)
        .join(" / ")
    : error instanceof Error
      ? error.message
      : "저장하지 못했습니다. 입력값을 보존했습니다.";
}
/** Field paths named by an error, in issue order. */
function errorPaths(error: unknown): string[] {
  if (error instanceof FieldError) return [error.path];
  if (error instanceof z.ZodError)
    return error.issues.map((i) => String(i.path[0] ?? "")).filter(Boolean);
  return [];
}
/** Uses the on-screen label for a path so messages match what users see. */
function describeError(form: HTMLFormElement | null, error: unknown) {
  const labelFor = (path: string) => {
    const control = form?.querySelector<HTMLElement>(
      `[data-path="${CSS.escape(path)}"]`,
    );
    const label =
      control?.id &&
      form?.querySelector(`label[for="${CSS.escape(control.id)}"]`);
    return (
      (label && label.textContent?.trim()) ||
      control?.closest("label")?.textContent?.trim() ||
      path
    );
  };
  if (error instanceof z.ZodError)
    return error.issues
      .map((i) =>
        i.path.length
          ? `${labelFor(String(i.path[0]))}: ${issueText(i)}`
          : issueText(i),
      )
      .join(" / ");
  if (error instanceof FieldError)
    return `${labelFor(error.path)}: ${error.message || "입력값을 확인해 주세요."}`;
  return message(error);
}
function Frame({
  title,
  close,
  save,
  children,
}: {
  title: string;
  close: () => void;
  save: () => void | Promise<void>;
  children: ReactNode;
}) {
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // Bumped on each failure so focus moves even when the message repeats.
  const [failures, setFailures] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const errorBox = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    if (!failures) return;
    // Focus the first invalid control; otherwise the message itself, since
    // the disabled submit button would leave focus on the page body.
    const target =
      invalid
        .map((path) =>
          form.current?.querySelector<HTMLElement>(
            `[data-path="${CSS.escape(path)}"]:not(:disabled)`,
          ),
        )
        .find(Boolean) || errorBox.current;
    target?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run per failure
  }, [failures]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await save();
    } catch (error) {
      // Typed values stay in the editor state; only the message changes.
      setError(describeError(form.current, error));
      setInvalid(errorPaths(error));
      setFailures((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="editor panel" aria-labelledby="editor-title">
      <h2 id="editor-title" ref={heading} tabIndex={-1}>
        {title}
      </h2>
      <p className="subtle">
        이 브라우저에만 저장됩니다. 실제 회사 자료는 입력하지 마세요.
      </p>
      <form
        ref={form}
        onSubmit={submit}
        aria-labelledby="editor-title"
        aria-describedby={error ? ERROR_ID : undefined}
      >
        <FormErrorContext.Provider
          value={{
            invalid,
            clear: (path) => setInvalid((x) => x.filter((p) => p !== path)),
          }}
        >
          <fieldset className="editor-fields" disabled={busy}>
            {children}
          </fieldset>
        </FormErrorContext.Provider>
        {error && (
          <p
            id={ERROR_ID}
            ref={errorBox}
            role="alert"
            className="error-box"
            tabIndex={-1}
          >
            {error}
          </p>
        )}
        <div className="form-actions">
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "저장 중…" : "확인하고 저장"}
          </button>
          <button type="button" onClick={close} disabled={busy}>
            취소
          </button>
        </div>
      </form>
    </section>
  );
}
type Props = { state: RecordsState; editor: Editor; close: () => void };
async function persist(command: Command, editor: Editor, close: () => void) {
  await saveRecords(command, editor.revision);
  close();
}

function ClientEditor({ state, editor, close }: Props) {
  const old = state.workspace.clients.find((x) => x.id === editor.id);
  const [data, setData] = useState({
    name: old?.name || "",
    description: old?.description || "",
  });
  return (
    <Frame
      title={old ? "고객사 수정" : "고객사 추가"}
      close={close}
      save={() =>
        persist(
          { type: "client.save", id: old?.id, data: clientInput.parse(data) },
          editor,
          close,
        )
      }
    >
      <Field
        name="client-name"
        path="name"
        label="고객사 이름"
        value={data.name}
        change={(name) => setData({ ...data, name })}
        required
      />
      <Field
        name="client-description"
        path="description"
        label="고객사 설명"
        value={data.description}
        change={(description) => setData({ ...data, description })}
        area
      />
    </Frame>
  );
}
function ProjectEditor({ state, editor, close }: Props) {
  const old = state.workspace.projects.find((x) => x.id === editor.id);
  const [data, setData] = useState({
    name: old?.name || "",
    description: old?.description || "",
    kind: old?.kind || "independent",
    timezone: old?.timezone || "Asia/Seoul",
    clientId: old?.clientId || "",
  });
  return (
    <Frame
      title={old ? "프로젝트 수정" : "프로젝트 추가"}
      close={close}
      save={() =>
        persist(
          {
            type: "project.save",
            id: old?.id,
            data: projectInput.parse({
              ...data,
              clientId: data.clientId || null,
            }),
          },
          editor,
          close,
        )
      }
    >
      <Field
        name="project-name"
        path="name"
        label="프로젝트 이름"
        value={data.name}
        change={(name) => setData({ ...data, name })}
        required
      />
      <Field
        name="project-description"
        path="description"
        label="프로젝트 설명"
        value={data.description}
        change={(description) => setData({ ...data, description })}
        area
      />
      <Select
        name="project-client"
        path="clientId"
        label="고객사"
        value={data.clientId}
        change={(clientId) => setData({ ...data, clientId })}
      >
        <option value="">독립 프로젝트</option>
        {state.workspace.clients
          .filter((c) => !c.archivedAt || c.id === data.clientId)
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.archivedAt ? " (보관됨)" : ""}
            </option>
          ))}
      </Select>
      <Field
        name="project-timezone"
        path="timezone"
        label="프로젝트 시간대"
        value={data.timezone}
        change={(timezone) => setData({ ...data, timezone })}
        required
      />
      <Select
        name="project-kind"
        path="kind"
        label="프로젝트 유형"
        value={data.kind}
        change={(kind) => setData({ ...data, kind: kind as typeof data.kind })}
      >
        <option value="coach">Coach</option>
        <option value="survey">Survey</option>
        <option value="independent">기타</option>
      </Select>
      <p className="subtle">
        고객사를 옮겨도 과제·원문과 프로젝트 ID는 그대로 유지됩니다.
      </p>
    </Frame>
  );
}
function SourceEditor({ state, editor, close }: Props) {
  const old = state.sources.find((x) => x.id === editor.id);
  const [data, setData] = useState({
    title: old?.title || "",
    rawText: old?.rawText || "",
    sourceType: old?.sourceType || "manual",
    reference: old?.reference || "",
    collectedAt: old?.collectedAt || new Date().toISOString(),
    requesterRole: old?.requesterRole || "",
    sensitivity: old?.sensitivity || "internal",
  });
  const [collected, setCollected] = useState(localDateTime(data.collectedAt));
  return (
    <Frame
      title={old ? "원문 수정" : "원문 등록"}
      close={close}
      save={() =>
        persist(
          {
            type: "source.save",
            id: old?.id,
            data: sourceInput.parse({
              ...data,
              collectedAt: atField("collectedAt", () =>
                instantFromLocal(collected, data.collectedAt),
              ),
            }),
          },
          editor,
          close,
        )
      }
    >
      <Field
        name="source-title"
        path="title"
        label="원문 제목"
        value={data.title}
        change={(title) => setData({ ...data, title })}
        required
      />
      <Field
        name="source-raw"
        path="rawText"
        label="원문 내용"
        value={data.rawText}
        change={(rawText) => setData({ ...data, rawText })}
        area
        required
      />
      <Select
        name="source-type"
        path="sourceType"
        label="출처 유형"
        value={data.sourceType}
        change={(sourceType) =>
          setData({ ...data, sourceType: sourceType as typeof data.sourceType })
        }
      >
        {["manual", "mail", "slack", "teams", "other"].map((x) => (
          <option key={x} value={x}>
            {sourceTypeNames[x]}
          </option>
        ))}
      </Select>
      <Field
        name="source-reference"
        path="reference"
        label="원문 링크"
        value={data.reference}
        change={(reference) => setData({ ...data, reference })}
      />
      <p className="subtle">링크는 자동으로 열거나 수집하지 않습니다.</p>
      <Field
        name="source-collected"
        path="collectedAt"
        label="수집 일시"
        type="datetime-local"
        value={collected}
        change={setCollected}
        required
      />
      <p className="subtle">
        입력 시간대: {Intl.DateTimeFormat().resolvedOptions().timeZone} (이 기기
        기준)
      </p>
      <Field
        name="source-requester"
        path="requesterRole"
        label="요청자 역할"
        value={data.requesterRole}
        change={(requesterRole) => setData({ ...data, requesterRole })}
      />
      <Select
        name="source-sensitivity"
        path="sensitivity"
        label="민감도"
        value={data.sensitivity}
        change={(sensitivity) =>
          setData({
            ...data,
            sensitivity: sensitivity as typeof data.sensitivity,
          })
        }
      >
        <option value="public">공개</option>
        <option value="internal">내부</option>
        <option value="confidential">기밀</option>
      </Select>
      {old && (
        <p className="subtle">이전 원문과 출처는 수정 이력에 보존됩니다.</p>
      )}
    </Frame>
  );
}
function SourceChoices({
  sources,
  ids,
  change,
}: {
  sources: Source[];
  ids: string[];
  change: (ids: string[]) => void;
}) {
  return (
    <fieldset>
      <legend>연결 원문 (여러 개 선택)</legend>
      {sources.length ? (
        sources.map((s) => (
          <label className="check" key={s.id}>
            <input
              type="checkbox"
              checked={ids.includes(s.id)}
              onChange={(e) =>
                change(
                  e.target.checked
                    ? [...ids, s.id]
                    : ids.filter((id) => id !== s.id),
                )
              }
            />
            {s.title}
            {s.status === "archived" ? " (보관됨)" : ""}
          </label>
        ))
      ) : (
        <p className="subtle">
          먼저 수집함에서 원문을 등록하거나, 원문 없이 과제를 작성할 수
          있습니다.
        </p>
      )}
    </fieldset>
  );
}
function InitiativeEditor({ state, editor, close }: Props) {
  const old = state.initiatives.find((x) => x.id === editor.id),
    source = state.sources.find((x) => x.id === editor.sourceId);
  const [data, setData] = useState({
    projectId:
      old?.projectId ||
      editor.projectId ||
      state.workspace.projects.find((p) => !p.archivedAt)?.id ||
      "",
    title: old?.title || source?.title || "",
    problem: old?.problem || "",
    targetSegment: old?.targetSegment || "",
    expectedChange: old?.expectedChange || "",
    category: old?.category || "improvement",
    priority: old?.priority || "medium",
    assignee: old?.assignee || "",
    contribution: old?.contribution || "",
    decisionReason: old?.decisionReason || "",
    alternative: old?.alternative || "",
    plannedAt: old?.plannedAt || "",
    targetMonth: old?.targetMonth || "",
    status: old?.status || "draft",
  });
  const [sourceIds, setSourceIds] = useState(
    old
      ? state.links
          .filter((l) => l.initiativeId === old.id)
          .map((l) => l.sourceId)
      : source
        ? [source.id]
        : [],
  );
  const [planned, setPlanned] = useState(
    old?.plannedAt ? localDateTime(old.plannedAt) : "",
  );
  const duplicates = state.initiatives.filter(
    (w) =>
      w.id !== old?.id &&
      w.status !== "archived" &&
      w.projectId === data.projectId &&
      w.title.trim().toLocaleLowerCase() ===
        data.title.trim().toLocaleLowerCase(),
  );
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  return (
    <Frame
      title={old ? "과제 수정" : "과제 만들기"}
      close={close}
      save={() => {
        if (duplicates.length && !allowDuplicate)
          throw new FieldError(
            "allowDuplicate",
            "같은 제목의 과제가 있습니다. 중복 여부를 확인해 주세요.",
          );
        return persist(
          {
            type: "initiative.save",
            id: old?.id,
            data: initiativeInput.parse({
              ...data,
              plannedAt: atField("plannedAt", () =>
                instantFromLocal(planned, old?.plannedAt),
              ),
              targetMonth: data.targetMonth || null,
            }),
            sourceIds,
          },
          editor,
          close,
        );
      }}
    >
      <Select
        name="work-project"
        path="projectId"
        label="과제 프로젝트"
        value={data.projectId}
        change={(projectId) => {
          setData({ ...data, projectId });
          setAllowDuplicate(false);
        }}
        disabled={!!old}
      >
        {state.workspace.projects
          .filter((p) => !p.archivedAt || p.id === data.projectId)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </Select>
      <Field
        name="work-title"
        path="title"
        label="과제 제목"
        value={data.title}
        change={(title) => {
          setData({ ...data, title });
          setAllowDuplicate(false);
        }}
        required
      />
      {duplicates.length > 0 && (
        <div className="notice">
          <p>같은 제목의 과제 {duplicates.length}개가 있습니다.</p>
          <Confirm
            path="allowDuplicate"
            checked={allowDuplicate}
            change={setAllowDuplicate}
          >
            서로 다른 과제임을 확인했습니다
          </Confirm>
        </div>
      )}
      <div className="field-grid">
        <Select
          name="work-status"
          path="status"
          label="업무 상태"
          value={data.status}
          change={(status) =>
            setData({ ...data, status: status as typeof data.status })
          }
        >
          {workStatuses.map((x) => (
            <option key={x} value={x}>
              {statusNames[x]}
            </option>
          ))}
        </Select>
        <Select
          name="work-priority"
          path="priority"
          label="우선순위"
          value={data.priority}
          change={(priority) =>
            setData({ ...data, priority: priority as typeof data.priority })
          }
        >
          <option value="high">높음</option>
          <option value="medium">보통</option>
          <option value="low">낮음</option>
        </Select>
        <Select
          name="work-category"
          path="category"
          label="과제 유형"
          value={data.category}
          change={(category) =>
            setData({ ...data, category: category as typeof data.category })
          }
        >
          <option value="improvement">개선</option>
          <option value="fix">오류</option>
          <option value="new">신규</option>
          <option value="other">기타</option>
        </Select>
        <Field
          name="work-assignee"
          path="assignee"
          label="담당"
          value={data.assignee}
          change={(assignee) => setData({ ...data, assignee })}
        />
      </div>
      <Field
        name="work-problem"
        path="problem"
        label="문제"
        value={data.problem}
        change={(problem) => setData({ ...data, problem })}
        area
      />
      <Field
        name="work-target"
        path="targetSegment"
        label="대상 사용자"
        value={data.targetSegment}
        change={(targetSegment) => setData({ ...data, targetSegment })}
      />
      <Field
        name="work-change"
        path="expectedChange"
        label="기대 변화"
        value={data.expectedChange}
        change={(expectedChange) => setData({ ...data, expectedChange })}
        area
      />
      <div className="field-grid">
        <Field
          name="work-planned"
          path="plannedAt"
          label="기획 일시 (선택)"
          type="datetime-local"
          value={planned}
          change={setPlanned}
        />
        <Field
          name="work-month"
          path="targetMonth"
          label="목표 월"
          type="month"
          value={data.targetMonth}
          change={(targetMonth) => setData({ ...data, targetMonth })}
        />
      </div>
      <p className="subtle">
        입력 시간대: {Intl.DateTimeFormat().resolvedOptions().timeZone} · 월별
        조회: 프로젝트 시간대
      </p>
      <Field
        name="work-contribution"
        path="contribution"
        label="개인 기여"
        value={data.contribution}
        change={(contribution) => setData({ ...data, contribution })}
        area
      />
      <Field
        name="work-decision"
        path="decisionReason"
        label="결정 근거"
        value={data.decisionReason}
        change={(decisionReason) => setData({ ...data, decisionReason })}
        area
      />
      <Field
        name="work-alternative"
        path="alternative"
        label="검토한 대안"
        value={data.alternative}
        change={(alternative) => setData({ ...data, alternative })}
        area
      />
      <SourceChoices
        sources={state.sources}
        ids={sourceIds}
        change={setSourceIds}
      />
      <p className="subtle">
        측정 준비 상태는 업무 상태와 별개입니다. 측정 계획은 다음 단계에서
        작성합니다.
      </p>
    </Frame>
  );
}
function LinkEditor({ state, editor, close }: Props) {
  const source = state.sources.find((x) => x.id === editor.id)!;
  const [ids, setIds] = useState<string[]>([]);
  return (
    <Frame
      title="기존 과제에 원문 연결"
      close={close}
      save={() =>
        persist(
          { type: "source.link", id: source.id, initiativeIds: ids },
          editor,
          close,
        )
      }
    >
      <p>{source.title}</p>
      <fieldset>
        <legend>연결할 과제</legend>
        {state.initiatives
          .filter((w) => w.status !== "archived")
          .map((w) => (
            <label className="check" key={w.id}>
              <input
                type="checkbox"
                checked={ids.includes(w.id)}
                onChange={(e) =>
                  setIds(
                    e.target.checked
                      ? [...ids, w.id]
                      : ids.filter((id) => id !== w.id),
                  )
                }
              />
              {state.workspace.projects.find((p) => p.id === w.projectId)?.name}{" "}
              · {w.title}
            </label>
          ))}
      </fieldset>
      <p className="subtle">
        원문을 복사하지 않고 연결만 추가합니다. 기존 연결은 유지합니다.
      </p>
    </Frame>
  );
}
function MergeEditor({ state, editor, close }: Props) {
  const from = state.initiatives.find((x) => x.id === editor.id)!;
  const [intoId, setInto] = useState(""),
    [reason, setReason] = useState(""),
    [approved, setApproved] = useState(false);
  return (
    <Frame
      title="중복 과제 검토·병합"
      close={close}
      save={() => {
        if (!approved)
          throw new FieldError(
            "approved",
            "원본 보존과 연결 변경을 확인해 주세요.",
          );
        return persist(
          { type: "initiative.merge", fromId: from.id, intoId, reason },
          editor,
          close,
        );
      }}
    >
      <p>
        「{from.title}」를 아래 과제에 연결합니다. 원본은 보관하고 원문 연결과
        변경 이력을 유지합니다.
      </p>
      <Select
        name="merge-target"
        path="intoId"
        label="남길 과제"
        value={intoId}
        change={setInto}
      >
        <option value="">선택해 주세요</option>
        {state.initiatives
          .filter(
            (w) =>
              w.id !== from.id &&
              w.projectId === from.projectId &&
              w.status !== "archived",
          )
          .map((w) => (
            <option key={w.id} value={w.id}>
              {w.title}
            </option>
          ))}
      </Select>
      <Field
        name="merge-reason"
        path="reason"
        label="병합 사유"
        value={reason}
        change={setReason}
        area
        required
      />
      <Confirm path="approved" checked={approved} change={setApproved}>
        원본이 보관되고 연결이 추가됨을 확인했습니다
      </Confirm>
    </Frame>
  );
}
function ImportEditor({ state, editor, close }: Props) {
  const [text, setText] = useState(""),
    [error, setError] = useState(""),
    [preview, setPreview] = useState<ReturnType<typeof previewLegacy> | null>(
      null,
    ),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [approved, setApproved] = useState(false);
  function update(value: string) {
    setText(value);
    setPreview(null);
    setMapping({});
    setApproved(false);
    setError("");
  }
  return (
    <Frame
      title="이전 버전 JSON 가져오기"
      close={close}
      save={async () => {
        if (!preview || !approved)
          throw new FieldError(
            preview ? "approved" : "preview",
            "미리보기와 가져오기 승인이 필요합니다.",
          );
        await saveRecords(
          (s) => importLegacy(s, text, mapping, runtime),
          editor.revision,
        );
        close();
      }}
    >
      <p>
        기존 로컬 프로토타입의 배열 형식 JSON만 지원합니다. 미리보기 후
        프로젝트를 직접 연결합니다. 기존 값은 덮어쓰지 않습니다.
      </p>
      <label className="field" htmlFor="import-file">
        JSON 파일
        <input
          id="import-file"
          type="file"
          accept=".json,application/json"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 5_000_000) {
              setError("파일은 5MB 이하여야 합니다.");
              return;
            }
            try {
              update(await file.text());
            } catch {
              setError("파일을 읽지 못했습니다.");
            }
          }}
        />
      </label>
      <Field
        name="import-json"
        label="또는 JSON 붙여넣기"
        value={text}
        change={update}
        area
        hint={error ? "import-error" : undefined}
      />
      <button
        type="button"
        data-path="preview"
        onClick={() => {
          try {
            setPreview(previewLegacy(state, text, session));
            setError("");
          } catch (e) {
            setPreview(null);
            setError(message(e));
          }
        }}
      >
        미리보기
      </button>
      {error && (
        <p id="import-error" role="alert" className="error-box">
          {error}
        </p>
      )}
      {preview && (
        <div className="import-preview">
          <p role="status">
            새 기록 {preview.newRows}개 · 중복 제외 {preview.skippedRows}개
          </p>
          {preview.projects.map((name) => (
            <Select
              key={name}
              name={`mapping-${preview.projects.indexOf(name)}`}
              label={`「${name}」 연결 프로젝트`}
              value={Object.hasOwn(mapping, name) ? mapping[name] : ""}
              change={(value) => setMapping({ ...mapping, [name]: value })}
            >
              <option value="">연결 선택</option>
              <option value="new">같은 이름으로 새 프로젝트</option>
              {state.workspace.projects
                .filter((p) => !p.archivedAt)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          ))}
          <ul>
            {preview.rows.map((row) => (
              <li key={row.originKey}>
                {row.row.project} · {row.row.title || "제목 없음"} · 이전 ID{" "}
                {String(row.row.id)}
              </li>
            ))}
          </ul>
          <p className="subtle">
            기존 KPI·산식·관측값 등 모든 원래 필드는 과제의 ‘이전 버전 원본’에
            보존합니다. 실제 배포·성과로 자동 확정하지 않습니다.
          </p>
          <Confirm path="approved" checked={approved} change={setApproved}>
            미리보기와 프로젝트 연결을 확인했습니다
          </Confirm>
        </div>
      )}
    </Frame>
  );
}
// Last button the user activated (mouse, touch or keyboard). WebKit does not
// focus buttons on click, so document.activeElement alone is not enough.
let lastActivated: HTMLElement | null = null;
if (typeof document !== "undefined")
  document.addEventListener(
    "click",
    (e) => {
      const button =
        e.target instanceof Element ? e.target.closest("button") : null;
      if (button && !button.closest(".editor")) lastActivated = button;
    },
    true,
  );
function opener(): HTMLElement | null {
  const active = document.activeElement;
  if (
    active instanceof HTMLElement &&
    active !== document.body &&
    !active.closest(".editor")
  )
    return active;
  return lastActivated?.isConnected ? lastActivated : null;
}
export function RecordEditor(props: Props) {
  // Captured on first render, before the editor heading takes focus.
  const [origin] = useState(() =>
    typeof document === "undefined" ? null : opener(),
  );
  const closing = useRef(false);
  useEffect(
    () => () => {
      // Only after cancel/save; not when another editor replaces this one.
      if (closing.current && origin?.isConnected)
        origin.focus({ preventScroll: false });
    },
    [origin],
  );
  const close = () => {
    closing.current = true;
    props.close();
  };
  return <EditorBody {...props} close={close} />;
}
function EditorBody(props: Props) {
  switch (props.editor.kind) {
    case "client":
      return <ClientEditor {...props} />;
    case "project":
      return <ProjectEditor {...props} />;
    case "source":
      return <SourceEditor {...props} />;
    case "initiative":
      return <InitiativeEditor {...props} />;
    case "link":
      return <LinkEditor {...props} />;
    case "merge":
      return <MergeEditor {...props} />;
    case "import":
      return <ImportEditor {...props} />;
  }
}
export function SourceDetails({
  source,
  state,
}: {
  source: Source;
  state: RecordsState;
}) {
  return (
    <details>
      <summary>원문·출처·수정 이력</summary>
      <pre>{source.rawText}</pre>
      <p>
        수집: {source.collectedAt} · 요청자 역할:{" "}
        {source.requesterRole || "미지정"} · 출처:{" "}
        {named(sourceTypeNames, source.sourceType)} · 민감도:{" "}
        {named(sensitivityNames, source.sensitivity)}
      </p>
      {source.reference && (
        <a
          className="source-link"
          href={source.reference}
          rel="noopener noreferrer"
          target="_blank"
        >
          원문 링크 열기<span className="visually-hidden"> (새 창)</span>
        </a>
      )}
      <p>
        연결 과제 {state.links.filter((l) => l.sourceId === source.id).length}개
      </p>
      <ul>
        {state.links
          .filter((l) => l.sourceId === source.id)
          .map((l) => {
            const work = state.initiatives.find(
              (w) => w.id === l.initiativeId,
            )!;
            return (
              <li key={l.initiativeId}>
                {
                  state.workspace.projects.find((p) => p.id === work.projectId)
                    ?.name
                }{" "}
                · {work.title}
              </li>
            );
          })}
      </ul>
      {source.revisions.map((r, i) => (
        <details key={i}>
          <summary>
            {i + 1}번째 이전 원문 · {r.editedAt}
          </summary>
          <h4>{r.title}</h4>
          <pre>{r.rawText}</pre>
          <p>
            이전 출처: {r.reference || "없음"} ·{" "}
            {named(sourceTypeNames, r.sourceType)} · 수집: {r.collectedAt}
          </p>
        </details>
      ))}
    </details>
  );
}
export function InitiativeDetails({
  work,
  state,
}: {
  work: Initiative;
  state: RecordsState;
}) {
  const fields = [
    ["문제", work.problem],
    ["대상", work.targetSegment],
    ["기대 변화", work.expectedChange],
    ["유형", named(categoryNames, work.category)],
    ["우선순위", named(priorityNames, work.priority)],
    ["담당", work.assignee],
    ["기여", work.contribution],
    ["결정 근거", work.decisionReason],
    ["대안", work.alternative],
    ["기획 시각", work.plannedAt],
    ["목표 월", work.targetMonth],
  ];
  return (
    <details>
      <summary>과제·원문·변경 이력</summary>
      <dl className="detail-fields">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value || "미정"}</dd>
          </div>
        ))}
      </dl>
      <p>업무 상태와 측정 준비는 별도로 관리합니다</p>
      {work.mergedInto && (
        <p>
          병합 대상:{" "}
          {state.initiatives.find((w) => w.id === work.mergedInto)?.title}
        </p>
      )}
      {state.links
        .filter((l) => l.initiativeId === work.id)
        .map((l) => (
          <SourceDetails
            key={l.sourceId}
            source={state.sources.find((s) => s.id === l.sourceId)!}
            state={state}
          />
        ))}
      {state.legacy
        .filter((row) => row.initiativeId === work.id)
        .map((row) => (
          <details key={row.originKey}>
            <summary>이전 버전 원본 · ID 매핑</summary>
            <p>이전 ID → {work.id}</p>
            <pre>{JSON.stringify(row.original, null, 2)}</pre>
          </details>
        ))}
      <details>
        <summary>변경 이력</summary>
        {state.audit
          .filter((a) => a.entityId === work.id)
          .map((a) => (
            <div key={a.id}>
              <p>
                {a.at} · {named(actionNames, a.action)}
                {a.detail ? ` · ${a.detail}` : ""}
              </p>
              {a.before && <pre>{JSON.stringify(a.before, null, 2)}</pre>}
            </div>
          ))}
      </details>
    </details>
  );
}
