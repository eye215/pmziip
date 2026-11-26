import { planInput } from "../../src/features/measurement/schema";
import { describe, it, expect, vi } from "vitest";
import {
  createState,
  applyCommand,
  type Runtime,
} from "../../src/features/records/model";
import {
  applyMeasurement,
  readiness,
  dataRequestMarkdown,
} from "../../src/features/measurement/model";
import {
  definitionFor,
  ruleSuggestion,
  saveSuggestion,
  emptyBinding,
} from "../../src/features/measurement/suggestions";
import { suggestWithProvider } from "../../src/lib/ai/measurement-provider";
import {
  splitSource,
  saveSplit,
} from "../../src/features/measurement/source-split";
import {
  loadLocal,
  commitLocal,
  storageKey,
} from "../../src/features/records/persistence";

const COACH = "00000000-0000-4000-8000-000000000003",
  SURVEY = "00000000-0000-4000-8000-000000000004";
let counter = 1000;
const r: Runtime = {
  session: {
    mode: "synthetic",
    ownerId: "00000000-0000-4000-8000-000000000010",
    workspaceId: "00000000-0000-4000-8000-000000000001",
  },
  now: () => "2026-11-25T00:00:00.000Z",
  id: () => `00000000-0000-4000-8000-${String(counter++).padStart(12, "0")}`,
};
function fixture() {
  let s = createState(r.session);
  for (const [projectId, title] of [
    [COACH, "입력 개선"],
    [COACH, "위젯 개선"],
    [COACH, "QA 개선"],
    [SURVEY, "분석 개선"],
  ])
    s = applyCommand(
      s,
      {
        type: "initiative.save",
        data: {
          projectId,
          title,
          problem: "합성 문제",
          targetSegment: "합성 대상",
          expectedChange: "개선",
          category: "improvement",
          priority: "medium",
          assignee: "",
          contribution: "",
          decisionReason: "",
          alternative: "",
          plannedAt: null,
          targetMonth: "2026-11",
          status: "draft",
        },
        sourceIds: [],
      },
      r,
    );
  return s;
}
function approvedMetric(
  s: ReturnType<typeof fixture>,
  goal: "report-rate" | "task-success" | "qa-pass" = "report-rate",
  projectId = COACH,
) {
  s = applyMeasurement(
    s,
    { type: "metric.save", projectId, definition: definitionFor(goal) },
    r,
  );
  return applyMeasurement(
    s,
    {
      type: "metric.approve",
      id: s.measurement.metricVersions.at(-1)!.id,
      confirmation: true,
    },
    r,
  );
}

