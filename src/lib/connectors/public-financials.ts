import { z } from "zod";

/**
 * Public disclosure financials (DART OpenAPI fnlttSinglAcnt) written by
 * tools/apps-script/coach-ga-export/Dart.gs. Quarterly granularity only;
 * no country/product sales are available from disclosures.
 */
export const PUBLIC_FIN_FORMAT = "pmzip.public-financials";
export const PUBLIC_FIN_TAB = "pmzip_dart";
export const PUBLIC_FIN_CHUNK_HEADER = "pmzip.public-financials.chunks";
export const accounts = ["revenue", "operatingIncome", "netIncome"] as const;
export type Account = (typeof accounts)[number];

const corpCode = z.string().regex(/^\d{8}$/);
const rowSchema = z
  .object({
    corpCode,
    year: z.number().int().min(2000).max(2100),
    quarter: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    fsDiv: z.enum(["CFS", "OFS"]),
    account: z.enum(accounts),
    accountName: z.string().max(100),
    /** KRW; null = not disclosed / not derivable (never 0). */
    amount: z.number().finite().nullable(),
    basis: z.enum(["reported", "derived_q4"]),
    reportCode: z.enum(["11013", "11012", "11014", "11011"]),
    rceptNo: z.string().regex(/^\d{14}$/),
    currency: z.string().max(10),
  })
  .strict();
export type FinRow = z.infer<typeof rowSchema>;

export const publicFinSchema = z
  .object({
    format: z.literal(PUBLIC_FIN_FORMAT),
    formatVersion: z.literal(1),
    source: z.literal("dart-opendart-fnlttSinglAcnt"),
    companies: z
      .array(z.object({ corpCode, corpName: z.string().max(200) }).strict())
      .min(1)
      .max(20),
    generatedAt: z.iso.datetime({ offset: true }),
    generator: z
      .object({ name: z.string().max(100), version: z.string().max(40) })
      .strict(),
    unit: z.literal("KRW"),
    notes: z.array(z.string().max(500)).max(100),
    rows: z.array(rowSchema).max(2000),
  })
  .strict()
  .superRefine((f, ctx) => {
    const seen = new Set<string>();
    const corps = new Set(f.companies.map((c) => c.corpCode));
    if (corps.size !== f.companies.length)
      ctx.addIssue({
        code: "custom",
        path: ["companies"],
        message: "같은 회사가 중복됩니다.",
      });
    for (const r of f.rows) {
      if (!corps.has(r.corpCode))
        ctx.addIssue({
          code: "custom",
          path: ["rows"],
          message: `회사 목록에 없는 고유번호입니다: ${r.corpCode}`,
        });
      const k = `${r.corpCode}|${r.year}|${r.quarter}|${r.fsDiv}|${r.account}`;
      if (seen.has(k))
        ctx.addIssue({
          code: "custom",
          path: ["rows"],
          message: `같은 분기·계정이 중복됩니다: ${k}`,
        });
      seen.add(k);
    }
  });
export type PublicFinFile = z.infer<typeof publicFinSchema>;

type Ratio =
  { value: number } | { value: null; reason: "missing" | "denominator_zero" };
function ratio(n: number | null, d: number | null): Ratio {
  if (n === null || d === null) return { value: null, reason: "missing" };
  if (d === 0) return { value: null, reason: "denominator_zero" };
  return { value: n / d };
}

export type QuarterRow = {
  key: string;
  year: number;
  quarter: number;
  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  derived: boolean;
  rceptNos: string[];
  operatingMargin: Ratio;
  /** Year-over-year revenue change vs the same quarter last year. */
  revenueYoY: Ratio;
};

/** Deterministic quarterly table for one statement basis (연결 CFS / 별도 OFS). */
export function quarterTable(
  rows: FinRow[],
  fsDiv: "CFS" | "OFS",
  corpCode?: string,
): QuarterRow[] {
  const byKey = new Map<string, FinRow[]>();
  for (const r of rows) {
    if (r.fsDiv !== fsDiv) continue;
    if (corpCode !== undefined && r.corpCode !== corpCode) continue;
    const k = `${r.year}-Q${r.quarter}`;
    byKey.set(k, [...(byKey.get(k) || []), r]);
  }
  const value = (list: FinRow[], a: Account) =>
    list.find((r) => r.account === a)?.amount ?? null;
  const table = [...byKey.entries()].map(([key, list]) => ({
    key,
    year: list[0].year,
    quarter: list[0].quarter,
    revenue: value(list, "revenue"),
    operatingIncome: value(list, "operatingIncome"),
    netIncome: value(list, "netIncome"),
    derived: list.some((r) => r.basis === "derived_q4"),
    rceptNos: [...new Set(list.map((r) => r.rceptNo))],
  }));
  const find = (y: number, q: number) =>
    table.find((t) => t.year === y && t.quarter === q);
  return table
    .map((t) => {
      const prev = find(t.year - 1, t.quarter);
      return {
        ...t,
        operatingMargin: ratio(t.operatingIncome, t.revenue),
        revenueYoY:
          prev === undefined
            ? ({ value: null, reason: "missing" } as Ratio)
            : (() => {
                const r = ratio(
                  t.revenue === null || prev.revenue === null
                    ? null
                    : t.revenue - prev.revenue,
                  prev.revenue === null ? null : Math.abs(prev.revenue),
                );
                return r;
              })(),
      };
    })
    .sort((a, b) => b.year - a.year || b.quarter - a.quarter);
}
