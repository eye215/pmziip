import { describe, expect, it } from "vitest";
import type { FinRow } from "../../src/lib/connectors/public-financials";
import {
  BUSINESS_NOTE,
  businessContext,
  type PublicContext,
} from "../../src/features/report/business";

// Synthetic numbers only (not real disclosures).
const corp = "00000001";
const rev = (
  year: number,
  quarter: 1 | 2 | 3 | 4,
  amount: number | null,
): FinRow => ({
  corpCode: corp,
  year,
  quarter,
  fsDiv: "CFS",
  account: "revenue",
  accountName: "매출액",
  amount,
  basis: "reported",
  reportCode: "11014",
  rceptNo: "20260000000001",
  currency: "KRW",
});
const ctx: PublicContext = {
  companies: [{ corpCode: corp, corpName: "삼성전자" }],
  finRows: [rev(2025, 3, 50e12), rev(2026, 3, 55e12)],
  share: [
    { country: "KR", month: "2026-08", vendor: "Samsung", share: 60 },
    { country: "KR", month: "2026-09", vendor: "Samsung", share: 61.5 },
    { country: "US", month: "2026-09", vendor: "Samsung", share: 25 },
    { country: "KR", month: "2026-09", vendor: "Apple", share: 30 },
  ],
};

describe("business context (public data only)", () => {
  it("release quarter revenue with YoY and share around the release month", () => {
    const t = businessContext("2026-09-15", ctx);
    expect(t).toContain("공시 삼성전자(연결) 2026-Q3 매출 55.0조원");
    expect(t).toContain("전년 동기 대비 +10.0%");
    expect(t).toContain("KR 61.5% (전월 대비 +1.5%p)");
    expect(t).toContain("US 25.0%"); // no previous month: no change shown
    expect(t).not.toContain("US 25.0% (전월");
    expect(t).toContain("판매량 아님");
    expect(t.endsWith(`(${BUSINESS_NOTE})`)).toBe(true);
  });
  it("quarter not disclosed yet is said so, never guessed", () => {
    expect(businessContext("2026-11-20", ctx)).toContain(
      "2026-Q4 매출: 공시 전",
    );
  });
  it("missing year-ago quarter gives N/A, not 0", () => {
    const t = businessContext("2026-09-01", {
      ...ctx,
      finRows: [rev(2026, 3, 55e12)],
    });
    expect(t).toContain("전년 동기 비교 N/A");
  });
  it("nothing connected → empty (the line stays 미작성)", () => {
    expect(businessContext("2026-09-15", null)).toBe("");
    expect(
      businessContext("2026-09-15", { companies: [], finRows: [], share: [] }),
    ).toBe("");
  });
});
