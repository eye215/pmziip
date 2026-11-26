import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compareRows,
  formatChange,
  releaseSummary,
  releaseWindows,
} from "../../src/features/coach-data/release-compare";
import type { CoachSnapshot } from "../../src/features/coach-data/store";

// Synthetic GA periods only.
const base = JSON.parse(
  readFileSync("tests/fixtures/coach-export.synthetic.json", "utf8"),
).periods[0];
let n = 0;
function snap(
  startDate: string,
  endDate: string,
  start: [number, number],
  done: [number | null, number | null],
): CoachSnapshot {
  return {
    id: `00000000-0000-4000-8000-${String(500 + n++).padStart(12, "0")}`,
    projectId: "00000000-0000-4000-8000-000000000003",
    importedAt: "2026-12-20T00:00:00.000Z",
    source: "apps-script-export",
    generator: { name: "test", version: "1" },
    definitionVersion: "coach-ga4-1.2",
    propertyTimeZone: "Asia/Seoul",
    generatedAt: "2026-12-20T00:00:00.000Z",
    contentHash: "0".repeat(64),
    period: {
      ...base,
      startDate,
      endDate,
      totals: {
        main: { users: 1000, count: 4000 },
        start: { users: start[0], count: start[1] },
        done: { users: done[0], count: done[1] },
      },
    },
  };
}

describe("before/after a release (observations)", () => {
  const list = [
    snap("2026-10-01", "2026-10-31", [400, 1000], [300, 500]),
    snap("2026-11-10", "2026-11-16", [100, 200], [50, 60]),
    snap("2026-11-01", "2026-11-30", [400, 1000], [300, 600]), // release month: skipped
    snap("2026-11-21", "2026-11-27", [100, 200], [60, 80]),
    snap("2026-11-24", "2026-11-30", [100, 0], [60, 0]),
    snap("2026-12-01", "2026-12-31", [0, 0], [null, null]),
  ];
  it("picks whole windows entirely before and after the release day", () => {
    const [week, month] = releaseWindows(list, "2026-11-18");
    expect([week.before?.period.endDate, week.after?.period.startDate]).toEqual(
      ["2026-11-16", "2026-11-21"],
    );
    expect([
      month.before?.period.startDate,
      month.after?.period.startDate,
    ]).toEqual(["2026-10-01", "2026-12-01"]);
  });
  it("computes changes; zero base is N/A and missing stays 미집계, never 0", () => {
    const [week, month] = releaseWindows(list, "2026-11-18");
    const w = Object.fromEntries(
      compareRows(week)!.map((r) => [r.key, formatChange(r.key, r.change)]),
    );
    expect(w.doneCount).toEqual({ before: "60", after: "80", delta: "+33.3%" });
    expect(w.countCompletionRate).toEqual({
      before: "30%",
      after: "40%",
      delta: "+10.0%p",
    });
    const m = Object.fromEntries(
      compareRows(month)!.map((r) => [r.key, formatChange(r.key, r.change)]),
    );
    expect(m.doneCount).toEqual({
      before: "500",
      after: "미집계",
      delta: "미집계",
    });
    expect(m.countCompletionRate.after).toBe("미집계");
    expect(releaseSummary(releaseWindows(list, "2026-11-18"))).toBe(
      "배포 전후 7일 횟수 완료율 30% → 40% (+10.0%p)",
    );
  });
  it("no comparable window → nothing claimed", () => {
    const [week, month] = releaseWindows(list, "2026-12-30");
    expect(compareRows(week)).toBeNull();
    expect(compareRows(month)).toBeNull();
    expect(releaseSummary([week, month])).toBe("");
  });
});
