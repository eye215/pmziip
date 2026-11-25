import { z } from "zod";

const id = z.uuid(),
  instant = z.iso.datetime({ offset: true }),
  text = z.string().max(10000);
const required = (max = 1000) =>
  z
    .string()
    .max(max)
    .refine((v) => v.trim().length > 0, "내용을 입력해 주세요.");
export const availability = z.enum(["unknown", "missing", "available"]);
export const metricDefinition = z
  .object({
    name: required(160),
    templateKey: z.string().max(80),
    scope: z.enum([
      "service",
      "focus",
      "initiative",
      "ai_quality",
      "education",
    ]),
    kind: z.enum(["ratio", "count", "sum", "average", "unique_users"]),
    unit: required(40),
    direction: z.enum(["higher", "lower", "neutral"]),
    numerator: text,
    denominator: text,
    valueField: text,
    aggregation: z.enum(["additive", "weighted", "period_unique"]),
    population: required(2000),
    exclusions: text,
    fields: z.array(required(200)).min(1).max(40),
    dimensions: z.array(required(200)).max(20),
    logAvailability: availability,
    logEvidence: text,
    rubric: text,
    reproductionConditions: text,
  })
  .strict()
  .superRefine((m, ctx) => {
    if (
      ["ratio", "average"].includes(m.kind) &&
      (!m.numerator.trim() ||
        !m.denominator.trim() ||
        m.aggregation !== "weighted")
    )
      ctx.addIssue({
        code: "custom",
        message: "비율·평균에는 분자/분모와 가중 집계가 필요합니다.",
      });
    if (m.kind === "unique_users" && m.aggregation !== "period_unique")
      ctx.addIssue({
        code: "custom",
        message: "순사용자는 해당 기간을 별도 조회해야 합니다.",
      });
    if (
      ["count", "sum"].includes(m.kind) &&
      (!m.valueField.trim() || m.aggregation !== "additive")
    )
      ctx.addIssue({
        code: "custom",
        message: "개수·합계의 값 필드와 집계 방식을 확인해 주세요.",
      });
    if (m.logAvailability === "available" && !m.logEvidence.trim())
      ctx.addIssue({ code: "custom", message: "로그 확인 근거가 필요합니다." });
  });
export const metricRow = z
  .object({
    id,
    projectId: id,
    monitoring: z.enum(["active", "ended"]),
    createdAt: instant,
  })
  .strict();
export const metricVersion = z
  .object({
    id,
    metricId: id,
    version: z.number().int().positive(),
    status: z.enum(["draft", "approved"]),
    definition: metricDefinition,
    createdAt: instant,
    approvedAt: instant.nullable(),
  })
  .strict();
export const planBinding = z
  .object({
    metricVersionId: id,
    role: z.enum(["primary", "secondary", "guardrail"]),
    targetValue: z.number().finite().nullable(),
    baselineStatus: z.enum(["missing", "available", "not_applicable"]),
    baselineValue: z.number().finite().nullable(),
    baselineEvidence: text,
    logAvailability: availability,
    logEvidence: text,
    dataOwner: text,
    grain: required(200),
    filters: text,
    requestFormat: text,
  })
  .strict()
  .superRefine((binding, ctx) => {
    if (
      binding.baselineStatus === "available" &&
      (binding.baselineValue === null || !binding.baselineEvidence.trim())
    )
      ctx.addIssue({
        code: "custom",
        message: "기준값과 근거를 입력해 주세요. 0은 유효한 값입니다.",
      });
    if (
      binding.baselineStatus === "not_applicable" &&
      !binding.baselineEvidence.trim()
    )
      ctx.addIssue({
        code: "custom",
        message: "기준값이 해당 없는 사유를 입력해 주세요.",
      });
    if (
      binding.baselineStatus !== "available" &&
      binding.baselineValue !== null
    )
      ctx.addIssue({
        code: "custom",
        message: "미확보 기준값은 숫자로 저장하지 않습니다.",
      });
    if (binding.logAvailability === "available" && !binding.logEvidence.trim())
      ctx.addIssue({ code: "custom", message: "로그 확인 근거가 필요합니다." });
  });
export const planInput = z
  .object({
    hypothesis: required(4000),
    population: required(2000),
    baselineDays: z.number().int().min(1).max(365),
    observationDays: z
      .array(
        z.union([
          z.literal(1),
          z.literal(7),
          z.literal(14),
          z.literal(30),
          z.literal(90),
        ]),
      )
      .min(1),
    metrics: z.array(planBinding).min(1).max(20),
    confounders: text,
    guardrails: text,
    evidenceSourceIds: z.array(id),
    unknowns: z.array(text),
    qa: z.enum(["unknown", "passed", "failed"]),
    qaEvidence: text,
    waiverReason: text,
  })
  .strict()
  .superRefine((plan, ctx) => {
    if (!plan.metrics.some((m) => m.role === "primary"))
      ctx.addIssue({
        code: "custom",
        message: "핵심 KPI를 한 개 이상 선택해 주세요.",
      });
    if (
      new Set(plan.metrics.map((m) => m.metricVersionId)).size !==
        plan.metrics.length ||
      new Set(plan.observationDays).size !== plan.observationDays.length ||
      new Set(plan.evidenceSourceIds).size !== plan.evidenceSourceIds.length
    )
      ctx.addIssue({
        code: "custom",
        message: "중복된 지표·관측 일정·근거가 있습니다.",
      });
    if (plan.qa === "passed" && !plan.qaEvidence.trim())
      ctx.addIssue({ code: "custom", message: "QA 확인 근거가 필요합니다." });
  });
