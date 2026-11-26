import type { QuarterRow } from "./public-financials";

/**
 * Plain-language (초등학생 눈높이) explanation of a quarterly table.
 * Deterministic rules only: every number comes from QuarterRow, nothing is
 * estimated, and causes are never guessed. An AI provider may later rewrite
 * the wording, but must keep these facts and be approved by the user.
 */
export type EasyMood = "better" | "worse" | "mixed" | "unknown";
export type EasyExplanation = {
  version: "easy-fin-1";
  period: string | null;
  mood: EasyMood;
  headline: string;
  sentences: string[];
  caution: string[];
};

export function won(v: number): string {
  const abs = Math.abs(v);
  const eok = abs / 1e8;
  const text =
    eok >= 10000
      ? `${(eok / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}조`
      : eok >= 100
        ? `${Math.round(eok).toLocaleString("ko-KR")}억`
        : eok >= 1
          ? `${eok.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억`
          : `${Math.round(abs / 1e4).toLocaleString("ko-KR")}만`;
  return `${text} 원`;
}
const pct = (v: number) =>
  `${Math.abs(v * 100).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`;
const label = (r: QuarterRow) => `${r.year}년 ${r.quarter}분기`;

/** table must be sorted newest first (quarterTable output). */
export function explainQuarters(table: QuarterRow[]): EasyExplanation {
  const caution = [
    "이 설명은 공시 숫자를 규칙에 따라 자동으로 풀어 쓴 것이에요. 왜 이렇게 됐는지(원인)는 숫자만으로는 알 수 없어요.",
  ];
  const latest = table.find((r) => r.revenue !== null);
  if (!latest)
    return {
      version: "easy-fin-1",
      period: null,
      mood: "unknown",
      headline: "아직 설명할 숫자가 없어요.",
      sentences: ["공시된 매출 숫자가 들어오면 쉽게 풀어서 알려 줄게요."],
      caution,
    };
  const s: string[] = [];
  s.push(
    `${label(latest)}에 회사가 물건이나 서비스를 팔아서 번 돈(매출)은 ${won(latest.revenue!)}이에요.`,
  );

  // Same quarter last year (avoids seasonal ups and downs).
  let revenueDir: 1 | -1 | 0 | null = null;
  if (latest.revenueYoY.value !== null) {
    const v = latest.revenueYoY.value;
    revenueDir = Math.abs(v) < 0.01 ? 0 : v > 0 ? 1 : -1;
    s.push(
      revenueDir === 0
        ? "1년 전 같은 때와 비교하면 거의 똑같이 팔았어요."
        : `1년 전 같은 때보다 ${pct(v)} ${revenueDir > 0 ? "더 많이" : "더 적게"} 팔았어요.`,
    );
  } else s.push("1년 전 같은 때의 숫자가 없어서 비교는 못 했어요.");

  const oi = latest.operatingIncome;
  let profitDir: 1 | -1 | 0 | null = null;
  if (oi !== null) {
    s.push(
      oi > 0
        ? `직원 월급, 재료비 같은 비용을 다 빼고도 ${won(oi)}이 남았어요. 이걸 '이익'이라고 해요.`
        : oi < 0
          ? `번 돈보다 쓴 돈이 더 많아서 ${won(oi)}만큼 손해를 봤어요. 이걸 '적자'라고 해요.`
          : "번 돈과 쓴 돈이 딱 같아서 남은 돈이 없었어요.",
    );
    if (latest.operatingMargin.value !== null && oi > 0)
      s.push(
        `100원어치를 팔면 약 ${Math.round(latest.operatingMargin.value * 100)}원이 남는 셈이에요.`,
      );
    const lastYear = table.find(
      (r) => r.year === latest.year - 1 && r.quarter === latest.quarter,
    );
    const prevOi = lastYear?.operatingIncome ?? null;
    if (prevOi !== null) {
      if (prevOi < 0 && oi > 0) {
        profitDir = 1;
        s.push("1년 전에는 손해였는데, 이번에는 돈이 남는 회사로 바뀌었어요.");
      } else if (prevOi > 0 && oi < 0) {
        profitDir = -1;
        s.push("1년 전에는 돈이 남았는데, 이번에는 손해로 바뀌었어요.");
      } else {
        profitDir = oi > prevOi ? 1 : oi < prevOi ? -1 : 0;
        s.push(
          profitDir === 0
            ? "남은 돈(또는 손해)은 1년 전과 비슷해요."
            : `1년 전 같은 때보다 ${oi > prevOi ? "형편이 나아졌어요" : "형편이 나빠졌어요"} (${won(prevOi)}${prevOi < 0 ? " 손해" : ""} → ${won(oi)}${oi < 0 ? " 손해" : ""}).`,
        );
      }
    }
  } else s.push("남은 돈(영업이익) 숫자는 아직 없어요.");

  // Trend over the latest four quarters with a year-ago comparison.
  const yoys = table
    .slice(0, 4)
    .map((r) => r.revenueYoY.value)
    .filter((v): v is number => v !== null);
  if (yoys.length >= 2) {
    const up = yoys.filter((v) => v > 0.01).length;
    const down = yoys.filter((v) => v < -0.01).length;
    s.push(
      up === yoys.length
        ? `최근 ${yoys.length}개 분기 모두 1년 전보다 더 많이 팔았어요. 꾸준히 커지는 중이에요.`
        : down === yoys.length
          ? `최근 ${yoys.length}개 분기 모두 1년 전보다 적게 팔았어요. 작아지는 중이에요.`
          : `최근 ${yoys.length}개 분기는 1년 전보다 많이 판 때도, 적게 판 때도 있어서 오르락내리락했어요.`,
    );
  }

  const mood: EasyMood =
    revenueDir === null && profitDir === null
      ? "unknown"
      : (revenueDir ?? 0) >= 0 &&
          (profitDir ?? 0) >= 0 &&
          (revenueDir === 1 || profitDir === 1)
        ? "better"
        : (revenueDir ?? 0) <= 0 &&
            (profitDir ?? 0) <= 0 &&
            (revenueDir === -1 || profitDir === -1)
          ? "worse"
          : "mixed";
  const headline = {
    better: "한마디로: 1년 전보다 좋아지고 있어요.",
    worse: "한마디로: 1년 전보다 어려워지고 있어요.",
    mixed: "한마디로: 좋아진 점과 나빠진 점이 섞여 있어요.",
    unknown: "한마디로: 비교할 숫자가 부족해요.",
  }[mood];
  if (latest.derived)
    caution.push(
      "4분기 숫자는 1년 전체 숫자에서 1~3분기를 빼서 계산한 값이에요.",
    );
  return {
    version: "easy-fin-1",
    period: label(latest),
    mood,
    headline,
    sentences: s,
    caution,
  };
}
