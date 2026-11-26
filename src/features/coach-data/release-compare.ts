import {
  coachMetrics,
  type MetricValue,
} from "../../lib/connectors/coach-export";
import type { CoachSnapshot } from "./store";

/**
 * Before/after a release from imported GA periods (observations, not
 * causes). Uses only whole periods that lie entirely before or after the
 * release day: the 7-day windows and full calendar months the daily export
 * keeps. Missing stays missing; a zero base gives N/A, never 0.
 */
export type CompareWindow = {
  kind: "week" | "month";
  before: CoachSnapshot | null;
  after: CoachSnapshot | null;
};
export type Change =
  | {
      kind: "count";
      before: number | null;
      after: number | null;
      ratio: number | null;
    }
  | {
      kind: "rate";
      before: number | null;
      after: number | null;
      points: number | null;
    };
export type CompareRow = { key: string; label: string; change: Change };

const dayMs = 864e5;
const days = (a: string, b: string) =>
  Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / dayMs,
  );
const isWeek = (s: CoachSnapshot) =>
  days(s.period.startDate, s.period.endDate) === 6;
const isFullMonth = (s: CoachSnapshot) => {
  const { startDate, endDate } = s.period;
  if (
    !startDate.endsWith("-01") ||
    startDate.slice(0, 7) !== endDate.slice(0, 7)
  )
    return false;
  const next = new Date(`${endDate}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.getUTCDate() === 1;
};

/** `snapshots`: latest per period. `releaseDay`: YYYY-MM-DD in project time. */
export function releaseWindows(
  snapshots: CoachSnapshot[],
  releaseDay: string,
): CompareWindow[] {
  const pick = (
    list: CoachSnapshot[],
    beforeOk: (s: CoachSnapshot) => boolean,
    afterOk: (s: CoachSnapshot) => boolean,
  ) => {
    const before = list
      .filter(beforeOk)
      .sort((a, b) => b.period.endDate.localeCompare(a.period.endDate))[0];
    const after = list
      .filter(afterOk)
      .sort((a, b) => a.period.startDate.localeCompare(b.period.startDate))[0];
    return { before: before ?? null, after: after ?? null };
  };
  const month = releaseDay.slice(0, 7);
  return [
    {
      kind: "week" as const,
      ...pick(
        snapshots.filter(isWeek),
        (s) => s.period.endDate < releaseDay,
        (s) => s.period.startDate > releaseDay,
      ),
    },
    {
      kind: "month" as const,
      ...pick(
        snapshots.filter(isFullMonth),
        (s) => s.period.startDate.slice(0, 7) < month,
        (s) => s.period.startDate.slice(0, 7) > month,
      ),
    },
  ];
}

const rate = (v: MetricValue) => v.value;
function countChange(b: number | null, a: number | null): Change {
  return {
    kind: "count",
    before: b,
    after: a,
    ratio: b === null || a === null || b === 0 ? null : a / b - 1,
  };
}
function rateChange(b: number | null, a: number | null): Change {
  return {
    kind: "rate",
    before: b,
    after: a,
    points: b === null || a === null ? null : (a - b) * 100,
  };
}

export function compareRows(w: CompareWindow): CompareRow[] | null {
  if (!w.before || !w.after) return null;
  const b = coachMetrics(w.before.period);
  const a = coachMetrics(w.after.period);
  return [
    {
      key: "mainUsers",
      label: "진입 UU",
      change: countChange(b.mainUsers, a.mainUsers),
    },
    {
      key: "startCount",
      label: "시작 횟수",
      change: countChange(b.startCount, a.startCount),
    },
    {
      key: "doneCount",
      label: "완료(REPORT) 횟수",
      change: countChange(b.doneCount, a.doneCount),
    },
    {
      key: "userCompletionRate",
      label: "UU 완료율",
      change: rateChange(
        rate(b.userCompletionRate),
        rate(a.userCompletionRate),
      ),
    },
    {
      key: "countCompletionRate",
      label: "횟수 완료율",
      change: rateChange(
        rate(b.countCompletionRate),
        rate(a.countCompletionRate),
      ),
    },
    {
      key: "averageScore",
      label: "평균 점수(1~5)",
      // Score is not a rate; show the plain difference.
      change: {
        kind: "rate",
        before: rate(b.averageScore),
        after: rate(a.averageScore),
        points:
          rate(b.averageScore) === null || rate(a.averageScore) === null
            ? null
            : (rate(a.averageScore) as number) -
              (rate(b.averageScore) as number),
      },
    },
  ];
}

const pct = new Intl.NumberFormat("ko-KR", {
  style: "percent",
  maximumFractionDigits: 1,
});
const num = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });
const signed = (n: number, digits = 1) =>
  `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;

/** Display strings; null → "미집계", zero base → "N/A". */
export function formatChange(key: string, c: Change) {
  const isScore = key === "averageScore";
  const show = (v: number | null) =>
    v === null
      ? "미집계"
      : c.kind === "count" || isScore
        ? num.format(v)
        : pct.format(v);
  let delta: string;
  if (c.kind === "count")
    delta =
      c.ratio === null
        ? c.before === 0 && c.after !== null
          ? "N/A"
          : "미집계"
        : `${signed(c.ratio * 100)}%`;
  else
    delta =
      c.points === null
        ? "미집계"
        : isScore
          ? signed(c.points, 2)
          : `${signed(c.points)}%p`;
  return { before: show(c.before), after: show(c.after), delta };
}

/** One line for the case study's result, from the first comparable window. */
export function releaseSummary(windows: CompareWindow[]): string {
  for (const w of windows) {
    const rows = compareRows(w);
    if (!rows) continue;
    const r = rows.find((x) => x.key === "countCompletionRate")!;
    const f = formatChange(r.key, r.change);
    const name = w.kind === "week" ? "배포 전후 7일" : "배포 전후 월";
    return `${name} 횟수 완료율 ${f.before} → ${f.after} (${f.delta})`;
  }
  return "";
}
