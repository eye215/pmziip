import { z } from "zod";
import { parseCsv } from "./sheet-source";

/**
 * Mobile vendor market share by country and month (StatCounter Global
 * Stats, CC BY-SA 3.0, attribution required). Web-usage based share, NOT
 * sales or shipments. Written by tools/apps-script/coach-ga-export/
 * StatCounter.gs or converted from a downloaded StatCounter CSV.
 */
export const MARKET_FORMAT = "pmzip.market-share";
export const MARKET_TAB = "pmzip_statcounter";
export const MARKET_CHUNK_HEADER = "pmzip.market-share.chunks";
export const MARKET_ATTRIBUTION = "StatCounter Global Stats";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const countryCode = z
  .string()
  .regex(/^[A-Z]{2}$/, "국가 코드는 영문 대문자 2자리(ISO, 예: KR)입니다.");
const point = z
  .object({
    country: countryCode,
    month,
    vendor: z.string().min(1).max(80),
    /** Percent 0..100; null = not reported (never 0). */
    share: z.number().min(0).max(100).nullable(),
  })
  .strict();
export type SharePoint = z.infer<typeof point>;

export const marketFileSchema = z
  .object({
    format: z.literal(MARKET_FORMAT),
    formatVersion: z.literal(1),
    source: z.literal("statcounter"),
    metric: z.literal("mobile-vendor-share"),
    attribution: z.literal(MARKET_ATTRIBUTION),
    generatedAt: z.iso.datetime({ offset: true }),
    generator: z
      .object({ name: z.string().max(100), version: z.string().max(40) })
      .strict(),
    notes: z.array(z.string().max(500)).max(100),
    series: z.array(point).max(50000),
  })
  .strict()
  .superRefine((f, ctx) => {
    const seen = new Set<string>();
    for (const p of f.series) {
      const k = `${p.country}|${p.month}|${p.vendor}`;
      if (seen.has(k))
        ctx.addIssue({
          code: "custom",
          path: ["series"],
          message: `중복: ${k}`,
        });
      seen.add(k);
    }
  });
export type MarketFile = z.infer<typeof marketFileSchema>;

/**
 * Converts a StatCounter "Download Data" CSV (Date, Vendor1, Vendor2, …;
 * monthly dates like 2026-10) for one country into share points.
 */
export function parseStatCounterCsv(
  text: string,
  country: string,
): SharePoint[] {
  const code = countryCode.parse(country.trim().toUpperCase());
  const rows = parseCsv(text.replace(/^﻿/, "")).filter((r) =>
    r.some((c) => c.trim() !== ""),
  );
  const header = rows[0]?.map((h) => h.trim());
  if (!header || header[0]?.toLowerCase() !== "date" || header.length < 2)
    throw new Error(
      "StatCounter CSV 형식이 아닙니다. 첫 열이 Date여야 합니다.",
    );
  const out: SharePoint[] = [];
  for (const r of rows.slice(1)) {
    const m = r[0]?.trim().match(/^(\d{4})-(\d{2})/);
    if (!m)
      throw new Error(
        `월 형식이 아닌 날짜가 있습니다: ${r[0]} (월별 데이터로 받아 주세요)`,
      );
    header.slice(1).forEach((vendor, i) => {
      if (!vendor) return;
      const raw = (r[i + 1] ?? "").trim();
      const n = raw === "" ? null : Number(raw);
      if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100))
        throw new Error(`점유율 값이 올바르지 않습니다: ${vendor} ${raw}`);
      out.push({ country: code, month: `${m[1]}-${m[2]}`, vendor, share: n });
    });
  }
  if (!out.length) throw new Error("CSV에 데이터 행이 없습니다.");
  return out;
}

export type ShareRow = {
  country: string;
  month: string;
  share: number | null;
  yearAgo: number | null;
  /** Percentage-point change vs the same month a year earlier. */
  changePp: number | null;
};
const minusYear = (m: string) => `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`;

/** Latest month per country for one vendor, with a year-ago comparison. */
export function shareTable(points: SharePoint[], vendor: string): ShareRow[] {
  const byCountry = new Map<string, Map<string, number | null>>();
  for (const p of points) {
    if (p.vendor !== vendor) continue;
    const m = byCountry.get(p.country) ?? new Map<string, number | null>();
    m.set(p.month, p.share);
    byCountry.set(p.country, m);
  }
  return [...byCountry.entries()]
    .map(([country, months]) => {
      const latest = [...months.keys()].sort().at(-1)!;
      const share = months.get(latest) ?? null;
      const yearAgo = months.get(minusYear(latest)) ?? null;
      return {
        country,
        month: latest,
        share,
        yearAgo,
        changePp: share === null || yearAgo === null ? null : share - yearAgo,
      };
    })
    .sort((a, b) => a.country.localeCompare(b.country));
}

export function vendors(points: SharePoint[]): string[] {
  const total = new Map<string, number>();
  for (const p of points)
    total.set(p.vendor, (total.get(p.vendor) ?? 0) + (p.share ?? 0));
  return [...total.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}
