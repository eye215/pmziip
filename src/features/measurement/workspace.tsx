"use client";
import { useEffect, useState } from "react";
import { type RecordsState } from "../records/model";
import { saveRecords, runtime } from "../records/browser-store";
import {
  applyMeasurement,
  latestPlan,
  readiness,
  versionName,
  dataRequestMarkdown,
  type MeasurementCommand,
} from "./model";
import {
  ruleSuggestion,
  saveSuggestion,
  goals,
  goalNames,
  type Goal,
} from "./suggestions";
import {
  MetricForm,
  PlanForm,
  StrategyForm,
  errorMessage,
  type Edit,
} from "./forms";
import "./measurement.css";

const availabilityName = {
  unknown: "미확인",
  missing: "신규 필요",
  available: "확인됨",
};
const readinessName = {
  not_ready: "미준비",
  partial: "준비 일부 누락",
  ready: "준비 확인됨",
  waived: "예외 사유 있음",
};
export function MeasurementWorkspace({
  state,
  projectId,
  month,
  panel,
  workId,
  navigate,
}: {
  state: RecordsState;
  projectId?: string;
  month: string;
  panel: string;
  workId?: string;
  navigate: (values: Record<string, string>) => void;
}) {
  const project =
    state.workspace.projects.find((p) => p.id === projectId) ||
    state.workspace.projects.find((p) => !p.archivedAt);
  const [edit, setEdit] = useState<Edit | null>(null),
    [notice, setNotice] = useState(""),
    [goal, setGoal] = useState<Goal>("report-rate"),
    [copyMonth, setCopyMonth] = useState(month);
  useEffect(() => {
    function guard(event: Event) {
      if (edit && !confirm("측정 초안을 저장하지 않고 이동할까요?"))
        event.preventDefault();
    }
    function accepted() {
      setEdit(null);
    }
    window.addEventListener("pmzip:before-view", guard);
    window.addEventListener("pmzip:view-accepted", accepted);
    return () => {
      window.removeEventListener("pmzip:before-view", guard);
      window.removeEventListener("pmzip:view-accepted", accepted);
    };
  }, [edit]);
  if (!project)
    return (
      <section className="panel">
        <h2>지표·측정 계획</h2>
        <p>먼저 프로젝트를 만들어 주세요.</p>
      </section>
    );
  const works = state.initiatives.filter(
      (w) =>
        w.projectId === project.id && !w.mergedInto && w.status !== "archived",
    ),
    work = works.find((w) => w.id === workId) || works[0];
  const versions = state.measurement.metricVersions.filter((v) =>
    state.measurement.metrics.some(
      (m) => m.id === v.metricId && m.projectId === project.id,
    ),
  );
  const plans = work
    ? state.measurement.plans
        .filter((p) => p.initiativeId === work.id)
        .sort((a, b) => b.version - a.version)
    : [];
  const ready = work ? readiness(state, work.id) : null;
  function open(kind: Edit["kind"], id?: string) {
    if (edit && !confirm("작성 중인 초안을 저장하지 않고 다른 편집을 열까요?"))
      return;
    setNotice("");
    setEdit({ kind, id, initiativeId: work?.id, revision: state.revision });
  }
  async function act(command: MeasurementCommand, confirmation?: string) {
    if (confirmation && !confirm(confirmation)) return;
    try {
      await saveRecords(
        (s) => applyMeasurement(s, command, runtime),
        state.revision,
      );
      setNotice("변경 사항을 저장했습니다.");
    } catch (e) {
      setNotice(errorMessage(e));
    }
  }
  async function suggest() {
    if (!work) return;
    try {
      await saveRecords(
        (s) =>
          saveSuggestion(s, work.id, ruleSuggestion(s, work.id, goal), runtime),
        state.revision,
      );
      setNotice(
        "규칙 기반 미승인 초안을 저장했습니다. 지표 정의와 계획을 각각 검토·승인해 주세요.",
      );
    } catch (e) {
      setNotice(errorMessage(e));
    }
  }
  return (
    <section className="measurement-workspace">
      <div className="panel">
        <h2>지표·측정 계획</h2>
        <p>
          실제 AI·GA 연결 없이 합성 기록으로 계획합니다. 수치·로그 확인은 사용자
          근거가 필요합니다.
        </p>
        <label htmlFor="measurement-project">측정 프로젝트</label>
        <select
          id="measurement-project"
          value={project.id}
          onChange={(e) =>
            navigate({ scope: `project:${e.target.value}`, work: "" })
          }
        >
          {state.workspace.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.archivedAt ? " (보관)" : ""}
            </option>
          ))}
        </select>
        <nav className="measurement-nav" aria-label="측정 메뉴">
          {[
            ["plans", "측정 계획"],
            ["metrics", "지표 사전"],
            ["strategies", "월별 전략"],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-current={panel === id ? "page" : undefined}
              onClick={() => navigate({ panel: id })}
            >
              {label}
            </button>
          ))}
        </nav>
        {project.archivedAt && (
          <p className="notice">
            보관된 프로젝트입니다. 수정 전 프로젝트 화면에서 복원해 주세요.
          </p>
        )}
      </div>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {edit &&
        (edit.kind === "metric" ? (
          <MetricForm
            key={`${edit.kind}:${edit.id || "new"}:${edit.revision}`}
            state={state}
            projectId={project.id}
            month={month}
            edit={edit}
            close={() => setEdit(null)}
          />
        ) : edit.kind === "plan" ? (
          <PlanForm
            key={`${edit.kind}:${edit.id || "new"}:${edit.revision}`}
            state={state}
            projectId={project.id}
            month={month}
            edit={edit}
            close={() => setEdit(null)}
          />
        ) : (
          <StrategyForm
            key={`${edit.kind}:${edit.id || "new"}:${edit.revision}`}
            state={state}
            projectId={project.id}
            month={month}
            edit={edit}
            close={() => setEdit(null)}
          />
        ))}
      {panel === "metrics" && (
        <section className="panel">
          <div className="section-heading">
            <h2>프로젝트 지표 사전</h2>
            <button
              className="primary"
              onClick={() => open("metric")}
              disabled={!!project.archivedAt}
            >
              지표 만들기
            </button>
          </div>
          <p className="scope-note">
            승인한 정의는 변경하지 않습니다. 새 버전이나 모니터링 종료로 이력을
            보존합니다.
          </p>
          {!versions.length && (
            <p className="empty-state">
              아직 지표가 없습니다. 직접 정의하거나 측정 계획에서 규칙 기반
              초안을 만들 수 있습니다.
            </p>
          )}
          {[...versions]
            .sort(
              (a, b) =>
                a.metricId.localeCompare(b.metricId) || b.version - a.version,
            )
            .map((v) => {
              const metric = state.measurement.metrics.find(
                (m) => m.id === v.metricId,
              )!;
              return (
                <article
                  key={v.id}
                  className="measurement-row"
                  aria-label={`${v.definition.name} v${v.version} 지표`}
                >
                  <span className="badge">
                    {v.status === "approved" ? "승인됨" : "미승인 초안"} ·{" "}
                    {metric.monitoring === "active"
                      ? "모니터링"
                      : "모니터링 종료"}
                  </span>
                  <h3>
                    {v.definition.name} · v{v.version}
                  </h3>
                  <p>
                    {["ratio", "average"].includes(v.definition.kind)
                      ? `${v.definition.numerator} / ${v.definition.denominator}`
                      : v.definition.valueField}
                  </p>
                  <p>
                    단위: {v.definition.unit} · 로그:{" "}
                    {availabilityName[v.definition.logAvailability]}
                  </p>
                  <details>
                    <summary>지표 정의·평가 기준</summary>
                    <dl className="measurement-details">
                      {[
                        ["범위", v.definition.scope],
                        ["집계", v.definition.aggregation],
                        ["대상", v.definition.population],
                        ["제외", v.definition.exclusions],
                        ["필드", v.definition.fields.join(", ")],
                        ["차원", v.definition.dimensions.join(", ")],
                        ["로그 근거", v.definition.logEvidence],
                        ["평가 기준", v.definition.rubric],
                        ["재현 조건", v.definition.reproductionConditions],
                        ["승인 시각", v.approvedAt],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd>{value || "미정"}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                  <div className="measurement-actions">
                    {v.status === "draft" ? (
                      <>
                        <button onClick={() => open("metric", v.id)}>
                          초안 수정
                        </button>
                        <button
                          onClick={() =>
                            act(
                              {
                                type: "metric.approve",
                                id: v.id,
                                confirmation: true,
                              },
                              `‘${v.definition.name}’ v${v.version} 정의를 검토하고 승인할까요? 승인 후에는 새 버전으로만 수정합니다. 로그나 실측값 확인을 뜻하지 않습니다.`,
                            )
                          }
                          disabled={!!project.archivedAt}
                        >
                          정의 승인
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => act({ type: "metric.revise", id: v.id })}
                        disabled={!!project.archivedAt}
                      >
                        새 버전 초안
                      </button>
                    )}
                    <button
                      onClick={() =>
                        act({
                          type: "metric.monitoring",
                          id: metric.id,
                          status:
                            metric.monitoring === "active" ? "ended" : "active",
                        })
                      }
                    >
                      {metric.monitoring === "active"
                        ? "모니터링 종료"
                        : "모니터링 재개"}
                    </button>
                  </div>
                </article>
              );
            })}
        </section>
      )}
      {panel === "plans" && (
        <section className="panel">
          <h2>과제별 측정 계획</h2>
          {works.length ? (
            <>
              <div className="measurement-field">
                <label htmlFor="measurement-work">측정할 과제</label>
                <select
                  id="measurement-work"
                  value={work!.id}
                  onChange={(e) => navigate({ work: e.target.value })}
                >
                  {works.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="measurement-suggest">
                <label htmlFor="measurement-goal">초안의 지표 유형</label>
                <select
                  id="measurement-goal"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value as Goal)}
                >
                  {goals.map((g) => (
                    <option key={g} value={g}>
                      {goalNames[g]}
                    </option>
                  ))}
                </select>
                <div className="measurement-actions">
                  <button onClick={suggest} disabled={!!project.archivedAt}>
                    규칙 기반 초안 만들기
                  </button>
                  <button
                    onClick={() => open("plan")}
                    disabled={!!project.archivedAt}
                  >
                    직접 계획 작성
                  </button>
                </div>
                <p className="subtle">
                  실제 AI 호출 없음. 기존 프로젝트 지표를 우선 재사용하며
                  목표·기준값·로그는 미정 상태로 시작합니다.
                </p>
              </div>
              {ready && (
                <div className="measurement-readiness" role="status">
                  <strong>측정 준비: {readinessName[ready.status]}</strong>
                  <ul>
                    {ready.missing.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                  {latestPlan(state, work!.id, true)?.waiverReason && (
                    <p>
                      예외 사유:{" "}
                      {latestPlan(state, work!.id, true)!.waiverReason}
                    </p>
                  )}
                </div>
              )}
              {!plans.length && (
                <p className="empty-state">
                  아직 계획이 없습니다. 초안을 만든 다음 필요 로그·기준값·대상을
                  확인해 주세요.
                </p>
              )}
              {plans.map((plan) => (
                <article
                  key={plan.id}
                  className="measurement-row"
                  aria-label={`측정 계획 v${plan.version}`}
                >
                  <span className="badge">
                    {plan.status === "approved" ? "승인됨" : "미승인 초안"} ·{" "}
                    {plan.origin === "rules"
                      ? "규칙 기반"
                      : plan.origin === "mock"
                        ? "가짜 AI 검증"
                        : "직접 작성"}
                  </span>
                  <h3>측정 계획 v{plan.version}</h3>
                  <p>{plan.hypothesis}</p>
                  <p>
                    대상: {plan.population} · 기준 {plan.baselineDays}일 ·{" "}
                    {plan.observationDays.map((d) => "D+" + d).join(" / ")}
                  </p>
                  <ul className="measurement-kpis">
                    {plan.metrics.map((b) => (
                      <li key={b.metricVersionId}>
                        <strong>{versionName(state, b.metricVersionId)}</strong>
                        <p>
                          역할:{" "}
                          {b.role === "primary"
                            ? "핵심"
                            : b.role === "secondary"
                              ? "보조"
                              : "가드레일"}{" "}
                          · 목표{" "}
                          {b.targetValue === null ? "미정" : b.targetValue} ·
                          기준값{" "}
                          {b.baselineValue === null
                            ? "미확보"
                            : b.baselineValue}{" "}
                          · 로그 {availabilityName[b.logAvailability]}
                        </p>
                      </li>
                    ))}
                  </ul>
                  <details>
                    <summary>근거·가드레일·준비 확인</summary>
                    <p>외부 변수: {plan.confounders || "미정"}</p>
                    <p>가드레일: {plan.guardrails || "미정"}</p>
                    <p>
                      QA: {plan.qa} · {plan.qaEvidence || "근거 미확보"}
                    </p>
                    <p>미확인: {plan.unknowns.join(" / ") || "없음"}</p>
                    <p>
                      원문 ID: {plan.evidenceSourceIds.join(", ") || "없음"}
                    </p>
                    {plan.metrics.map((b) => (
                      <p key={b.metricVersionId}>
                        {versionName(state, b.metricVersionId)} · 기준 근거{" "}
                        {b.baselineEvidence || "미확보"} · 로그 근거{" "}
                        {b.logEvidence || "미확인"} · 담당{" "}
                        {b.dataOwner || "미정"}
                      </p>
                    ))}
                  </details>
                  <div className="measurement-actions">
                    {plan.status === "draft" ? (
                      <>
                        <button onClick={() => open("plan", plan.id)}>
                          계획 초안 수정
                        </button>
                        <button
                          onClick={() =>
                            act(
                              {
                                type: "plan.approve",
                                id: plan.id,
                                confirmation: true,
                              },
                              `측정 계획 v${plan.version}의 대상·지표·목표·기준값을 검토하고 승인할까요? 승인과 측정 준비 완료는 별개입니다.`,
                            )
                          }
                          disabled={!!project.archivedAt}
                        >
                          계획 승인
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() =>
                          act({ type: "plan.revise", id: plan.id })
                        }
                        disabled={!!project.archivedAt}
                      >
                        계획 새 버전
                      </button>
                    )}
                    <button
                      onClick={() => {
                        const url = URL.createObjectURL(
                          new Blob([dataRequestMarkdown(state, plan)], {
                            type: "text/markdown",
                          }),
                        );
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `pmzip-data-request-v${plan.version}.md`;
                        a.click();
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                      }}
                    >
                      데이터 요청서 내려받기
                    </button>
                    <button
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(
                            dataRequestMarkdown(state, plan),
                          );
                          setNotice("데이터 요청서를 복사했습니다.");
                        } catch {
                          setNotice(
                            "복사하지 못했습니다. 데이터 요청서 내려받기를 사용해 주세요.",
                          );
                        }
                      }}
                    >
                      데이터 요청서 복사
                    </button>
                  </div>
                </article>
              ))}
            </>
          ) : (
            <p className="empty-state">
              프로젝트에 활성 과제가 없습니다. 과제 메뉴에서 먼저 작성해 주세요.
            </p>
          )}
        </section>
      )}
      {panel === "strategies" && (
        <section className="panel">
          <div className="section-heading">
            <h2>{month} 월별 전략</h2>
            <button
              className="primary"
              onClick={() => open("strategy")}
              disabled={!!project.archivedAt}
            >
              전략 작성
            </button>
          </div>
          <p className="scope-note">
            고정 지표를 없애지 않고 이번 달 집중 지표와 과제를 연결합니다.
          </p>
          {!state.measurement.strategies.some(
            (x) => x.projectId === project.id && x.month === month,
          ) && (
            <p className="empty-state">
              이 달의 전략이 없습니다. 직접 작성하거나 다른 달의 전략을 복사해
              주세요.
            </p>
          )}
          <label htmlFor="strategy-copy-month">복사할 대상 월</label>
          <input
            id="strategy-copy-month"
            type="month"
            value={copyMonth}
            onChange={(e) => setCopyMonth(e.target.value)}
          />
          {state.measurement.strategies
            .filter((x) => x.projectId === project.id)
            .map((strategy) => (
              <article
                className="measurement-row"
                key={strategy.id}
                aria-label={`${strategy.month} ${strategy.theme} 전략`}
              >
                <span className="badge">{strategy.month}</span>
                <h3>{strategy.theme}</h3>
                <p>{strategy.goal || "목표 미정"}</p>
                <p>
                  과제{" "}
                  {strategy.initiativeIds
                    .map(
                      (id) => state.initiatives.find((w) => w.id === id)?.title,
                    )
                    .join(" / ") || "미정"}
                </p>
                <p>
                  집중 지표{" "}
                  {strategy.metricVersionIds
                    .map((id) => versionName(state, id))
                    .join(" / ") || "미정"}
                </p>
                <div className="measurement-actions">
                  <button onClick={() => open("strategy", strategy.id)}>
                    전략 수정
                  </button>
                  <button
                    onClick={() =>
                      act({
                        type: "strategy.copy",
                        id: strategy.id,
                        month: copyMonth,
                      })
                    }
                    disabled={!!project.archivedAt}
                  >
                    선택 월로 복사
                  </button>
                </div>
              </article>
            ))}
        </section>
      )}
    </section>
  );
}