describe("Phase 2 measurement versions and contracts", () => {
  it("keeps primary/secondary/guardrail bindings independent and rejects invalid percent targets", () => {
    let s = approvedMetric(
      approvedMetric(approvedMetric(fixture()), "task-success"),
      "qa-pass",
    );
    const work = s.initiatives[0].id;
    s = saveSuggestion(s, work, ruleSuggestion(s, work, "report-rate"), r);
    const plan = s.measurement.plans[0];
    const data = planInput.parse(
      Object.fromEntries(
        Object.keys(planInput.shape).map((key) => [
          key,
          plan[key as keyof typeof plan],
        ]),
      ),
    );
    data.metrics = s.measurement.metricVersions.map((version, index) => ({
      ...emptyBinding(
        version.id,
        (["primary", "secondary", "guardrail"] as const)[index],
      ),
      targetValue: index === 0 ? null : index === 1 ? 75 : 90,
    }));
    const invalid = structuredClone(data);
    invalid.metrics[1].targetValue = 101;
    expect(() =>
      applyMeasurement(
        s,
        { type: "plan.save", id: plan.id, initiativeId: work, data: invalid },
        r,
      ),
    ).toThrow();
    const before = structuredClone(s);
    s = applyMeasurement(
      s,
      { type: "plan.save", id: plan.id, initiativeId: work, data },
      r,
    );
    s = applyMeasurement(
      s,
      { type: "plan.approve", id: plan.id, confirmation: true },
      r,
    );
    expect(
      s.measurement.plans[0].metrics.map((b) => [b.role, b.targetValue]),
    ).toEqual([
      ["primary", null],
      ["secondary", 75],
      ["guardrail", 90],
    ]);
    expect(before.measurement.plans[0].metrics).toHaveLength(1);
  });
  it("does not reuse a template label after the user changes its population or formula", () => {
    let s = fixture();
    s = applyMeasurement(
      s,
      {
        type: "metric.save",
        projectId: COACH,
        definition: {
          ...definitionFor("report-rate"),
          population: "별도 대상군",
        },
      },
      r,
    );
    const before = structuredClone(s);
    expect(
      ruleSuggestion(s, s.initiatives[0].id, "report-rate").metrics[0]
        .existingVersionId,
    ).toBeNull();
    expect(s).toEqual(before);
  });
  it("T03: three tasks in one month choose different KPIs and reuse an approved completion definition", () => {
    let s = approvedMetric(fixture());
    const completion = s.measurement.metricVersions[0].id;
    for (const [index, goal] of [
      [0, "report-rate"],
      [1, "task-success"],
      [2, "qa-pass"],
    ] as const)
      s = saveSuggestion(
        s,
        s.initiatives[index].id,
        ruleSuggestion(s, s.initiatives[index].id, goal),
        r,
      );
    expect(s.measurement.plans).toHaveLength(3);
    expect(s.measurement.metrics).toHaveLength(3);
    expect(s.measurement.plans[0].metrics[0].metricVersionId).toBe(completion);
    expect(
      s.measurement.plans.every((p) => p.metrics[0].targetValue === null),
    ).toBe(true);
    expect(() =>
      saveSuggestion(
        s,
        s.initiatives[0].id,
        ruleSuggestion(s, s.initiatives[0].id, "report-rate"),
        r,
      ),
    ).toThrow();
  });
  it("T04: editing or approving a successor never changes the original metric or plan", () => {
    let s = approvedMetric(fixture());
    const work = s.initiatives[0].id,
      metric = s.measurement.metricVersions[0].id;
    s = saveSuggestion(s, work, ruleSuggestion(s, work, "report-rate"), r);
    s = applyMeasurement(
      s,
      {
        type: "plan.approve",
        id: s.measurement.plans[0].id,
        confirmation: true,
      },
      r,
    );
    const metricBefore = JSON.stringify(s.measurement.metricVersions[0]),
      planBefore = JSON.stringify(s.measurement.plans[0]),
      planId = s.measurement.plans[0].id;
    expect(() =>
      applyMeasurement(
        s,
        {
          type: "metric.save",
          id: metric,
          projectId: COACH,
          definition: { ...definitionFor("report-rate"), name: "덮어쓰기" },
        },
        r,
      ),
    ).toThrow();
    const plan = s.measurement.plans[0];
    const data = planInput.parse(
      Object.fromEntries(
        Object.keys(planInput.shape).map((key) => [
          key,
          plan[key as keyof typeof plan],
        ]),
      ),
    );
    expect(() =>
      applyMeasurement(
        s,
        {
          type: "plan.save",
          id: planId,
          initiativeId: work,
          data: { ...data, hypothesis: "덮어쓰기" },
        },
        r,
      ),
    ).toThrow();
    s = applyMeasurement(s, { type: "metric.revise", id: metric }, r);
    s = applyMeasurement(
      s,
      {
        type: "metric.save",
        id: s.measurement.metricVersions.at(-1)!.id,
        projectId: COACH,
        definition: { ...definitionFor("report-rate"), name: "새 버전" },
      },
      r,
    );
    s = applyMeasurement(s, { type: "plan.revise", id: planId }, r);
    const successorMetric = s.measurement.metricVersions.at(-1)!.id;
    const successorPlan = s.measurement.plans.at(-1)!;
    s = applyMeasurement(
      s,
      { type: "metric.approve", id: successorMetric, confirmation: true },
      r,
    );
    s = applyMeasurement(
      s,
      {
        type: "plan.save",
        id: successorPlan.id,
        initiativeId: work,
        data: {
          ...data,
          metrics: data.metrics.map((b) => ({
            ...b,
            metricVersionId: successorMetric,
          })),
          hypothesis: "새 버전 가설",
        },
      },
      r,
    );
    s = applyMeasurement(
      s,
      { type: "plan.approve", id: successorPlan.id, confirmation: true },
      r,
    );
    expect(JSON.stringify(s.measurement.metricVersions[0])).toBe(metricBefore);
    expect(JSON.stringify(s.measurement.plans[0])).toBe(planBefore);
    expect(s.measurement.plans[1].supersedesId).toBe(planId);
  });
  it("T09: approval is independent of readiness; zero baseline is preserved and missing evidence blocks ready", () => {
    let s = approvedMetric(fixture());
    const work = s.initiatives[0].id;
    s = saveSuggestion(s, work, ruleSuggestion(s, work, "report-rate"), r);
    const plan = s.measurement.plans[0];
    s = applyMeasurement(
      s,
      { type: "plan.approve", id: plan.id, confirmation: true },
      r,
    );
    expect(readiness(s, work).status).toBe("partial");
    s = applyMeasurement(s, { type: "plan.revise", id: plan.id }, r);
    const draft = s.measurement.plans[1];
    const data = {
      hypothesis: draft.hypothesis,
      population: draft.population,
      baselineDays: 28,
      observationDays: [7, 14, 30] as (7 | 14 | 30)[],
      metrics: [
        {
          ...draft.metrics[0],
          baselineStatus: "available" as const,
          baselineValue: 0,
          baselineEvidence: "합성 기준값 근거",
          logAvailability: "available" as const,
          logEvidence: "합성 스키마 확인",
          dataOwner: "데모 담당",
        },
      ],
      confounders: "",
      guardrails: "",
      evidenceSourceIds: [],
      unknowns: [],
      qa: "passed" as const,
      qaEvidence: "합성 QA 확인",
      waiverReason: "",
    };
    s = applyMeasurement(
      s,
      { type: "plan.save", id: draft.id, initiativeId: work, data },
      r,
    );
    s = applyMeasurement(
      s,
      { type: "plan.approve", id: draft.id, confirmation: true },
      r,
    );
    expect(readiness(s, work)).toEqual({ status: "ready", missing: [] });
    expect(s.measurement.plans[1].metrics[0].baselineValue).toBe(0);
    expect(s.measurement.plans[0].metrics[0].baselineValue).toBeNull();
  });
  it("T01/T08: rejects cross-project references, unapproved definitions and additive unique users", () => {
    let s = approvedMetric(fixture());
    const surveyWork = s.initiatives[3].id;
    const recommendation = ruleSuggestion(s, surveyWork, "report-rate");
    recommendation.metrics[0].existingVersionId =
      s.measurement.metricVersions[0].id;
    recommendation.metrics[0].definition = null;
    expect(() => saveSuggestion(s, surveyWork, recommendation, r)).toThrow();
    expect(() =>
      applyMeasurement(
        s,
        {
          type: "metric.save",
          projectId: COACH,
          definition: {
            ...definitionFor("period-users"),
            aggregation: "additive",
          },
        },
        r,
      ),
    ).toThrow();
    s = saveSuggestion(
      s,
      s.initiatives[1].id,
      ruleSuggestion(s, s.initiatives[1].id, "task-success"),
      r,
    );
    expect(() =>
      applyMeasurement(
        s,
        {
          type: "plan.approve",
          id: s.measurement.plans[0].id,
          confirmation: true,
        },
        r,
      ),
    ).toThrow();
  });
  it("monthly strategy can copy to a new month and keeps the original and project isolation", () => {
    let s = approvedMetric(fixture());
    const data = {
      projectId: COACH,
      month: "2026-11",
      theme: "입력 품질",
      goal: "근거 확보",
      initiativeIds: [s.initiatives[0].id],
      metricVersionIds: [s.measurement.metricVersions[0].id],
    };
    s = applyMeasurement(s, { type: "strategy.save", data }, r);
    const before = JSON.stringify(s.measurement.strategies[0]);
    s = applyMeasurement(
      s,
      {
        type: "strategy.copy",
        id: s.measurement.strategies[0].id,
        month: "2026-12",
      },
      r,
    );
    expect(JSON.stringify(s.measurement.strategies[0])).toBe(before);
    expect(s.measurement.strategies[1].month).toBe("2026-12");
    expect(() =>
      applyMeasurement(
        s,
        { type: "strategy.save", data: { ...data, projectId: SURVEY } },
        r,
      ),
    ).toThrow();
  });
  it("request Markdown quotes untrusted values, reports unknown availability and no invented target", () => {
    let s = approvedMetric(fixture());
    const work = s.initiatives[0].id;
    s = saveSuggestion(s, work, ruleSuggestion(s, work, "report-rate"), r);
    const md = dataRequestMarkdown(s, {
      ...s.measurement.plans[0],
      hypothesis: "<script>not a command</script>",
    });
    expect(md).toContain("로그: unknown");
    expect(md).toContain("목표: 미정");
    expect(md).toContain("GALAXY");
    expect(md).not.toContain("<script>");
  });
});