export const planRow = planInput.safeExtend({
  id,
  projectId: id,
  initiativeId: id,
  version: z.number().int().positive(),
  status: z.enum(["draft", "approved"]),
  supersedesId: id.nullable(),
  createdAt: instant,
  approvedAt: instant.nullable(),
  origin: z.enum(["manual", "rules", "mock"]),
  originReason: text,
});
export const strategyInput = z
  .object({
    projectId: id,
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    theme: required(200),
    goal: text,
    initiativeIds: z.array(id),
    metricVersionIds: z.array(id),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (
      new Set(s.initiativeIds).size !== s.initiativeIds.length ||
      new Set(s.metricVersionIds).size !== s.metricVersionIds.length
    )
      ctx.addIssue({
        code: "custom",
        message: "전략의 과제·지표 연결이 중복됩니다.",
      });
  });
export const strategyRow = strategyInput.safeExtend({
  id,
  createdAt: instant,
  updatedAt: instant,
});
export const measurementStateSchema = z
  .object({
    metrics: z.array(metricRow),
    metricVersions: z.array(metricVersion),
    plans: z.array(planRow),
    strategies: z.array(strategyRow),
  })
  .strict();
export const emptyMeasurement = () => ({
  metrics: [],
  metricVersions: [],
  plans: [],
  strategies: [],
});
export type Measurement = z.infer<typeof measurementStateSchema>;
export type Definition = z.infer<typeof metricDefinition>;
export type Plan = z.infer<typeof planRow>;
export type Binding = z.infer<typeof planBinding>;

type RelationState = {
  workspace: { projects: { id: string }[] };
  initiatives: { id: string; projectId: string }[];
  sources: { id: string }[];
  links: { sourceId: string; initiativeId: string }[];
  measurement: Measurement;
};
export function validateMeasurementRelations(
  s: RelationState,
  ctx: z.RefinementCtx,
) {
  const m = s.measurement,
    fail = (message: string) => ctx.addIssue({ code: "custom", message });
  const ids = [
    ...m.metrics,
    ...m.metricVersions,
    ...m.plans,
    ...m.strategies,
  ].map((x) => x.id);
  if (new Set(ids).size !== ids.length) fail("측정 기록 ID가 중복됩니다.");
  const versionKeys = m.metricVersions.map((v) => `${v.metricId}:${v.version}`),
    planKeys = m.plans.map((p) => `${p.initiativeId}:${p.version}`);
  if (
    new Set(versionKeys).size !== versionKeys.length ||
    new Set(planKeys).size !== planKeys.length
  )
    fail("버전 번호가 중복됩니다.");
  for (const metric of m.metrics)
    if (!s.workspace.projects.some((p) => p.id === metric.projectId))
      fail("지표의 프로젝트가 없습니다.");
  for (const v of m.metricVersions) {
    if (!m.metrics.some((x) => x.id === v.metricId))
      fail("지표 버전의 원본이 없습니다.");
    if ((v.status === "approved") !== (v.approvedAt !== null))
      fail("지표 승인 상태가 일치하지 않습니다.");
  }
  for (const plan of m.plans) {
    const work = s.initiatives.find((w) => w.id === plan.initiativeId);
    if (!work || work.projectId !== plan.projectId)
      fail("계획의 과제·프로젝트가 일치하지 않습니다.");
    if ((plan.status === "approved") !== (plan.approvedAt !== null))
      fail("계획 승인 상태가 일치하지 않습니다.");
    if (plan.supersedesId) {
      const previous = m.plans.find((p) => p.id === plan.supersedesId);
      if (
        !previous ||
        previous.initiativeId !== plan.initiativeId ||
        previous.version >= plan.version
      )
        fail("계획 버전 연결이 올바르지 않습니다.");
    }
    for (const b of plan.metrics) {
      const v = m.metricVersions.find((v) => v.id === b.metricVersionId),
        metric = m.metrics.find((x) => x.id === v?.metricId);
      if (
        !v ||
        metric?.projectId !== plan.projectId ||
        (plan.status === "approved" && v.status !== "approved")
      )
        fail("계획 지표는 같은 프로젝트의 승인 버전이어야 합니다.");
      if (
        v?.definition.kind === "ratio" &&
        v.definition.unit === "%" &&
        [b.targetValue, b.baselineValue].some(
          (value) => value !== null && (value < 0 || value > 100),
        )
      )
        fail("백분율 기준값·목표는 0~100 범위여야 합니다.");
    }
    for (const id of plan.evidenceSourceIds)
      if (
        !s.links.some(
          (l) => l.sourceId === id && l.initiativeId === plan.initiativeId,
        )
      )
        fail("과제에 연결되지 않은 원문 근거입니다.");
  }
  for (const strategy of m.strategies) {
    if (!s.workspace.projects.some((p) => p.id === strategy.projectId))
      fail("전략의 프로젝트가 없습니다.");
    for (const id of strategy.initiativeIds)
      if (
        !s.initiatives.some(
          (w) => w.id === id && w.projectId === strategy.projectId,
        )
      )
        fail("전략 과제의 프로젝트가 일치하지 않습니다.");
    for (const id of strategy.metricVersionIds) {
      const v = m.metricVersions.find((v) => v.id === id);
      if (
        !v ||
        v.status !== "approved" ||
        !m.metrics.some(
          (x) => x.id === v.metricId && x.projectId === strategy.projectId,
        )
      )
        fail("전략 지표의 프로젝트·승인 버전이 일치하지 않습니다.");
    }
  }
}
