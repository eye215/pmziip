"use client";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { z } from "zod";
import type { RecordsState } from "../records/model";
import { saveRecords, runtime } from "../records/browser-store";
import { applyMeasurement, type MeasurementCommand } from "./model";
import {
  metricDefinition,
  planInput,
  strategyInput,
  type Definition,
  type Binding,
} from "./schema";
import { definitionFor, emptyBinding } from "./suggestions";

export type Edit = {
  kind: "metric" | "plan" | "strategy";
  id?: string;
  initiativeId?: string;
  revision: number;
};
export function errorMessage(error: unknown) {
  return error instanceof z.ZodError
    ? error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" / ")
    : error instanceof Error
      ? error.message
      : "저장하지 못했습니다.";
}
export function Field({
  name,
  label,
  value,
  onChange,
  area = false,
  type = "text",
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  area?: boolean;
  type?: string;
}) {
  return (
    <div className="measurement-field">
      <label htmlFor={name}>{label}</label>
      {area ? (
        <textarea
          id={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={name}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
export function Select({
  name,
  label,
  value,
  onChange,
  children,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="measurement-field">
      <label htmlFor={name}>{label}</label>
      <select
        id={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
    </div>
  );
}
function Frame({
  title,
  children,
  save,
  close,
}: {
  title: string;
  children: ReactNode;
  save: () => Promise<void>;
  close: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await save();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="panel measurement-editor"
      aria-labelledby="measure-editor-title"
    >
      <h2 ref={heading} id="measure-editor-title" tabIndex={-1}>
        {title}
      </h2>
      <p className="subtle">
        합성 모드 · 미정 값은 빈칸으로 유지하세요. 승인된 원본은 변경하지
        않습니다.
      </p>
      <form
        onSubmit={submit}
        aria-describedby={error ? "measure-error" : undefined}
      >
        <fieldset disabled={busy} className="measurement-fields">
          {children}
        </fieldset>
        {error && (
          <p id="measure-error" className="error-box" role="alert">
            {error}
          </p>
        )}
        <div className="measurement-actions">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "저장 중…" : "초안 저장"}
          </button>
          <button type="button" onClick={close} disabled={busy}>
            취소
          </button>
        </div>
      </form>
    </section>
  );
}
type Props = {
  state: RecordsState;
  projectId: string;
  month: string;
  edit: Edit;
  close: () => void;
};
async function persist(
  command: MeasurementCommand,
  edit: Edit,
  close: () => void,
) {
  await saveRecords(
    (s) => applyMeasurement(s, command, runtime),
    edit.revision,
  );
  close();
}
export function MetricForm({ state, projectId, edit, close }: Props) {
  const old = state.measurement.metricVersions.find((v) => v.id === edit.id);
  const [data, setData] = useState<Definition>(
    old?.definition || {
      ...definitionFor("task-success"),
      name: "",
      templateKey: "",
    },
  );
  const [fields, setFields] = useState(data.fields.join("\n")),
    [dimensions, setDimensions] = useState(data.dimensions.join("\n"));
  const field = (
    key:
      | "name"
      | "unit"
      | "numerator"
      | "denominator"
      | "valueField"
      | "population"
      | "exclusions"
      | "logEvidence"
      | "rubric"
      | "reproductionConditions",
    label: string,
    area = false,
  ) => (
    <Field
      name={`metric-${key}`}
      label={label}
      value={data[key]}
      area={area}
      onChange={(value) => setData({ ...data, [key]: value })}
    />
  );
  return (
    <Frame
      title={old ? `지표 v${old.version} 초안 수정` : "지표 정의 만들기"}
      close={close}
      save={() =>
        persist(
          {
            type: "metric.save",
            id: old?.id,
            projectId,
            definition: metricDefinition.parse({
              ...data,
              fields: fields.split("\n").filter(Boolean),
              dimensions: dimensions.split("\n").filter(Boolean),
            }),
          },
          edit,
          close,
        )
      }
    >
      {field("name", "지표 이름")}
      <div className="measurement-grid">
        <Select
          name="metric-scope"
          label="지표 범위"
          value={data.scope}
          onChange={(scope) =>
            setData({ ...data, scope: scope as Definition["scope"] })
          }
        >
          <option value="service">서비스 고정</option>
          <option value="focus">월별 집중</option>
          <option value="initiative">과제별</option>
          <option value="ai_quality">AI 품질</option>
          <option value="education">교육 효과</option>
        </Select>
        <Select
          name="metric-kind"
          label="산식 유형"
          value={data.kind}
          onChange={(kind) =>
            setData({
              ...data,
              kind: kind as Definition["kind"],
              aggregation:
                kind === "unique_users"
                  ? "period_unique"
                  : ["ratio", "average"].includes(kind)
                    ? "weighted"
                    : "additive",
            })
          }
        >
          <option value="ratio">비율</option>
          <option value="count">개수</option>
          <option value="sum">합계</option>
          <option value="average">평균</option>
          <option value="unique_users">기간 순사용자</option>
        </Select>
        {field("unit", "단위")}
        <Select
          name="metric-direction"
          label="좋아지는 방향"
          value={data.direction}
          onChange={(direction) =>
            setData({
              ...data,
              direction: direction as Definition["direction"],
            })
          }
        >
          <option value="higher">높을수록 좋음</option>
          <option value="lower">낮을수록 좋음</option>
          <option value="neutral">중립·별도 해석</option>
        </Select>
      </div>
      {["ratio", "average"].includes(data.kind) ? (
        <div className="measurement-grid">
          {field("numerator", "분자 정의")}
          {field("denominator", "분모 정의")}
        </div>
      ) : (
        field("valueField", "값 필드·기간 조회 정의")
      )}
      <p className="subtle">
        집계:{" "}
        {data.aggregation === "weighted"
          ? "분자·분모 기반 가중 집계"
          : data.aggregation === "period_unique"
            ? "기간별 별도 조회 · 일별/국가별 UU 합산 금지"
            : "합산 가능한 값만 집계"}
        . 계산 실행은 데이터 등록 단계에서 제공합니다.
      </p>
      {field("population", "대상·모집단", true)}
      {field("exclusions", "제외 조건", true)}
      <div className="measurement-grid">
        <Field
          name="metric-fields"
          label="필요 필드 (한 줄에 하나)"
          value={fields}
          onChange={setFields}
          area
        />
        <Field
          name="metric-dimensions"
          label="비교 차원 (한 줄에 하나)"
          value={dimensions}
          onChange={setDimensions}
          area
        />
      </div>
      <Select
        name="metric-availability"
        label="로그 존재 여부"
        value={data.logAvailability}
        onChange={(logAvailability) =>
          setData({
            ...data,
            logAvailability: logAvailability as Definition["logAvailability"],
          })
        }
      >
        <option value="unknown">미확인</option>
        <option value="missing">신규 필요</option>
        <option value="available">확인됨</option>
      </Select>
      {field("logEvidence", "로그 확인 근거", true)}
      {field("rubric", "평가 기준·척도·전문가 참고 근거", true)}
      {field("reproductionConditions", "재현 조건·언어·모델 버전", true)}
    </Frame>
  );
}
function numberOrNull(value: string) {
  if (value === "") return null;
  if (!/^-?\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value)))
    throw new Error(
      "숫자 또는 빈칸으로 입력해 주세요. 미정 값을 0으로 바꾸지 않습니다.",
    );
  return Number(value);
}
type FormBinding = Binding & { targetText: string; baselineText: string };
const formBinding = (b: Binding): FormBinding => ({
  ...b,
  targetText: b.targetValue === null ? "" : String(b.targetValue),
  baselineText: b.baselineValue === null ? "" : String(b.baselineValue),
});
export function PlanForm({ state, projectId, edit, close }: Props) {
  const old = state.measurement.plans.find((p) => p.id === edit.id),
    work = state.initiatives.find(
      (w) => w.id === (old?.initiativeId || edit.initiativeId),
    )!;
  const [hypothesis, setHypothesis] = useState(old?.hypothesis || ""),
    [population, setPopulation] = useState(
      old?.population || work.targetSegment,
    ),
    [baselineDays, setBaselineDays] = useState(String(old?.baselineDays || 28)),
    [days, setDays] = useState<number[]>(old?.observationDays || [7, 14, 30]);
  const [bindings, setBindings] = useState<FormBinding[]>(
      (old?.metrics || []).map(formBinding),
    ),
    [confounders, setConfounders] = useState(old?.confounders || ""),
    [guardrails, setGuardrails] = useState(old?.guardrails || ""),
    [qa, setQa] = useState(old?.qa || "unknown"),
    [qaEvidence, setQaEvidence] = useState(old?.qaEvidence || ""),
    [waiver, setWaiver] = useState(old?.waiverReason || "");
  const [unknowns, setUnknowns] = useState((old?.unknowns || []).join("\n"));
  const versions = state.measurement.metricVersions.filter((v) =>
    state.measurement.metrics.some(
      (m) => m.id === v.metricId && m.projectId === projectId,
    ),
  );
  function patch(index: number, key: keyof FormBinding, value: string) {
    setBindings(
      bindings.map((b, i) => (i === index ? { ...b, [key]: value } : b)),
    );
  }
  return (
    <Frame
      title={old ? `측정 계획 v${old.version} 초안 수정` : "측정 계획 작성"}
      close={close}
      save={() =>
        persist(
          {
            type: "plan.save",
            id: old?.id,
            initiativeId: work.id,
            data: planInput.parse({
              hypothesis,
              population,
              baselineDays: Number(baselineDays),
              observationDays: days,
              metrics: bindings.map(({ targetText, baselineText, ...b }) => ({
                ...b,
                targetValue: numberOrNull(targetText),
                baselineValue: numberOrNull(baselineText),
              })),
              confounders,
              guardrails,
              evidenceSourceIds:
                old?.evidenceSourceIds ||
                state.links
                  .filter((l) => l.initiativeId === work.id)
                  .map((l) => l.sourceId),
              unknowns: unknowns.split("\n").filter(Boolean),
              qa,
              qaEvidence,
              waiverReason: waiver,
            }),
          },
          edit,
          close,
        )
      }
    >
      <p>{work.title}</p>
      <Field
        name="plan-hypothesis"
        label="검증할 가설"
        value={hypothesis}
        onChange={setHypothesis}
        area
      />
      <Field
        name="plan-population"
        label="분석 대상"
        value={population}
        onChange={setPopulation}
        area
      />
      <Field
        name="plan-baseline-days"
        label="배포 전 기준 기간 (일)"
        value={baselineDays}
        onChange={setBaselineDays}
      />
      <fieldset>
        <legend>관측 일정</legend>
        {[1, 7, 14, 30, 90].map((d) => (
          <label className="measurement-check" key={d}>
            <input
              type="checkbox"
              checked={days.includes(d)}
              onChange={(e) =>
                setDays(
                  e.target.checked
                    ? [...days, d].sort((a, b) => a - b)
                    : days.filter((x) => x !== d),
                )
              }
            />
            D+{d}
          </label>
        ))}
      </fieldset>
      <p className="subtle">
        D0는 실제 PROD 노출일이며 비교 기준에서 제외합니다. 실제 시각과 일정
        생성은 배포 단계에서 연결합니다.
      </p>
      <fieldset>
        <legend>KPI 선택 · 복수 선택 가능</legend>
        {versions.length ? (
          versions.map((v) => (
            <label className="measurement-check" key={v.id}>
              <input
                type="checkbox"
                checked={bindings.some((b) => b.metricVersionId === v.id)}
                onChange={(e) =>
                  setBindings(
                    e.target.checked
                      ? [
                          ...bindings,
                          formBinding(
                            emptyBinding(
                              v.id,
                              bindings.length ? "secondary" : "primary",
                            ),
                          ),
                        ]
                      : bindings.filter((b) => b.metricVersionId !== v.id),
                  )
                }
              />
              {v.definition.name} · v{v.version} ·{" "}
              {v.status === "approved" ? "승인" : "미승인"}
            </label>
          ))
        ) : (
          <p>지표 사전에서 지표를 만들거나 규칙 기반 추천으로 시작해 주세요.</p>
        )}
      </fieldset>
      {bindings.map((b, i) => {
        const v = versions.find((v) => v.id === b.metricVersionId)!;
        return (
          <fieldset key={b.metricVersionId} className="binding">
            <legend>
              {v.definition.name} · v{v.version}
            </legend>
            <Select
              name={`binding-${i}-role`}
              label={`KPI ${i + 1} 역할`}
              value={b.role}
              onChange={(value) => patch(i, "role", value)}
            >
              <option value="primary">핵심</option>
              <option value="secondary">보조</option>
              <option value="guardrail">가드레일</option>
            </Select>
            <Field
              name={`binding-${i}-target`}
              label={`KPI ${i + 1} 목표값 (미정이면 빈칸)`}
              value={b.targetText}
              onChange={(value) => patch(i, "targetText", value)}
            />
            <Select
              name={`binding-${i}-baseline-status`}
              label={`KPI ${i + 1} 기준값 상태`}
              value={b.baselineStatus}
              onChange={(value) => patch(i, "baselineStatus", value)}
            >
              <option value="missing">미확보</option>
              <option value="available">확보함</option>
              <option value="not_applicable">해당 없음 (사유 필요)</option>
            </Select>
            <Field
              name={`binding-${i}-baseline`}
              label={`KPI ${i + 1} 기준값`}
              value={b.baselineText}
              onChange={(value) => patch(i, "baselineText", value)}
            />
            <Field
              name={`binding-${i}-baseline-evidence`}
              label={`KPI ${i + 1} 기준값 근거·해당 없음 사유`}
              value={b.baselineEvidence}
              onChange={(value) => patch(i, "baselineEvidence", value)}
              area
            />
            <Select
              name={`binding-${i}-availability`}
              label={`KPI ${i + 1} 로그 확인`}
              value={b.logAvailability}
              onChange={(value) => patch(i, "logAvailability", value)}
            >
              <option value="unknown">미확인</option>
              <option value="missing">신규 필요</option>
              <option value="available">확인됨</option>
            </Select>
            <Field
              name={`binding-${i}-log-evidence`}
              label={`KPI ${i + 1} 로그 근거`}
              value={b.logEvidence}
              onChange={(value) => patch(i, "logEvidence", value)}
              area
            />
            <div className="measurement-grid">
              <Field
                name={`binding-${i}-owner`}
                label={`KPI ${i + 1} 데이터 담당`}
                value={b.dataOwner}
                onChange={(value) => patch(i, "dataOwner", value)}
              />
              <Field
                name={`binding-${i}-grain`}
                label={`KPI ${i + 1} 집계 단위`}
                value={b.grain}
                onChange={(value) => patch(i, "grain", value)}
              />
            </div>
            <Field
              name={`binding-${i}-format`}
              label={`KPI ${i + 1} 요청 데이터 형식`}
              value={b.requestFormat}
              onChange={(value) => patch(i, "requestFormat", value)}
            />
            <Field
              name={`binding-${i}-filters`}
              label={`KPI ${i + 1} 수집 필터·조건`}
              value={b.filters}
              onChange={(value) => patch(i, "filters", value)}
              area
            />
          </fieldset>
        );
      })}
      <Field
        name="plan-confounders"
        label="교란 요인·외부 변수"
        value={confounders}
        onChange={setConfounders}
        area
      />
      <Field
        name="plan-guardrails"
        label="가드레일·불리한 변화 확인"
        value={guardrails}
        onChange={setGuardrails}
        area
      />
      <Field
        name="plan-unknowns"
        label="미확인 사항 (한 줄에 하나)"
        value={unknowns}
        onChange={setUnknowns}
        area
      />
      <Select
        name="plan-qa"
        label="측정 QA"
        value={qa}
        onChange={(value) => setQa(value as typeof qa)}
      >
        <option value="unknown">미확인</option>
        <option value="passed">확인 완료</option>
        <option value="failed">실패·보완 필요</option>
      </Select>
      <Field
        name="plan-qa-evidence"
        label="QA 확인 근거"
        value={qaEvidence}
        onChange={setQaEvidence}
        area
      />
      <Field
        name="plan-waiver"
        label="준비 미완료 예외 사유 (선택)"
        value={waiver}
        onChange={setWaiver}
        area
      />
      <p className="subtle">
        예외는 누락을 없애지 않습니다. 승인 후에도 준비 상태와 누락 항목을 함께
        표시합니다.
      </p>
    </Frame>
  );
}
export function StrategyForm({ state, projectId, month, edit, close }: Props) {
  const old = state.measurement.strategies.find((x) => x.id === edit.id);
  const [data, setData] = useState(
    old
      ? {
          projectId: old.projectId,
          month: old.month,
          theme: old.theme,
          goal: old.goal,
          initiativeIds: old.initiativeIds,
          metricVersionIds: old.metricVersionIds,
        }
      : {
          projectId,
          month,
          theme: "",
          goal: "",
          initiativeIds: [] as string[],
          metricVersionIds: [] as string[],
        },
  );
  return (
    <Frame
      title="월별 전략 작성"
      close={close}
      save={() =>
        persist(
          {
            type: "strategy.save",
            id: old?.id,
            data: strategyInput.parse(data),
          },
          edit,
          close,
        )
      }
    >
      <Field
        name="strategy-month"
        label="전략 월"
        type="month"
        value={data.month}
        onChange={(month) => setData({ ...data, month })}
      />
      <Field
        name="strategy-theme"
        label="핵심 테마"
        value={data.theme}
        onChange={(theme) => setData({ ...data, theme })}
      />
      <Field
        name="strategy-goal"
        label="월별 목표 (사용자 결정)"
        value={data.goal}
        onChange={(goal) => setData({ ...data, goal })}
        area
      />
      <fieldset>
        <legend>연결 과제</legend>
        {state.initiatives
          .filter((w) => w.projectId === projectId)
          .map((w) => (
            <label className="measurement-check" key={w.id}>
              <input
                type="checkbox"
                checked={data.initiativeIds.includes(w.id)}
                onChange={(e) =>
                  setData({
                    ...data,
                    initiativeIds: e.target.checked
                      ? [...data.initiativeIds, w.id]
                      : data.initiativeIds.filter((id) => id !== w.id),
                  })
                }
              />
              {w.title}
            </label>
          ))}
      </fieldset>
      <fieldset>
        <legend>집중 지표 (기존 승인 버전)</legend>
        {state.measurement.metricVersions
          .filter(
            (v) =>
              v.status === "approved" &&
              state.measurement.metrics.some(
                (m) => m.id === v.metricId && m.projectId === projectId,
              ),
          )
          .map((v) => (
            <label className="measurement-check" key={v.id}>
              <input
                type="checkbox"
                checked={data.metricVersionIds.includes(v.id)}
                onChange={(e) =>
                  setData({
                    ...data,
                    metricVersionIds: e.target.checked
                      ? [...data.metricVersionIds, v.id]
                      : data.metricVersionIds.filter((id) => id !== v.id),
                  })
                }
              />
              {v.definition.name} · v{v.version}
            </label>
          ))}
      </fieldset>
    </Frame>
  );
}
