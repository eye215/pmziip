import {
  quarterTable,
  type FinRow,
} from "../../lib/connectors/public-financials";
import type { SharePoint } from "../../lib/connectors/market-share";
import type { SegmentEntry } from "../segment-fin/store";

/**
 * "비즈니스" line of a case study from PUBLIC sources only: the disclosed
 * quarterly revenue (DART) of the quarter the release fell in, and the
 * StatCounter mobile vendor share around the release month. Market context,
 * never the initiative's effect; nothing is inferred when a value is missing.
 */
export type PublicContext = {
  companies: { corpCode: string; corpName: string }[];
  finRows: FinRow[];
  share: SharePoint[];
  /** Current hand-entered public segment results (e.g. MX/네트워크). */
  segments?: SegmentEntry[];
};

export const BUSINESS_NOTE =
  "공개 자료 · 시장 맥락이며 이 과제의 효과로 단정하지 않음";
const SHARE_VENDOR = "Samsung";

function won(amount: number) {
  const abs = Math.abs(amount);
  if (abs >= 1e12) return `${(amount / 1e12).toFixed(1)}조원`;
  if (abs >= 1e8)
    return `${Math.round(amount / 1e8).toLocaleString("ko-KR")}억원`;
  return `${amount.toLocaleString("ko-KR")}원`;
}
const signed = (n: number, digits: number) =>
  `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n).toFixed(digits)}`;
function prevMonth(m: string) {
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
}

/** Segment line (MX first) for the release quarter; "" if not entered. */
function segmentPart(day: string, ctx: PublicContext) {
  const list = ctx.segments ?? [];
  if (!list.length) return "";
  const name =
    list.find((e) => e.segment.toUpperCase().includes("MX"))?.segment ??
    list[0].segment;
  const year = Number(day.slice(0, 4));
  const quarter = Math.ceil(Number(day.slice(5, 7)) / 3);
  const of = (y: number) =>
    list.find(
      (e) => e.segment === name && e.year === y && e.quarter === quarter,
    );
  const row = of(year);
  if (!row) return "";
  const prev = of(year - 1)?.revenue ?? null;
  const parts: string[] = [];
  if (row.revenue !== null) {
    const yoy =
      prev === null || prev === 0
        ? "전년 동기 비교 N/A"
        : `전년 동기 대비 ${signed(((row.revenue - prev) / Math.abs(prev)) * 100, 1)}%`;
    parts.push(`매출 ${won(row.revenue)}(${yoy})`);
  }
  if (row.operatingIncome !== null)
    parts.push(`영업이익 ${won(row.operatingIncome)}`);
  return `공개 실적 ${name} ${year}-Q${quarter} ${parts.join(", ")} · 출처 ${row.source}`;
}

function finPart(day: string, ctx: PublicContext) {
  const corp =
    ctx.companies.find((c) => c.corpName.includes("삼성전자")) ??
    ctx.companies[0];
  if (!corp) return "";
  const year = Number(day.slice(0, 4));
  const quarter = Math.ceil(Number(day.slice(5, 7)) / 3);
  const label = `${year}-Q${quarter}`;
  let basis = "연결";
  let table = quarterTable(ctx.finRows, "CFS", corp.corpCode);
  if (!table.length) {
    basis = "별도";
    table = quarterTable(ctx.finRows, "OFS", corp.corpCode);
  }
  if (!table.length) return "";
  const row = table.find((t) => t.year === year && t.quarter === quarter);
  if (!row || row.revenue === null)
    return `공시 ${corp.corpName} ${label} 매출: 공시 전`;
  const yoy =
    row.revenueYoY.value === null
      ? "전년 동기 비교 N/A"
      : `전년 동기 대비 ${signed(row.revenueYoY.value * 100, 1)}%`;
  return `공시 ${corp.corpName}(${basis}) ${label} 매출 ${won(row.revenue)}, ${yoy}${row.derived ? " (4분기는 연간−3분기 누적으로 계산)" : ""}`;
}

function sharePart(day: string, ctx: PublicContext) {
  const month = day.slice(0, 7);
  const before = prevMonth(month);
  const at = (country: string, m: string) =>
    ctx.share.find(
      (p) =>
        p.vendor === SHARE_VENDOR && p.country === country && p.month === m,
    )?.share ?? null;
  const countries = [
    ...new Set(
      ctx.share
        .filter((p) => p.vendor === SHARE_VENDOR && p.month === month)
        .map((p) => p.country),
    ),
  ]
    .sort((a, b) => (a === "KR" ? -1 : b === "KR" ? 1 : a.localeCompare(b)))
    .slice(0, 3);
  const parts = countries.flatMap((c) => {
    const now = at(c, month);
    if (now === null) return [];
    const prev = at(c, before);
    return [
      `${c} ${now.toFixed(1)}%${prev === null ? "" : ` (전월 대비 ${signed(now - prev, 1)}%p)`}`,
    ];
  });
  return parts.length
    ? `StatCounter 삼성 점유율(웹 사용 기준, 판매량 아님) ${month}: ${parts.join(", ")}`
    : "";
}

/** releaseDay: YYYY-MM-DD in the project time zone. "" when nothing applies. */
export function businessContext(releaseDay: string, ctx: PublicContext | null) {
  if (!ctx || !/^\d{4}-\d{2}-\d{2}$/.test(releaseDay)) return "";
  // The segment (MX) figure replaces company-wide revenue when entered.
  const parts = [
    segmentPart(releaseDay, ctx) || finPart(releaseDay, ctx),
    sharePart(releaseDay, ctx),
  ].filter(Boolean);
  return parts.length ? `${parts.join(" · ")} (${BUSINESS_NOTE})` : "";
}
