import { z } from "zod";
import {
  authorize,
  stateSchema,
  recordAudit,
  type RecordsState,
  type Runtime,
} from "../records/model";
import {
  metricDefinition,
  planInput,
  strategyInput,
  type Definition,
  type Plan,
} from "./schema";

const id = z.uuid(),
  required = z
    .string()
    .max(2000)
    .refine((v) => !!v.trim(), "입력값을 확인해 주세요.");
const commands = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("metric.save"),
    id: id.optional(),
    projectId: id,
    definition: metricDefinition,
  }),
  z.object({ type: z.literal("metric.revise"), id }),
  z.object({
    type: z.literal("metric.approve"),
    id,
    confirmation: z.literal(true),
  }),
  z.object({
    type: z.literal("metric.monitoring"),
    id,
    status: z.enum(["active", "ended"]),
  }),
  z.object({
    type: z.literal("plan.save"),
    id: id.optional(),
    initiativeId: id,
    data: planInput,
  }),
  z.object({ type: z.literal("plan.revise"), id }),
  z.object({
    type: z.literal("plan.approve"),
    id,
    confirmation: z.literal(true),
  }),
  z.object({
    type: z.literal("strategy.save"),
    id: id.optional(),
    data: strategyInput,
  }),
  z.object({
    type: z.literal("strategy.copy"),
    id,
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  }),
]);
export type MeasurementCommand = z.input<typeof commands>;
function need<T>(value: T | undefined): T {
  if (!value) throw new Error("측정 기록을 찾을 수 없습니다.");
  return value;
}
export function latestPlan(
  s: RecordsState,
  initiativeId: string,
  approvedOnly = false,
) {
  return s.measurement.plans
    .filter(
      (p) =>
        p.initiativeId === initiativeId &&
        (!approvedOnly || p.status === "approved"),
    )
    .sort((a, b) => b.version - a.version)[0];
}
export function readiness(s: RecordsState, initiativeId: string) {
  const plan = latestPlan(s, initiativeId, true),
    missing: string[] = [];
  if (!plan)
    return {
      status: "not_ready" as const,
      missing: ["승인된 측정 계획이 없습니다."],
    };
  for (const b of plan.metrics) {
    const name =
      s.measurement.metricVersions.find((v) => v.id === b.metricVersionId)
        ?.definition.name || "지표";
    if (b.baselineStatus === "missing") missing.push(`${name}: 기준값 미확보`);
    if (b.logAvailability !== "available")
      missing.push(
        `${name}: 로그 ${b.logAvailability === "unknown" ? "미확인" : "신규 필요"}`,
      );
    if (!b.dataOwner.trim()) missing.push(`${name}: 데이터 담당 미정`);
  }
  for (const unknown of plan.unknowns) missing.push("미확인: " + unknown);
  if (plan.qa !== "passed")
    missing.push(plan.qa === "unknown" ? "QA 미확인" : "QA 실패");
  if (plan.waiverReason.trim()) return { status: "waived" as const, missing };
  return {
    status: missing.length ? ("partial" as const) : ("ready" as const),
    missing,
  };
}
export function applyMeasurement(
  input: RecordsState,
  raw: MeasurementCommand,
  r: Runtime,
): RecordsState {
  authorize(input, r.session);
  const c = commands.parse(raw),
    s = structuredClone(stateSchema.parse(input)),
    m = s.measurement,
    now = r.now();
  let before: unknown = null,
    entityId = "";
  const activeProject = (projectId: string) => {
    const project = need(s.workspace.projects.find((p) => p.id === projectId));
    if (project.archivedAt)
      throw new Error("프로젝트를 복원한 후 측정 기록을 수정해 주세요.");
  };

  if (c.type === "metric.save") {
    const project = need(
      s.workspace.projects.find((p) => p.id === c.projectId),
    );
    if (project.archivedAt)
      throw new Error("프로젝트를 복원한 후 수정해 주세요.");
    if (c.id) {
      const v = need(m.metricVersions.find((v) => v.id === c.id)),
        metric = need(m.metrics.find((x) => x.id === v.metricId));
      if (metric.projectId !== c.projectId || v.status !== "draft")
        throw new Error(
          "승인 버전은 수정하지 않습니다. 새 버전을 만들어 주세요.",
        );
      before = structuredClone(v);
      v.definition = c.definition;
      entityId = v.id;
    } else {
      const metricId = r.id();
      m.metrics.push({
        id: metricId,
        projectId: c.projectId,
        monitoring: "active",
        createdAt: now,
      });
      entityId = r.id();
      m.metricVersions.push({
        id: entityId,
        metricId,
        version: 1,
        status: "draft",
        definition: c.definition,
        createdAt: now,
        approvedAt: null,
      });
    }
  } else if (c.type === "metric.revise") {
    const old = need(m.metricVersions.find((v) => v.id === c.id));
    activeProject(
      need(m.metrics.find((metric) => metric.id === old.metricId)).projectId,
    );
    if (old.status !== "approved")
      throw new Error("초안은 기존 편집 기능을 사용해 주세요.");
    if (
      m.metricVersions.some(
        (v) => v.metricId === old.metricId && v.status === "draft",
      )
    )
      throw new Error("작성 중인 지표 버전이 있습니다.");
    entityId = r.id();
    m.metricVersions.push({
      ...structuredClone(old),
      id: entityId,
      version:
        Math.max(
          ...m.metricVersions
            .filter((v) => v.metricId === old.metricId)
            .map((v) => v.version),
        ) + 1,
      status: "draft",
      createdAt: now,
      approvedAt: null,
    });
  } else if (c.type === "metric.approve") {
    const v = need(m.metricVersions.find((v) => v.id === c.id));
    activeProject(
      need(m.metrics.find((metric) => metric.id === v.metricId)).projectId,
    );
    if (v.status === "approved") return input;
    before = structuredClone(v);
    v.status = "approved";
    v.approvedAt = now;
    entityId = v.id;
  } else if (c.type === "metric.monitoring") {
    const metric = need(m.metrics.find((x) => x.id === c.id));
    before = structuredClone(metric);
    metric.monitoring = c.status;
    entityId = metric.id;
  } else if (c.type === "plan.save") {
    const work = need(s.initiatives.find((w) => w.id === c.initiativeId));
    if (
      work.status === "archived" ||
      s.workspace.projects.find((p) => p.id === work.projectId)?.archivedAt
    )
      throw new Error("과제와 프로젝트를 복원한 후 작성해 주세요.");
    if (c.id) {
      const plan = need(m.plans.find((p) => p.id === c.id));
      if (plan.initiativeId !== work.id || plan.status !== "draft")
        throw new Error("승인 계획은 새 버전으로 수정해 주세요.");
      before = structuredClone(plan);
      Object.assign(plan, c.data);
      entityId = plan.id;
    } else {
      if (
        m.plans.some((p) => p.initiativeId === work.id && p.status === "draft")
      )
        throw new Error("작성 중인 계획 초안이 있습니다.");
      entityId = r.id();
      m.plans.push({
        ...c.data,
        id: entityId,
        projectId: work.projectId,
        initiativeId: work.id,
        version:
          Math.max(
            0,
            ...m.plans
              .filter((p) => p.initiativeId === work.id)
              .map((p) => p.version),
          ) + 1,
        status: "draft",
        supersedesId: latestPlan(s, work.id, true)?.id || null,
        createdAt: now,
        approvedAt: null,
        origin: "manual",
        originReason: "사용자 작성",
      });
    }
  } else if (c.type === "plan.revise") {
    const old = need(m.plans.find((p) => p.id === c.id));
    activeProject(old.projectId);
    if (old.status !== "approved")
      throw new Error("초안은 기존 편집 기능을 사용해 주세요.");
    if (
      m.plans.some(
        (p) => p.initiativeId === old.initiativeId && p.status === "draft",
      )
    )
      throw new Error("작성 중인 계획 초안이 있습니다.");
    entityId = r.id();
    m.plans.push({
      ...structuredClone(old),
      id: entityId,
      version:
        Math.max(
          ...m.plans
            .filter((p) => p.initiativeId === old.initiativeId)
            .map((p) => p.version),
        ) + 1,
      status: "draft",
      supersedesId: old.id,
      createdAt: now,
      approvedAt: null,
    });
  } else if (c.type === "plan.approve") {
    const plan = need(m.plans.find((p) => p.id === c.id));
    activeProject(plan.projectId);
    if (plan.status === "approved") return input;
    for (const binding of plan.metrics) {
      const version = need(
        m.metricVersions.find((v) => v.id === binding.metricVersionId),
      );
      if (
        version.status !== "approved" ||
        m.metrics.find((metric) => metric.id === version.metricId)
          ?.monitoring !== "active"
      )
        throw new Error(
          "연결 지표를 먼저 승인하고 모니터링 상태를 확인해 주세요.",
        );
    }
    before = structuredClone(plan);
    plan.status = "approved";
    plan.approvedAt = now;
    entityId = plan.id;
  } else if (c.type === "strategy.save") {
    if (s.workspace.projects.find((p) => p.id === c.data.projectId)?.archivedAt)
      throw new Error("프로젝트를 복원한 후 작성해 주세요.");
    const old = c.id
      ? need(m.strategies.find((x) => x.id === c.id))
      : undefined;
    if (old && old.projectId !== c.data.projectId)
      throw new Error("전략의 프로젝트는 변경할 수 없습니다.");
    if (old) {
      before = structuredClone(old);
      Object.assign(old, c.data, { updatedAt: now });
      entityId = old.id;
    } else {
      entityId = r.id();
      m.strategies.push({
        ...c.data,
        id: entityId,
        createdAt: now,
        updatedAt: now,
      });
    }
  } else if (c.type === "strategy.copy") {
    const old = need(m.strategies.find((x) => x.id === c.id));
    activeProject(old.projectId);
    if (old.month === c.month) throw new Error("다른 월을 선택해 주세요.");
    entityId = r.id();
    m.strategies.push({
      ...structuredClone(old),
      id: entityId,
      month: c.month,
      createdAt: now,
      updatedAt: now,
    });
  }
  recordAudit(s, r, c.type, entityId, before);
  s.revision++;
  return stateSchema.parse(s);
}
export function versionName(s: RecordsState, id: string) {
  const v = s.measurement.metricVersions.find((v) => v.id === id);
  return v ? `${v.definition.name} · v${v.version}` : "지표 없음";
}
const escapeMd = (s: string) => s.replace(/[\\`*_[\]<>|]/g, "\\$&");
export function dataRequestMarkdown(s: RecordsState, plan: Plan): string {
  const work = need(s.initiatives.find((w) => w.id === plan.initiativeId)),
    project = need(s.workspace.projects.find((p) => p.id === plan.projectId));
  const lines = [
    `# 데이터 요청서 — ${escapeMd(work.title)}`,
    `프로젝트: ${escapeMd(project.name)} · 계획 v${plan.version} · ${plan.status === "approved" ? "승인됨" : "미승인 초안"}`,
    `가설: ${escapeMd(plan.hypothesis)}`,
    `대상: ${escapeMd(plan.population)}`,
    `기준: 실제 PROD 노출일 D0 직전 ${plan.baselineDays}일, D0 제외. 노출 시각 미확정.`,
    `관측: ${plan.observationDays.map((d) => "D+" + d).join(", ")}`,
    `교란 요인: ${escapeMd(plan.confounders || "미검토")}`,
    `가드레일: ${escapeMd(plan.guardrails || "미정")}`,
  ];
  for (const b of plan.metrics) {
    const v = need(
        s.measurement.metricVersions.find((v) => v.id === b.metricVersionId),
      ),
      d = v.definition;
    lines.push(
      `\n## ${escapeMd(versionName(s, v.id))}`,
      `역할: ${b.role} · 단위: ${escapeMd(d.unit)} · 방향: ${d.direction}`,
      `산식: ${escapeMd(d.kind === "ratio" || d.kind === "average" ? d.numerator + " / " + d.denominator : d.valueField)}`,
      `필드: ${d.fields.map(escapeMd).join(", ")}`,
      `차원: ${d.dimensions.map(escapeMd).join(", ") || "미정"}`,
      `집계 단위: ${escapeMd(b.grain)} · 방식: ${d.aggregation}`,
      `필터: ${escapeMd(b.filters || "미정")}`,
      `요청 형식: ${escapeMd(b.requestFormat || "담당자와 협의 필요")}`,
      `제외: ${escapeMd(d.exclusions || "미정")}`,
      `로그: ${b.logAvailability} · 근거: ${escapeMd(b.logEvidence || "미확인")}`,
      `담당: ${escapeMd(b.dataOwner || "미정")}`,
      `기준값: ${b.baselineValue === null ? "미확보" : b.baselineValue} · ${escapeMd(b.baselineEvidence || "근거 미확보")}`,
      `목표: ${b.targetValue === null ? "미정" : b.targetValue}`,
    );
  }
  lines.push(
    `\n원문 근거 ID: ${plan.evidenceSourceIds.join(", ") || "없음"}`,
    "로그 존재 여부·목표 수치는 근거와 사용자 확인 전 확정하지 않습니다.",
  );
  return lines.join("\n\n");
}
export const defineMetric = (value: Definition) =>
  metricDefinition.parse(value);
export const approvalReason = required;
