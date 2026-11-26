import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createState,
  type Runtime,
} from "../../src/features/records/model";
import {
  buildReport,
  finalizeReport,
  loadReports,
  reportText,
} from "../../src/features/report/model";

// Synthetic records only.
let n = 0;
const runtime: Runtime = {
  session: {
    mode: "synthetic",
    ownerId: "00000000-0000-4000-8000-000000000010",
    workspaceId: "00000000-0000-4000-8000-000000000001",
  },
  now: () => "2026-11-26T01:00:00.000Z",
  id: () => `00000000-0000-4000-8000-${String(300 + n++).padStart(12, "0")}`,
};
const work = (projectId: string, title: string, extra: object) => ({
  projectId,
  title,
  problem: "",
  targetSegment: "",
  expectedChange: "",
  category: "fix" as const,
  priority: "medium" as const,
  assignee: "",
  contribution: "",
  decisionReason: "",
  alternative: "",
  plannedAt: null,
  targetMonth: null,
  status: "draft" as const,
  ...extra,
});
function memory() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

describe("impact report", () => {
  let s = createState(runtime.session);
  const p = s.workspace.projects[0].id;
  s = applyCommand(
    s,
    {
      type: "source.save",
      data: {
        title: "합성",
        rawText: "합성 원문",
        sourceType: "mail",
        reference: "",
        collectedAt: "2026-11-02T00:00:00.000Z",
        requesterRole: "",
        sensitivity: "internal",
      },
    },
    runtime,
  );
  for (const [title, extra] of [
    [
      "배포한 과제",
      { status: "released", releasedAt: "2026-11-20T01:00:00.000Z" },
    ],
    ["안 한 과제", { status: "canceled", decisionReason: "효과 대비 비용 큼" }],
    ["검토 중 과제", {}],
    [
      "지난해 배포",
      { status: "released", releasedAt: "2025-06-01T01:00:00.000Z" },
    ],
  ] as const)
    s = applyCommand(
      s,
      { type: "initiative.save", sourceIds: [], data: work(p, title, extra) },
      runtime,
    );

  it("counts by period; declined decisions are cases too; observations only", () => {
    const r = buildReport(s, "2026-01", "2026-12", "Asia/Seoul", (w) =>
      w.title === "배포한 과제"
        ? {
            line: "배포 전후 7일 횟수 완료율 30% → 40% (+10.0%p)",
            improved: true,
          }
        : { line: "", improved: null },
    );
    expect(r.summary).toEqual({
      collected: 1,
      created: 4, // createdAt is "now" (2026-11) for all four
      go: 2,
      no: 1,
      pending: 1,
      archived: 0,
      released: 1,
      releasedWithPlan: 0,
      comparable: 1,
      improvedObserved: 1,
    });
    expect(r.cases.map((c) => [c.title, c.kind])).toEqual([
      ["배포한 과제", "released"],
      ["안 한 과제", "declined"],
    ]);
    expect(r.cases[0].lines[5].text).toContain("(+10.0%p)");
    expect(reportText(r)).toContain("관찰값입니다");
    expect(() =>
      buildReport(s, "2026-12", "2026-01", "Asia/Seoul", () => ({
        line: "",
        improved: null,
      })),
    ).toThrow("시작 월");
  });

  it("finalized reports are append-only snapshots; same content is refused", () => {
    const storage = memory();
    const content = buildReport(s, "2026-11", "2026-11", "Asia/Seoul", () => ({
      line: "",
      improved: null,
    }));
    let loaded = loadReports(storage, runtime.session);
    loaded = finalizeReport(
      storage,
      loaded,
      content,
      "a".repeat(64),
      runtime.session,
      runtime,
    );
    expect(loaded.state.reports[0].version).toBe(1);
    expect(() =>
      finalizeReport(
        storage,
        loaded,
        content,
        "a".repeat(64),
        runtime.session,
        runtime,
      ),
    ).toThrow("이미 확정");
    const first = JSON.stringify(loaded.state.reports[0]);
    loaded = finalizeReport(
      storage,
      loaded,
      content,
      "b".repeat(64),
      runtime.session,
      runtime,
    );
    expect(loaded.state.reports.map((r) => r.version)).toEqual([1, 2]);
    expect(loaded.state.reports[1].supersedesId).toBe(
      loaded.state.reports[0].id,
    );
    expect(JSON.stringify(loaded.state.reports[0])).toBe(first); // unchanged
    // A stale tab cannot overwrite.
    const stale = { ...loaded, token: "stale" };
    expect(() =>
      finalizeReport(
        storage,
        stale,
        content,
        "c".repeat(64),
        runtime.session,
        runtime,
      ),
    ).toThrow("다른 탭");
  });
});
