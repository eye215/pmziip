import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  coachExportSchema,
  coachMetrics,
  coachWarnings,
} from "../../src/lib/connectors/coach-export";
import { coachDefinition } from "../../src/lib/connectors/coach-definition";
import {
  commitCoach,
  latestSnapshots,
  loadCoach,
  parseCoachExport,
  planCoachImport,
  type Storage,
} from "../../src/features/coach-data/store";

// Synthetic numbers only. No real GA property, user or company data.
const text = readFileSync("tests/fixtures/coach-export.synthetic.json", "utf8");
const fixture = () => JSON.parse(text);
// Same shape as the app session (extra "mode" must not leak into storage).
const session = {
  mode: "synthetic" as const,
  ownerId: "00000000-0000-4000-8000-000000000010",
  workspaceId: "00000000-0000-4000-8000-000000000001",
};
const COACH = "00000000-0000-4000-8000-000000000003";
let n = 0;
const runtime = {
  id: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  now: () => "2026-11-25T01:00:00.000Z",
};
function memory(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe("Coach GA export contract (coach-ga4-1.2)", () => {
  it("accepts the synthetic export and rejects old completion events", () => {
    expect(coachExportSchema.safeParse(fixture()).success).toBe(true);
    const old = fixture();
    old.definition.doneEvent = "galaxy_coach_simulation_Done";
    const result = coachExportSchema.safeParse(old);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("doneEvent");
  });
  it("rejects unknown fields, bad dates, duplicate periods and negative counts", () => {
    const extra = fixture();
    extra.propertyId = "123";
    expect(coachExportSchema.safeParse(extra).success).toBe(false);
    const dup = fixture();
    dup.periods[1] = dup.periods[0];
    expect(coachExportSchema.safeParse(dup).success).toBe(false);
    const bad = fixture();
    bad.periods[0].totals.main.users = -1;
    expect(coachExportSchema.safeParse(bad).success).toBe(false);
    const order = fixture();
    order.periods[0].startDate = "2026-11-01";
    expect(coachExportSchema.safeParse(order).success).toBe(false);
  });
  it("keeps the Apps Script definition in sync with coachDefinition", () => {
    const gs = readFileSync(
      "tools/apps-script/coach-ga-export/Code.gs",
      "utf8",
    );
    const value = (name: string) =>
      gs.match(new RegExp(`var ${name} = '([^']*)'`))?.[1];
    expect(value("DEFINITION_VERSION")).toBe(coachDefinition.version);
    expect(value("MAIN_EVENT")).toBe(coachDefinition.main.eventName);
    expect(value("MAIN_SCREEN_DIMENSION")).toBe(
      coachDefinition.main.screenDimension,
    );
    expect(value("MAIN_SCREEN")).toBe(coachDefinition.main.screenName);
    expect(value("START_EVENT")).toBe(coachDefinition.start.eventName);
    expect(value("DONE_EVENT")).toBe(coachDefinition.done.eventName);
    expect(value("SCORE_DIMENSION")).toBe(coachDefinition.score.dimension);
    expect(value("COUNTRY_DIMENSION")).toBe(coachDefinition.countryDimension);
    expect(value("SALES_CASE_DIMENSION")).toBe(
      coachDefinition.salesCaseDimension,
    );
    expect(gs).not.toMatch(/galaxy_coach_simulation_Done'/);
    expect(gs).not.toMatch(/properties\/\d+/);
  });
});

describe("Coach metrics are deterministic and never invent values", () => {
  it("separates REPORT count from valid score count and computes §4.3 rates", () => {
    const p = coachExportSchema.parse(fixture()).periods[0];
    const m = coachMetrics(p);
    expect(m.doneCount).toBe(620);
    expect(m.validScoreCount).toBe(600);
    expect(m.reportWithoutValidScore).toBe(20);
    expect(m.startRate).toEqual({ value: 0.4 });
    expect(m.userCompletionRate).toEqual({ value: 0.75 });
    expect(m.countCompletionRate.value).toBeCloseTo(620 / 900);
    expect(m.startsPerUser).toEqual({ value: 2.25 });
    expect(m.averageScore.value).toBeCloseTo(
      (20 * 1 + 40 * 2 + 100 * 3 + 200 * 4 + 240 * 5) / 600,
    );
    expect(m.highScoreRate.value).toBeCloseTo(440 / 600);
    expect(m.lowScoreRate.value).toBeCloseTo(60 / 600);
  });
  it("uses period totals only: country / sales case UU are not summed", () => {
    const p = coachExportSchema.parse(fixture()).periods[0];
    const countrySum = p.byCountry.main.reduce((a, r) => a + (r.users ?? 0), 0);
    expect(countrySum).toBe(1050);
    expect(coachMetrics(p).mainUsers).toBe(1000);
    const changed = structuredClone(p);
    changed.byCountry.main[0].users = 99999;
    expect(coachMetrics(changed)).toEqual(coachMetrics(p));
  });
  it("returns N/A for zero denominators and keeps missing distinct from 0", () => {
    const p = coachExportSchema.parse(fixture()).periods[1];
    const m = coachMetrics(p);
    expect(m.startRate).toEqual({ value: null, reason: "denominator_zero" });
    expect(m.doneUsers).toBeNull();
    expect(m.userCompletionRate).toEqual({ value: null, reason: "missing" });
    expect(m.averageScore).toEqual({ value: null, reason: "missing" });
    expect(coachWarnings(p).join(" ")).toContain("미집계");
  });
  it("warns on thresholding, invalid score values and duplicate-looking scores", () => {
    const p = coachExportSchema.parse(fixture()).periods[0];
    expect(coachWarnings(p).join(" ")).toMatch(/임계값.*1~5가 아닌/);
    const dup = structuredClone(p);
    dup.totals.done.count = 500;
    expect(coachWarnings(dup).join(" ")).toContain("중복 이벤트");
  });
});

describe("Coach import store is append-only and idempotent", () => {
  it("imports once, skips identical re-import, keeps re-collection as history", async () => {
    const storage = memory();
    let loaded = loadCoach(storage, session);
    const file = parseCoachExport(text);
    const plan = await planCoachImport(loaded.state, file, COACH, runtime);
    expect([plan.add.length, plan.duplicates, plan.recollected]).toEqual([
      2, 0, 0,
    ]);
    loaded = commitCoach(storage, loaded, plan.add, session);

    const again = await planCoachImport(
      loaded.state,
      parseCoachExport(text),
      COACH,
      runtime,
    );
    expect([again.add.length, again.duplicates]).toEqual([0, 2]);

    const recollected = fixture();
    recollected.generatedAt = "2026-11-26T06:00:00.000Z";
    recollected.periods[1].totals.done = { users: 5, count: 7 };
    const plan2 = await planCoachImport(
      loaded.state,
      coachExportSchema.parse(recollected),
      COACH,
      { ...runtime, now: () => "2026-11-26T01:00:00.000Z" },
    );
    expect([plan2.add.length, plan2.duplicates, plan2.recollected]).toEqual([
      1, 1, 1,
    ]);
    loaded = commitCoach(storage, loaded, plan2.add, session);
    expect(loaded.state.snapshots).toHaveLength(3);
    const latest = latestSnapshots(loaded.state, COACH);
    expect(latest.map((x) => [x.latest.period.startDate, x.history])).toEqual([
      ["2026-11-01", 2],
      ["2026-10-01", 1],
    ]);
    expect(latest[0].latest.period.totals.done.count).toBe(7);
  });
  it("rejects writes after another tab changed the store; nothing is overwritten", async () => {
    const storage = memory();
    const a = loadCoach(storage, session);
    const plan = await planCoachImport(
      a.state,
      parseCoachExport(text),
      COACH,
      runtime,
    );
    commitCoach(
      storage,
      loadCoach(storage, session),
      plan.add.slice(0, 1),
      session,
    );
    const before = storage.getItem([...storage.data.keys()][0]);
    expect(() => commitCoach(storage, a, plan.add, session)).toThrow("다른 탭");
    expect(storage.getItem([...storage.data.keys()][0])).toBe(before);
  });
  it("refuses another owner's store and oversized or non-JSON files", () => {
    const storage = memory();
    storage.setItem(
      `pmzip:coach-ga:v1:${session.ownerId}:${session.workspaceId}`,
      JSON.stringify({
        schemaVersion: 1,
        ownerId: "00000000-0000-4000-8000-000000000099",
        workspaceId: session.workspaceId,
        revision: 0,
        snapshots: [],
      }),
    );
    expect(() => loadCoach(storage, session)).toThrow();
    expect(() => parseCoachExport("{")).toThrow("JSON");
    expect(() => parseCoachExport(" ".repeat(2_000_001))).toThrow("2MB");
  });
});
