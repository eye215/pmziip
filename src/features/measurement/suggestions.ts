import { z } from "zod";
import { applyMeasurement } from "./model";
import { metricDefinition, type Definition, type Binding } from "./schema";
import {
  authorize,
  stateSchema,
  type RecordsState,
  type Runtime,
} from "../records/model";

export const goals = [
  "report-rate",
  "qa-pass",
  "task-success",
  "response-time",
  "report-score",
  "period-users",
] as const;
export type Goal = (typeof goals)[number];
export const goalNames: Record<Goal, string> = {
  "report-rate": "REPORT 이벤트 완료율",
  "qa-pass": "AI 정책·QA 준수율",
  "task-success": "태스크 성공률",
  "response-time": "평균 응답 시간",
  "report-score": "리포트 평가점수",
  "period-users": "기간 순사용자",
};
export function definitionFor(goal: Goal): Definition {
  const base = {
    name: goalNames[goal],
    templateKey: goal,
    scope: "service" as const,
    kind: "ratio" as Definition["kind"],
    unit: "%",
    direction: "higher" as Definition["direction"],
    numerator: "완료 건수",
    denominator: "시도 건수",
    valueField: "",
    aggregation: "weighted" as Definition["aggregation"],
    population: "동일 기간·동일 대상군 (확인 필요)",
    exclusions: "중복·제외 기준 확인 필요",
    fields: ["event_id", "status"],
    dimensions: ["country", "version"],
    logAvailability: "unknown" as const,
    logEvidence: "",
    rubric: "",
    reproductionConditions: "",
  };
  switch (goal) {
    case "report-rate":
      return {
        ...base,
        numerator: "GALAXY_COACH_REPORT eventCount",
        denominator: "GALAXY_COACH_SIMULATION eventCount",
        population: "같은 조회 기간의 이벤트 (실제 세션 완료율과 구분)",
        fields: ["eventName", "eventCount"],
        exclusions: "중복 REPORT 여부 확인 필요",
      };
    case "qa-pass":
      return {
        ...base,
        scope: "ai_quality",
        numerator: "QA 통과 건수",
        denominator: "전체 QA 건수",
        fields: ["test_id", "pass", "model_version"],
        dimensions: ["country", "language", "model", "model_version"],
        rubric: "사용자가 평가 기준·전문가 참고 근거를 작성해야 합니다.",
      };
    case "task-success":
      return {
        ...base,
        numerator: "성공 태스크 수",
        denominator: "시도 태스크 수",
        fields: ["task_id", "status"],
      };
    case "response-time":
      return {
        ...base,
        kind: "average",
        unit: "ms",
        direction: "lower",
        numerator: "유효 응답 시간 합계(ms)",
        denominator: "유효 응답 건수",
        fields: ["request_id", "latency_ms", "status"],
      };
    case "report-score":
      return {
        ...base,
        kind: "average",
        unit: "점",
        numerator: "유효 점수 × 점수별 eventCount 합계",
        denominator: "유효 점수 이벤트 건수",
        fields: ["customEvent:nsp_value", "eventCount"],
        exclusions:
          "1~5 외 점수 제외. 전체 REPORT 횟수와 유효 점수 건수 별도 보존.",
      };
    case "period-users":
      return {
        ...base,
        kind: "unique_users",
        unit: "명",
        aggregation: "period_unique",
        numerator: "",
        denominator: "",
        valueField: "해당 기간 totalUsers 별도 조회",
        fields: ["totalUsers"],
        exclusions: "일별·국가별·Sales Case별 UU 단순 합산 금지",
      };
  }
}
export function emptyBinding(
  metricVersionId: string,
  role: Binding["role"] = "primary",
): Binding {
  return {
    metricVersionId,
    role,
    targetValue: null,
    baselineStatus: "missing",
    baselineValue: null,
    baselineEvidence: "",
    logAvailability: "unknown",
    logEvidence: "",
    dataOwner: "",
    grain: "기간·대상군별 집계 (확인 필요)",
    filters: "",
    requestFormat: "",
  };
}
export const suggestionSchema = z
  .object({
    hypothesis: z.string().min(1).max(4000),
    metrics: z
      .array(
        z
          .object({
            existingVersionId: z.uuid().nullable(),
            definition: metricDefinition.nullable(),
            role: z.enum(["primary", "secondary", "guardrail"]),
            targetValue: z.null(),
            logAvailability: z.literal("unknown"),
          })
          .strict()
          .refine(
            (x) => (x.existingVersionId === null) !== (x.definition === null),
            "기존 지표 또는 새 정의 중 하나가 필요합니다.",
          ),
      )
      .min(1)
      .max(10),
    confounders: z.string().max(10000),
    guardrails: z.string().max(10000),
    evidenceSourceIds: z.array(z.uuid()),
    unknowns: z.array(z.string().max(2000)).min(1),
  })
  .strict();
