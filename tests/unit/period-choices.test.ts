import { describe, expect, it } from "vitest";
import { periodChoices } from "../../src/features/report/panel";

describe("report period chips", () => {
  it("second half appears from July", () => {
    expect(periodChoices("2026-11")).toEqual([
      { key: "month", label: "이번 달", from: "2026-11", to: "2026-11" },
      { key: "half", label: "하반기", from: "2026-07", to: "2026-11" },
      { key: "year", label: "올해", from: "2026-01", to: "2026-11" },
    ]);
  });
  it("January–June: no half chip (same as the year so far)", () => {
    expect(periodChoices("2026-03").map((p) => p.key)).toEqual([
      "month",
      "year",
    ]);
  });
});
