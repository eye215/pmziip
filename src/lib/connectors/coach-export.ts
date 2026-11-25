import { z } from "zod";
import { coachDefinition } from "./coach-definition";

/**
 * File contract for `tools/apps-script/coach-ga-export.gs` output.
 * The bridge is a manual, read-only import path (ADR 0002): no GA credential,
 * property ID or Apps Script call reaches PM.zip.
 */
export const COACH_EXPORT_FORMAT = "pmzip.coach-ga-export";

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식이어야 합니다.");
/** null = GA returned no row (missing / not yet processed), distinct from 0. */
const count = z.number().int().nonnegative().nullable();
const pair = z.object({ users: count, count }).strict();
const breakdownRow = z
  .object({ key: z.string().max(200), users: count, count })
  .strict();
const breakdown = z
  .object({
    main: z.array(breakdownRow).max(1000),
    start: z.array(breakdownRow).max(1000),
    done: z.array(breakdownRow).max(1000),
  })
  .strict();
const quality = z
  .object({
    thresholded: z.boolean(),
    sampled: z.boolean(),
    dataLossFromOtherRow: z.boolean(),
    truncated: z.boolean(),
    notes: z.array(z.string().max(500)).max(50),
  })
  .strict();

export const coachPeriodSchema = z
  .object({
    startDate: day,
    endDate: day,
    totals: z.object({ main: pair, start: pair, done: pair }).strict(),
    /** REPORT events per customEvent:nsp_value; only 1..5 are valid scores. */
    scores: z
      .object({ "1": count, "2": count, "3": count, "4": count, "5": count })
      .strict(),
    invalidScores: z
      .array(
        z
          .object({
            value: z.string().max(200),
            count: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(200),
    byCountry: breakdown,
    bySalesCase: breakdown,
    quality,
  })
  .strict()
  .refine((p) => p.startDate <= p.endDate, "시작일이 종료일보다 늦습니다.");

export const coachExportSchema = z
  .object({
    format: z.literal(COACH_EXPORT_FORMAT),
    formatVersion: z.literal(1),
    definitionVersion: z.literal(coachDefinition.version),
    /** Echo of the query definition, checked against coachDefinition. */
    definition: z
      .object({
        mainEvent: z.string(),
        mainScreen: z.string(),
        startEvent: z.string(),
        doneEvent: z.string(),
        scoreDimension: z.string(),
        countryDimension: z.string(),
        salesCaseDimension: z.string(),
      })
      .strict(),
    generatedAt: z.iso.datetime({ offset: true }),
    generator: z
      .object({ name: z.string().max(100), version: z.string().max(40) })
      .strict(),
    /** GA property reporting time zone (date ranges are in this zone). */
    propertyTimeZone: z.string().max(64).nullable(),
    periods: z.array(coachPeriodSchema).min(1).max(400),
  })
  .strict()
  .superRefine((file, ctx) => {
    const expected = {
      mainEvent: coachDefinition.main.eventName,
      mainScreen: coachDefinition.main.screenName,
      startEvent: coachDefinition.start.eventName,
      doneEvent: coachDefinition.done.eventName,
      scoreDimension: coachDefinition.score.dimension,
      countryDimension: coachDefinition.countryDimension,
      salesCaseDimension: coachDefinition.salesCaseDimension,
    };
    for (const [key, value] of Object.entries(expected))
      if (file.definition[key as keyof typeof expected] !== value)
        ctx.addIssue({
          code: "custom",
          path: ["definition", key],
          message: `조회 정의가 ${coachDefinition.version}와 다릅니다 (${key}: ${value} 필요).`,
        });
    const seen = new Set<string>();
    for (const p of file.periods) {
      const k = `${p.startDate}/${p.endDate}`;
      if (seen.has(k))
        ctx.addIssue({
          code: "custom",
          path: ["periods"],
          message: `같은 기간이 중복됩니다: ${k}`,
        });
      seen.add(k);
    }
  });
export type CoachExport = z.infer<typeof coachExportSchema>;
export type CoachPeriod = z.infer<typeof coachPeriodSchema>;

/** Result of a deterministic metric: a number, or why it is not available. */
export type MetricValue =
  { value: number } | { value: null; reason: "missing" | "denominator_zero" };

function ratio(n: number | null, d: number | null): MetricValue {
  if (n === null || d === null) return { value: null, reason: "missing" };
  if (d === 0) return { value: null, reason: "denominator_zero" };
  return { value: n / d };
}
function sum(values: (number | null)[]): number | null {
  return values.some((v) => v === null)
    ? null
    : values.reduce<number>((a, v) => a + (v as number), 0);
}

export const coachMetricVersion = "coach-metrics-1";

/**
 * v1.2 §4.3 metrics for one period. Totals come only from the period-level
 * GA queries; country / sales case rows are never summed into totals.
 */
export function coachMetrics(p: CoachPeriod) {
  const { main, start, done } = p.totals;
  const s = [
    p.scores["1"],
    p.scores["2"],
    p.scores["3"],
    p.scores["4"],
    p.scores["5"],
  ];
  const validScoreCount = sum(s);
  const weighted =
    validScoreCount === null
      ? null
      : s.reduce<number>((a, n, i) => a + (n as number) * (i + 1), 0);
  return {
    version: coachMetricVersion,
    mainUsers: main.users,
    mainCount: main.count,
    startUsers: start.users,
    startCount: start.count,
    doneUsers: done.users,
    /** All GALAXY_COACH_REPORT events (not the sum of S1..S5). */
    doneCount: done.count,
    validScoreCount,
    /** REPORT events without a valid 1..5 score; negative means duplicate-looking data. */
    reportWithoutValidScore:
      done.count === null || validScoreCount === null
        ? null
        : done.count - validScoreCount,
    startRate: ratio(start.users, main.users),
    userCompletionRate: ratio(done.users, start.users),
    countCompletionRate: ratio(done.count, start.count),
    startsPerUser: ratio(start.count, start.users),
    completionsPerUser: ratio(done.count, done.users),
    averageScore: ratio(weighted, validScoreCount),
    highScoreRate: ratio(sum([p.scores["4"], p.scores["5"]]), validScoreCount),
    lowScoreRate: ratio(sum([p.scores["1"], p.scores["2"]]), validScoreCount),
    distribution: s.map((n) => ratio(n, validScoreCount)),
  };
}
export type CoachMetrics = ReturnType<typeof coachMetrics>;

/** Quality warnings shown with every imported period (v1.2 §4.4). */
export function coachWarnings(p: CoachPeriod): string[] {
  const m = coachMetrics(p);
  const out: string[] = [];
  if (p.quality.thresholded)
    out.push("GA 임계값이 적용되어 일부 행이 숨겨졌을 수 있습니다.");
  if (p.quality.sampled) out.push("샘플링된 결과입니다.");
  if (p.quality.dataLossFromOtherRow)
    out.push("일부 값이 (other) 행으로 묶였습니다.");
  if (p.quality.truncated)
    out.push("행 수 제한으로 일부 분류 결과가 잘렸습니다.");
  if (m.reportWithoutValidScore !== null && m.reportWithoutValidScore < 0)
    out.push(
      "유효 점수 건수가 REPORT 전체 횟수보다 많습니다. 중복 이벤트를 확인해 주세요.",
    );
  if (p.invalidScores.length)
    out.push(`1~5가 아닌 점수 값 ${p.invalidScores.length}종이 있습니다.`);
  const missing = [p.totals.main, p.totals.start, p.totals.done].some(
    (x) => x.users === null || x.count === null,
  );
  if (missing)
    out.push(
      "GA가 행을 반환하지 않은 값이 있습니다. 0이 아니라 미집계로 표시합니다.",
    );
  return out.concat(p.quality.notes);
}

/** Stable content key for duplicate detection (ignores generatedAt/generator). */
export function coachPeriodKey(p: CoachPeriod): string {
  return JSON.stringify(canonical(p));
}
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    );
  return v;
}
