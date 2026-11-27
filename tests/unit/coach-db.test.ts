import { describe, expect, it } from "vitest";
import { dateOf, idOf, parseCollection } from "../../src/lib/coach-db/ejson";
import {
  defaultCoachDbConfig,
  normalizeAll,
  type Inputs,
} from "../../src/lib/coach-db/normalize";
import {
  countryMonthly,
  globalMonthly,
  metrics,
  qualityReport,
  versionMonthly,
} from "../../src/lib/coach-db/aggregate";
import { toCsv, toXlsx } from "../../src/lib/coach-db/export";

// Synthetic documents only (shapes follow the task spec, values invented).
const oid = (n: number) => ({ $oid: n.toString(16).padStart(24, "0") });
const d = (iso: string) => ({ $date: iso });
const users = [
  { _id: oid(1), personalData: { countryCode: "KR" } },
  { _id: oid(2), personalData: { countryCode: "us" } },
  { _id: oid(3), personalData: {} },
];
const voiceSessions = [
  // KR from session; completed via stage1
  {
    _id: oid(101),
    user: oid(1),
    createdAt: d("2026-07-31T15:30:00Z"),
    state: { countryCode: "KR" },
  },
  // no country on session → from user 2 (US); stage2 not completed
  {
    _id: oid(102),
    user: oid(2),
    createdAt: d("2026-07-10T00:00:00Z"),
    state: {},
  },
  // not mapped to any stage → 잠정 미완료; user 3 has no country → UNKNOWN
  { _id: oid(103), user: oid(3), createdAt: "2026-07-11T00:00:00Z", state: {} },
  // duplicate of 101 in another file
  {
    _id: oid(101),
    user: oid(1),
    createdAt: d("2026-07-31T15:30:00Z"),
    state: { countryCode: "KR" },
  },
];
const stageInfos = [
  {
    _id: oid(201),
    user: oid(1),
    state: {
      stage_info: {
        stage1: {
          session: oid(101),
          step: "completed",
          score: { $numberInt: "4" },
        },
        stage2: [{ session: oid(102), step: "in_progress" }],
      },
    },
  },
];
const salesInfos = [
  // completed with report
  {
    _id: oid(301),
    user: oid(1),
    createdAt: d("2026-08-02T01:00:00Z"),
    status: "completed",
    state: {
      sales_info: {
        session: "s-1",
        step: "report",
        report: { id: 1 },
        sales_case: "A",
        goal_complete: false,
      },
    },
  },
  // not completed, counts as entry; goal_complete true must be ignored
  {
    _id: oid(302),
    user: oid(1),
    createdAt: d("2026-08-03T01:00:00Z"),
    status: "progress",
    state: {
      sales_info: { session: "s-2", step: "talk", goal_complete: true },
    },
  },
  // completed but no report → mismatch, still completed
  {
    _id: oid(303),
    user: oid(2),
    createdAt: d("2026-08-31T20:00:00Z"),
    status: "completed",
    state: { sales_info: { session: "s-3", step: "report" } },
  },
  // missing session → excluded and logged
  {
    _id: oid(304),
    user: oid(2),
    createdAt: d("2026-08-04T01:00:00Z"),
    status: "completed",
    state: { sales_info: { step: "report" } },
  },
  // unknown user → UNKNOWN country, logged; deleted → not counted by default
  {
    _id: oid(305),
    user: oid(9),
    createdAt: d("2026-08-05T01:00:00Z"),
    status: "progress",
    deletedAt: d("2026-08-06T00:00:00Z"),
    state: { sales_info: { session: "s-5" } },
  },
];
const inputs: Inputs = { voiceSessions, stageInfos, salesInfos, users };

describe("Extended JSON", () => {
  it("reads $oid, $date and numbers; parses arrays or JSON lines", () => {
    expect(idOf(oid(255))).toBe("0000000000000000000000ff");
    expect(dateOf({ $date: { $numberLong: "1767225600000" } })).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    expect(dateOf("bad")).toBeNull();
    expect(parseCollection('{"a":1}\n{"a":2}\n')).toHaveLength(2);
    expect(parseCollection('[{"a":1}]')).toHaveLength(1);
    expect(() => parseCollection("{oops")).toThrow("1번째 줄");
  });
});

