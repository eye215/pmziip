import { describe, expect, it } from "vitest";
import {
  appendSegment,
  currentSegments,
  loadSegments,
  parseTrillion,
  segmentSource,
} from "../../src/features/segment-fin/store";
import { businessContext } from "../../src/features/report/business";

// Synthetic values only (not real results).
const session = {
  ownerId: "00000000-0000-4000-8000-000000000010",
  workspaceId: "00000000-0000-4000-8000-000000000001",
};
function memory() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}
let n = 0;
let t = 0;
const runtime = {
  id: () => `00000000-0000-4000-8000-${String(500 + n++).padStart(12, "0")}`,
  now: () => new Date(Date.UTC(2026, 10, 27, 0, 0, t++)).toISOString(),
};
const src = "https://example.invalid/ir/2026q3";
const base = {
  segment: "MX/네트워크",
  operatingIncome: null,
  source: src,
  removed: false,
};

describe("public segment results (hand-entered)", () => {
  it("edits are new entries; the latest wins; removal is a tombstone", () => {
    const s = memory();
    let l = loadSegments(s, session);
    l = appendSegment(
      s,
      l,
      { ...base, year: 2026, quarter: 3, revenue: 30e12 },
      session,
      runtime,
    );
    l = appendSegment(
      s,
      l,
      { ...base, year: 2026, quarter: 3, revenue: 31e12 },
      session,
      runtime,
    );
    expect(l.state.entries).toHaveLength(2); // history kept
    expect(currentSegments(l.state).map((e) => e.revenue)).toEqual([31e12]);
    const cur = currentSegments(l.state)[0];
    l = appendSegment(s, l, { ...cur, removed: true }, session, runtime);
    expect(currentSegments(l.state)).toEqual([]);
    expect(l.state.entries).toHaveLength(3);
  });
  it("rejects a stale tab write", () => {
    const s = memory();
    const a = loadSegments(s, session);
    appendSegment(
      s,
      a,
      { ...base, year: 2026, quarter: 1, revenue: 1e12 },
      session,
      runtime,
    );
    expect(() =>
      appendSegment(
        s,
        a,
        { ...base, year: 2026, quarter: 2, revenue: 1e12 },
        session,
        runtime,
      ),
    ).toThrow("다른 탭");
  });
  it("needs a source and at least one value; blanks stay null", () => {
    expect(segmentSource.safeParse("").success).toBe(false);
    expect(segmentSource.safeParse("http://x.invalid").success).toBe(false);
    expect(segmentSource.safeParse("20261030000123").success).toBe(true);
    expect(parseTrillion("")).toBeNull();
    expect(parseTrillion("33.5")).toBe(33.5e12);
    expect(parseTrillion("1,234.56")).toBe(1234.56e12);
    expect(() => parseTrillion("3.555")).toThrow();
    const s = memory();
    expect(() =>
      appendSegment(
        s,
        loadSegments(s, session),
        { ...base, year: 2026, quarter: 1, revenue: null },
        session,
        runtime,
      ),
    ).toThrow();
  });
  it("business line uses the MX figure for the release quarter", () => {
    const seg = (year: number, revenue: number) => ({
      ...base,
      id: runtime.id(),
      enteredAt: runtime.now(),
      year,
      quarter: 3 as const,
      revenue,
      operatingIncome: 3e12,
    });
    const ctx = {
      companies: [{ corpCode: "00000001", corpName: "삼성전자" }],
      finRows: [],
      share: [],
      segments: [seg(2025, 30e12), seg(2026, 33e12)],
    };
    const line = businessContext("2026-08-10", ctx);
    expect(line).toContain(
      "공개 실적 MX/네트워크 2026-Q3 매출 33.0조원(전년 동기 대비 +10.0%)",
    );
    expect(line).toContain("영업이익 3.0조원");
    expect(line).toContain(`출처 ${src}`);
    expect(line).not.toContain("공시 삼성전자"); // segment replaces company-wide
    // A quarter without a segment entry falls back (nothing here → empty).
    expect(businessContext("2026-11-10", ctx)).toBe("");
  });
});
