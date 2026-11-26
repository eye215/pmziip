import { describe, expect, it } from "vitest";
import type { RecordsState } from "../../src/features/records/model";
import { todayItems } from "../../src/features/report/home-flow";

// Synthetic records only; todayItems reads sources and initiatives.
const now = Date.parse("2026-11-26T00:00:00.000Z");
const day = (d: number) => new Date(now - d * 86_400_000).toISOString();
const state = {
  sources: [{ status: "inbox" }, { status: "inbox" }, { status: "linked" }],
  initiatives: [
    { status: "draft", createdAt: day(9), mergedInto: null, releasedAt: null },
    { status: "draft", createdAt: day(1), mergedInto: null, releasedAt: null },
    { status: "draft", createdAt: day(30), mergedInto: "x", releasedAt: null },
    {
      status: "released",
      createdAt: day(40),
      mergedInto: null,
      releasedAt: day(8),
    },
    {
      status: "released",
      createdAt: day(40),
      mergedInto: null,
      releasedAt: day(3),
    },
    {
      status: "released",
      createdAt: day(99),
      mergedInto: null,
      releasedAt: day(90),
    },
  ],
} as unknown as RecordsState;

describe("home today items", () => {
  it("counts only from records; merged drafts are ignored", () => {
    expect(todayItems(state, now)).toEqual({
      fresh: 2,
      drafts: 2,
      oldest: 9,
      due: 1,
    });
  });
  it("empty records give zeros, not N/A guesses", () => {
    expect(
      todayItems(
        { sources: [], initiatives: [] } as unknown as RecordsState,
        now,
      ),
    ).toEqual({ fresh: 0, drafts: 0, oldest: 0, due: 0 });
  });
});