describe("Galaxy Coach DB sessions", () => {
  const out = normalizeAll(inputs, defaultCoachDbConfig);

  it("V1: one entry per voice session, completion from stages, country fallback", () => {
    const v1 = out.sessions.filter((s) => s.version === "V1");
    expect(
      v1.map((s) => [
        s.session_id.slice(-3),
        s.country_code,
        s.is_completed,
        s.completion_status,
      ]),
    ).toEqual([
      ["065", "KR", true, "completed"],
      ["066", "US", false, "in_progress"],
      ["067", "UNKNOWN", false, "unmapped"],
    ]);
    expect(v1[0].score).toBe(4);
    expect(out.issues.filter((i) => i.check === "세션 ID 중복")).toHaveLength(
      1,
    );
    expect(
      out.issues.filter((i) => i.check === "Stage Info 매핑 실패"),
    ).toHaveLength(1);
  });

  it("V2: session = entry, status decides, goal_complete ignored, issues logged", () => {
    const v2 = out.sessions.filter((s) => s.version === "V2");
    expect(
      v2.map((s) => [s.session_id, s.country_code, s.is_completed]),
    ).toEqual([
      ["s-1", "KR", true],
      ["s-2", "KR", false],
      ["s-3", "US", true],
      ["s-5", "UNKNOWN", false],
    ]);
    const checks = out.issues.map((i) => i.check);
    expect(checks).toContain("Sales Info session ID 누락");
    expect(checks).toContain("완료 상태와 리포트 불일치");
    expect(checks).toContain("사용자 ID 매핑 실패");
    // Deleted s-5 is in the session file but not counted.
    expect(out.counted.map((s) => s.session_id)).not.toContain("s-5");
  });

  it("rates are totals, N/A on zero denominators; users counted once", () => {
    const m = metrics(out.counted);
    expect(m).toMatchObject({
      entries: 6,
      completions: 3,
      incomplete: 3,
      entry_users: 3,
      completed_users: 2,
    });
    expect(m.session_completion_rate).toBe(50);
    expect(metrics([]).session_completion_rate).toBeNull();
    // Global is NOT the average of country rates.
    const kr = countryMonthly(out.counted).filter(
      (r) => r.country_code === "KR",
    );
    expect(kr.length).toBeGreaterThan(0);
  });

  it("month boundary follows the configured time zone (entry month)", () => {
    const utc = globalMonthly(out.counted).map((r) => [
      r.year_month,
      r.entries,
    ]);
    expect(utc).toEqual([
      ["2026-07", 3],
      ["2026-08", 3],
    ]);
    const kst = normalizeAll(inputs, {
      ...defaultCoachDbConfig,
      timeZone: "Asia/Seoul",
    });
    // 07-31T15:30Z is 08-01 in Seoul; 08-31T20:00Z is 09-01.
    expect(
      globalMonthly(kst.counted).map((r) => [r.year_month, r.entries]),
    ).toEqual([
      ["2026-07", 2],
      ["2026-08", 3],
      ["2026-09", 1],
    ]);
    expect(versionMonthly(out.counted).map((r) => r.version)).toEqual([
      "V1",
      "V2",
    ]);
  });

  it("same input in any order → same result", () => {
    const shuffled = normalizeAll(
      {
        ...inputs,
        voiceSessions: [...voiceSessions].reverse(),
        salesInfos: [...salesInfos].reverse(),
      },
      defaultCoachDbConfig,
    );
    expect(
      toCsv(globalMonthly(shuffled.counted), [
        "year_month",
        "entries",
        "completions",
      ]),
    ).toBe(
      toCsv(globalMonthly(out.counted), [
        "year_month",
        "entries",
        "completions",
      ]),
    );
    expect(shuffled.sessions.map((s) => s.session_id)).toEqual(
      out.sessions.map((s) => s.session_id),
    );
  });

  it("channel settings and quality report", () => {
    const q = qualityReport(
      out.sessions,
      out.counted,
      out.issues,
      defaultCoachDbConfig,
    );
    expect(q.find((r) => r.check === "V1·V2 기간 중첩")!.detail).toContain(
      "겹치지 않음",
    );
    expect(q.find((r) => r.check === "삭제된 데이터")!.count).toBe(1);
    const only = normalizeAll(inputs, {
      ...defaultCoachDbConfig,
      includeChannels: ["prod"],
    });
    expect(only.counted).toHaveLength(0); // no channel field → not in the list
  });

  it("CSV escapes; XLSX is a valid stored zip", () => {
    expect(toCsv([{ a: 'x,"y"' }], ["a"])).toBe('﻿a\r\n"x,""y"""\r\n');
    const z = toXlsx([
      { name: "global", rows: [{ a: 1, b: "가" }], columns: ["a", "b"] },
    ]);
    expect([...z.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const text = new TextDecoder().decode(z);
    expect(text).toContain("xl/worksheets/sheet1.xml");
    expect(text).toContain('<t xml:space="preserve">가</t>');
  });
});
