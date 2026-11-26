/**
 * Rule-based requirement candidate extraction (no AI). Deterministic: the
 * same text always yields the same candidates. Candidates are drafts — the
 * user confirms them before anything is saved, and the original text is kept.
 * Instructions written inside the text are never executed; it is only read.
 */
export const EXTRACT_VERSION = "req-rules-1";

export type CandidateType =
  "bug" | "request" | "change" | "decision" | "question";
export type Candidate = {
  /** Stable within one text: index of the unit it came from. */
  key: string;
  type: CandidateType;
  title: string;
  /** The exact unit of text the candidate is based on (evidence). */
  evidence: string;
  /** Matched rule words, for "why was this picked". */
  matched: string[];
  due: string | null;
  score: number;
};

export const typeNames: Record<CandidateType, string> = {
  bug: "오류",
  request: "요청",
  change: "변경",
  decision: "결정",
  question: "질문",
};

const RULES: { type: CandidateType; weight: number; words: RegExp[] }[] = [
  {
    type: "bug",
    weight: 3,
    words: [
      /오류/,
      /에러/,
      /버그/,
      /안\s?[돼됨되]/,
      /작동(하지|이 안|안)/,
      /실패/,
      /깨[져짐]/,
      /멈[춰춤]/,
      /튕[겨김]/,
      /느려/,
      /먹통/,
      /\berror\b/i,
      /\bbug\b/i,
      /\bcrash/i,
      /\bfail/i,
      /\bbroken\b/i,
    ],
  },
  {
    type: "change",
    weight: 2,
    words: [
      /변경/,
      /수정해/,
      /바꿔/,
      /교체/,
      /대신/,
      /\bchange\b/i,
      /\bupdate\b/i,
    ],
  },
  {
    type: "decision",
    weight: 2,
    words: [
      /확정/,
      /결정/,
      /합의/,
      /하기로\s?(했|함|하였)/,
      /정책/,
      /\bagreed\b/i,
      /\bdecided\b/i,
    ],
  },
  {
    type: "request",
    weight: 2,
    words: [
      /요청/,
      /요구/,
      /필요/,
      /추가/,
      /개선/,
      /반영/,
      /지원해/,
      /해\s?주[세시십]/,
      /부탁/,
      /했으면/,
      /하면 좋겠/,
      /좋겠습니다/,
      /원합니다/,
      /바랍니다/,
      /가능할까요/,
      /가능한지/,
      /검토\s?(부탁|해)/,
      /\bplease\b/i,
      /\brequest/i,
      /\bneed\b/i,
      /\bshould\b/i,
      /\bcould you\b/i,
      /\bwould like\b/i,
    ],
  },
  {
    type: "question",
    weight: 1,
    words: [/\?\s*$/, /문의/, /궁금/, /어떻게 (하|되)/],
  },
];

/** Removes quoted replies, forwarded headers and signatures. */
export function cleanMessage(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (
      /^-{2,}\s*(original message|원본 메시지|forwarded message|전달된 메시지)/i.test(
        t,
      ) ||
      /^on .+wrote:$/i.test(t) ||
      /^\d{4}[.-]\s?\d{1,2}[.-]\s?\d{1,2}.*(작성|wrote)/.test(t) ||
      /^(보낸 사람|from)\s*:/i.test(t) ||
      t === "--"
    )
      break;
    if (t.startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

/** Bullet lines and sentences; short noise is dropped. */
export function splitUnits(text: string): string[] {
  const units: string[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const bullet = /^([-*•·▪︎◦]|\d+[.)]|[①-⑳]|\[\s?\]|□|■)\s*/;
    if (lines.some((l) => bullet.test(l))) {
      for (const l of lines) units.push(l.replace(bullet, "").trim());
      continue;
    }
    // Chat logs: "이름: 메시지" / "[오후 2:10] 이름: 메시지" lines stay separate.
    if (
      lines.length > 1 &&
      lines.filter((l) => /^(\[.*?\]\s*)?[^:：]{1,20}[:：]\s/.test(l)).length >=
        lines.length / 2
    ) {
      for (const l of lines)
        units.push(l.replace(/^(\[.*?\]\s*)?[^:：]{1,20}[:：]\s*/, "").trim());
      continue;
    }
    const joined = lines.join(" ");
    for (const s of joined.split(
      /(?<=[.!?。])\s+|(?<=(?:요|다|죠|음|함|됨)[.!]?)\s+(?=\S)/,
    ))
      if (s.trim()) units.push(s.trim());
  }
  return units.filter((u) => u.replace(/\s/g, "").length >= 6);
}

const DUE = [
  /(\d{4})[-./](\d{1,2})[-./](\d{1,2})\s*(일)?\s*까지/,
  /(\d{1,2})\s*[/.월]\s*(\d{1,2})\s*일?\s*까지/,
  /(오늘|내일|모레|이번\s?주|금주|다음\s?주|차주|이번\s?달|다음\s?달|월말|주말|EOD)\s*(까지|중|내)?/i,
  /(\d{1,2})\s*일\s*까지/,
];
export function findDue(unit: string): string | null {
  for (const re of DUE) {
    const m = unit.match(re);
    if (m) return m[0].replace(/\s+/g, " ").trim();
  }
  return null;
}

function titleOf(unit: string) {
  const t = unit
    .replace(/\s+/g, " ")
    .replace(/^(re|fw|fwd)\s*:\s*/i, "")
    .trim();
  return t.length > 80 ? `${t.slice(0, 78)}…` : t;
}

/** Candidates in text order. Units without a matched rule are not candidates. */
export function extractCandidates(text: string): Candidate[] {
  const units = splitUnits(cleanMessage(text));
  const out: Candidate[] = [];
  units.forEach((unit, i) => {
    let best: { type: CandidateType; score: number } | null = null;
    let score = 0;
    const matched: string[] = [];
    for (const rule of RULES) {
      const hits = rule.words
        .map((re) => unit.match(re)?.[0])
        .filter((x): x is string => !!x);
      if (!hits.length) continue;
      matched.push(...hits.map((h) => h.trim()));
      score += rule.weight;
      if (!best || rule.weight > best.score)
        best = { type: rule.type, score: rule.weight };
    }
    if (!best) return;
    // A plain question with no request/bug words is weak; keep only if explicit.
    if (best.type === "question" && score < 1) return;
    out.push({
      key: `u${i}`,
      type: best.type,
      title: titleOf(unit),
      evidence: unit,
      matched: [...new Set(matched)].filter((w) => /[\p{L}\p{N}]/u.test(w)),
      due: findDue(unit),
      score,
    });
  });
  return out;
}