export type Suggestion = z.infer<typeof suggestionSchema>;
export function ruleSuggestion(
  s: RecordsState,
  initiativeId: string,
  goal: Goal,
): Suggestion {
  const work = s.initiatives.find((w) => w.id === initiativeId);
  if (!work) throw new Error("과제를 찾을 수 없습니다.");
  const expected = definitionFor(goal);
  const compatible = (actual: Definition) =>
    (
      [
        "scope",
        "kind",
        "unit",
        "direction",
        "numerator",
        "denominator",
        "valueField",
        "aggregation",
        "population",
        "exclusions",
        "fields",
        "dimensions",
      ] as const
    ).every(
      (key) => JSON.stringify(actual[key]) === JSON.stringify(expected[key]),
    );
  const version = s.measurement.metricVersions
    .filter(
      (v) =>
        s.measurement.metrics.some(
          (m) =>
            m.id === v.metricId &&
            m.projectId === work.projectId &&
            m.monitoring === "active",
        ) &&
        v.definition.templateKey === goal &&
        compatible(v.definition),
    )
    .sort(
      (a, b) =>
        Number(b.status === "approved") - Number(a.status === "approved") ||
        b.version - a.version,
    )[0];
  return {
    hypothesis: `‘${work.title}’ 개선이 선택한 지표에 영향을 주는지 검증합니다. 인과관계는 미확정입니다.`,
    metrics: [
      {
        existingVersionId: version?.id || null,
        definition: version ? null : definitionFor(goal),
        role: "primary",
        targetValue: null,
        logAvailability: "unknown",
      },
    ],
    confounders: "동시 배포·프로모션·대상군 차이를 확인해야 합니다.",
    guardrails: "불리한 변화와 품질 저하를 함께 검토합니다.",
    evidenceSourceIds: s.links
      .filter((l) => l.initiativeId === work.id)
      .map((l) => l.sourceId),
    unknowns: [
      "기준값 미확보",
      "로그 존재 여부 미확인",
      "목표값 사용자 결정 필요",
    ],
  };
}
export function validateSuggestion(
  s: RecordsState,
  initiativeId: string,
  value: unknown,
): Suggestion {
  const result = suggestionSchema.parse(
      typeof value === "string" ? JSON.parse(value) : value,
    ),
    work = s.initiatives.find((w) => w.id === initiativeId);
  if (!work) throw new Error("과제를 찾을 수 없습니다.");
  if (!result.metrics.some((m) => m.role === "primary"))
    throw new Error("핵심 지표가 없습니다.");
  for (const m of result.metrics) {
    if (
      m.definition?.logAvailability !== undefined &&
      m.definition.logAvailability !== "unknown"
    )
      throw new Error("추천은 로그 존재 여부를 확정하지 않습니다.");
    if (
      m.existingVersionId &&
      !s.measurement.metricVersions.some(
        (v) =>
          v.id === m.existingVersionId &&
          s.measurement.metrics.some(
            (metric) =>
              metric.id === v.metricId &&
              metric.projectId === work.projectId &&
              metric.monitoring === "active",
          ),
      )
    )
      throw new Error("다른 프로젝트의 지표 추천입니다.");
  }
  for (const id of result.evidenceSourceIds)
    if (!s.links.some((l) => l.sourceId === id && l.initiativeId === work.id))
      throw new Error("연결되지 않은 원문 근거입니다.");
  return result;
}
export function saveSuggestion(
  input: RecordsState,
  initiativeId: string,
  suggestion: Suggestion,
  r: Runtime,
  origin: "rules" | "mock" = "rules",
  reason = "규칙 기반 초안",
): RecordsState {
  authorize(input, r.session);
  const value = validateSuggestion(input, initiativeId, suggestion),
    work = input.initiatives.find((w) => w.id === initiativeId)!;
  if (
    input.measurement.plans.some(
      (p) => p.initiativeId === work.id && p.status === "draft",
    )
  )
    throw new Error(
      "작성 중인 초안을 먼저 확인해 주세요. 자동 덮어쓰지 않습니다.",
    );
  let s = structuredClone(input);
  const bindings: Binding[] = [];
  for (const item of value.metrics) {
    let versionId = item.existingVersionId;
    if (!versionId) {
      s = applyMeasurement(
        s,
        {
          type: "metric.save",
          projectId: work.projectId,
          definition: item.definition!,
        },
        r,
      );
      versionId = s.measurement.metricVersions.at(-1)!.id;
    }
    bindings.push(emptyBinding(versionId, item.role));
  }
  s = applyMeasurement(
    s,
    {
      type: "plan.save",
      initiativeId: work.id,
      data: {
        hypothesis: value.hypothesis,
        population: work.targetSegment || "대상군 확인 필요",
        baselineDays: 28,
        observationDays: [7, 14, 30],
        metrics: bindings,
        confounders: value.confounders,
        guardrails: value.guardrails,
        evidenceSourceIds: value.evidenceSourceIds,
        unknowns: value.unknowns,
        qa: "unknown",
        qaEvidence: "",
        waiverReason: "",
      },
    },
    r,
  );
  const plan = s.measurement.plans.at(-1)!;
  plan.origin = origin;
  plan.originReason = reason;
  s.revision = input.revision + 1;
  return stateSchema.parse(s);
}
