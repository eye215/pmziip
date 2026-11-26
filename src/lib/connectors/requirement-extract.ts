/**
 * Rule-based requirement candidate extraction (no AI). Deterministic: the
 * same text always yields the same candidates. Candidates are drafts — the
 * user confirms them before anything is saved, and the original text is kept.
 * Instructions written inside the text are never executed; it is only read.
 */
export const EXTRACT_VERSION = "req-rules-2";

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

// Teams copy-paste: "이름\n오후 2:11\n메시지", "[오후 2:11] 이름\n메시지",
// "Name, 2:11 PM\n message", plus "편집됨"/reaction noise. Headers are removed
// and each message becomes its own block. The original text is kept elsewhere.
const TIME =
  "(?:(?:\\d{4}\\.\\s?\\d{1,2}\\.\\s?\\d{1,2}\\.?|\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?|어제|오늘|yesterday|today|[월화수목금토일]요일|(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*)\\s*)?(?:(?:오전|오후)\\s?\\d{1,2}:\\d{2}|\\d{1,2}:\\d{2}(?:\\s?[AP]M)?)";
const TIME_ONLY = new RegExp(`^\\[?${TIME}\\]?$`, "i");
const TIME_NAME = new RegExp(`^\\[${TIME}\\]\\s*[^:：]{1,40}$`, "i");
const NAME_TIME = new RegExp(`^[^:：\\[,]{1,40},\\s*${TIME}$`, "i");
const NOISE =
  /^(편집됨|수정됨|edited|좋아요\s*\d*개?|like\s*\d*|\d+\s*(개의\s*)?(답글|회신|replies?)|답글\s*\d+개|회신\s*\d+개|has context menu|.*님이 .*(추가|제거|나갔|참가)했습니다\.?)$/i;

export function isTeamsPaste(text: string): boolean {
  let n = 0;
  for (const l of text.split("\n")) {
    const t = l.trim();
    if (TIME_ONLY.test(t) || TIME_NAME.test(t) || NAME_TIME.test(t)) n++;
  }
  return n >= 2;
}

export function normalizeTeamsPaste(text: string): string {
  const blocks: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length) blocks.push(cur.join("\n"));
    cur = [];
  };
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const t = line.trim();
    if (!t || NOISE.test(t)) continue;
    if (TIME_ONLY.test(t)) {
      // The line just before a bare time is the sender's name.
      if (cur.length && cur[cur.length - 1].length <= 40) cur.pop();
      flush();
      continue;
    }
    if (TIME_NAME.test(t) || NAME_TIME.test(t)) {
      flush();
      continue;
    }
    cur.push(t);
  }
  flush();
  return blocks.join("\n\n");
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
    // Korean endings without punctuation only split longer text, so a short
    // message like "다음 주까지 … 필요합니다" is not cut at "다음".
    for (const s of joined.split(
      joined.length > 120
        ? /(?<=[.!?。])\s+|(?<=(?:요|다|죠|음|함|됨)[.!]?)\s+(?=\S)/
        : /(?<=[.!?。])\s+/,
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
/**
 * Notification/footer boilerplate that is never a requirement even though it
 * contains words like "요청" or "추가" (Google Docs access mails, Figma/Jira
 * footers, unsubscribe lines), and units that are mostly a link.
 */
const BOILERPLATE =
  /문서의 소유자로서|액세스 권한을 (제공|부여)|님이 다음 문서에 대한 액세스|다음 문서에 대한 액세스를 요청|공동작업자 또는 뷰어로 추가|Google에서 보내는|알림 설정을 (변경|관리)하려면|알림을 받지 않으려면|수신\s?거부|발신 전용|unsubscribe|do ?not ?reply|you (are )?receiv(ed|ing) this|view in (figma|jira|notion|confluence)|open in (figma|docs|sheets|slides)|reply to this email|this email was sent|Google LLC|1600 Amphitheatre|이 (이메일|메일)은 .{0,40}(자동|발송)/i;

export function isBoilerplate(unit: string): boolean {
  if (BOILERPLATE.test(unit)) return true;
  const links = unit.match(/https?:\/\/\S+/g) ?? [];
  const linkChars = links.reduce((n, l) => n + l.length, 0);
  return linkChars > 0 && linkChars / unit.replace(/\s/g, "").length > 0.5;
}

export function extractCandidates(text: string): Candidate[] {
  const clean = cleanMessage(text);
  const units = splitUnits(
    isTeamsPaste(clean) ? normalizeTeamsPaste(clean) : clean,
  );
  const out: Candidate[] = [];
  units.forEach((unit, i) => {
    if (isBoilerplate(unit)) return;
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