describe("mock AI contract and explicit rule fallback", () => {
  it("accepts a schema-valid mock and falls back on provider failure without changing state", async () => {
    const s = fixture(),
      work = s.initiatives[0].id,
      before = structuredClone(s);
    const valid = ruleSuggestion(s, work, "report-rate");
    const result = await suggestWithProvider(s, work, "report-rate", {
      kind: "mock",
      generate: async () => JSON.stringify(valid),
    });
    expect(result.origin).toBe("mock");
    expect(result.suggestion).toEqual(valid);
    expect(
      (
        await suggestWithProvider(s, work, "report-rate", {
          kind: "mock",
          generate: async () => {
            throw new Error("synthetic provider failure");
          },
        })
      ).reason,
    ).toBe("provider_error");
    expect(s).toEqual(before);
  });
  it("uses rules when unconfigured or on invalid JSON, fabricated targets or unsupported evidence", async () => {
    const s = fixture(),
      work = s.initiatives[0].id;
    expect((await suggestWithProvider(s, work, "report-rate")).reason).toBe(
      "not_configured",
    );
    expect(
      (
        await suggestWithProvider(s, work, "report-rate", {
          kind: "mock",
          generate: async () => "broken",
        })
      ).reason,
    ).toBe("invalid_output");
    const fake = ruleSuggestion(s, work, "report-rate");
    expect(
      (
        await suggestWithProvider(s, work, "report-rate", {
          kind: "mock",
          generate: async () => ({
            ...fake,
            metrics: [{ ...fake.metrics[0], targetValue: 99 }],
          }),
        })
      ).reason,
    ).toBe("invalid_output");
    expect(
      (
        await suggestWithProvider(s, work, "report-rate", {
          kind: "mock",
          generate: async () => ({ ...fake, evidenceSourceIds: [r.id()] }),
        })
      ).reason,
    ).toBe("invalid_output");
  });
  it("aborts a stalled provider and preserves the rule draft without writing state", async () => {
    vi.useFakeTimers();
    try {
      const s = fixture(),
        before = structuredClone(s);
      let aborted = false;
      const pending = suggestWithProvider(
        s,
        s.initiatives[0].id,
        "task-success",
        {
          kind: "mock",
          generate: async (_, signal) =>
            new Promise((resolve) => {
              signal.addEventListener("abort", () => {
                aborted = true;
                resolve(null);
              });
            }),
        },
        50,
      );
      await vi.advanceTimersByTimeAsync(51);
      expect((await pending).reason).toBe("timeout");
      expect(aborted).toBe(true);
      expect(s).toEqual(before);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("source split review", () => {
  function sourceFixture() {
    const state = applyCommand(
      fixture(),
      {
        type: "source.save",
        data: {
          title: "합성 원문",
          rawText: "- 입력 흐름 개선\n- 설문 질문 개선",
          sourceType: "manual",
          reference: "",
          collectedAt: r.now(),
          requesterRole: "",
          sensitivity: "public",
        },
      },
      r,
    );
    return { state, sourceId: state.sources[0].id };
  }
  it("only creates explicitly selected project drafts and retains exact source text and revisions", () => {
    const { state, sourceId } = sourceFixture(),
      before = structuredClone(state);
    const preview = splitSource(state, sourceId);
    expect(preview.map((p) => p.projectId)).toEqual(["", ""]);
    expect(state).toEqual(before);
    const next = saveSplit(
      state,
      sourceId,
      [
        { ...preview[0], projectId: COACH },
        { ...preview[1], projectId: SURVEY },
      ],
      r,
    );
    expect(next.sources[0]).toEqual({ ...state.sources[0], status: "linked" });
    expect(next.initiatives.slice(-2).map((p) => p.projectId)).toEqual([
      COACH,
      SURVEY,
    ]);
    expect(next.links.filter((l) => l.sourceId === sourceId)).toHaveLength(2);
    expect(next.revision).toBe(state.revision + 1);
    expect(state).toEqual(before);
  });
  it("rejects missing projects, repeated selection and existing duplicate drafts atomically", () => {
    const { state, sourceId } = sourceFixture(),
      before = structuredClone(state);
    expect(() =>
      saveSplit(state, sourceId, [{ title: "입력 개선", projectId: "" }], r),
    ).toThrow();
    const row = { title: "새 과제", projectId: COACH };
    expect(() => saveSplit(state, sourceId, [row, row], r)).toThrow();
    expect(() =>
      saveSplit(state, sourceId, [{ title: "입력 개선", projectId: COACH }], r),
    ).toThrow();
    expect(state).toEqual(before);
  });
});

describe("v1 → v2 lossless local migration", () => {
  it("reads old records without writing, then backs up exact old bytes before a successful v2 save", () => {
    const s = fixture();
    const base: Record<string, unknown> = JSON.parse(JSON.stringify(s));
    delete base.measurement;
    const original = JSON.stringify({ ...base, schemaVersion: 1 });
    const values = new Map<string, string>(),
      store = {
        getItem: (k: string) => values.get(k) ?? null,
        setItem: (k: string, v: string) => {
          values.set(k, v);
        },
      },
      key = storageKey(r.session);
    values.set(key, original);
    const loaded = loadLocal(store, r.session);
    expect(loaded.state.schemaVersion).toBe(2);
    expect(store.getItem(key)).toBe(original);
    expect(loaded.state.initiatives).toEqual(s.initiatives);
    const next = applyMeasurement(
      loaded.state,
      {
        type: "metric.save",
        projectId: COACH,
        definition: definitionFor("qa-pass"),
      },
      r,
    );
    commitLocal(store, loaded, next, r.session);
    expect(store.getItem(key + ":before-v2:" + s.revision)).toBe(original);
    expect(loadLocal(store, r.session).state.measurement.metrics).toHaveLength(
      1,
    );
  });
  it("does not change the primary bytes if backup creation fails", () => {
    const base: Record<string, unknown> = JSON.parse(JSON.stringify(fixture()));
    delete base.measurement;
    const original = JSON.stringify({ ...base, schemaVersion: 1 }),
      key = storageKey(r.session);
    const store = {
      getItem: (k: string) => (k === key ? original : null),
      setItem: () => {
        throw new Error("quota");
      },
    };
    const loaded = loadLocal(store, r.session),
      next = applyMeasurement(
        loaded.state,
        {
          type: "metric.save",
          projectId: COACH,
          definition: definitionFor("qa-pass"),
        },
        r,
      );
    expect(() => commitLocal(store, loaded, next, r.session)).toThrow();
    expect(store.getItem(key)).toBe(original);
  });
});
