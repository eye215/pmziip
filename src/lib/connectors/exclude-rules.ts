import { z } from "zod";

/**
 * User-made exclusion rules for collected mail/Slack/calendar items.
 * Deterministic, case-insensitive "contains" matching; a domain rule matches
 * the sender domain or any subdomain. Matching items are kept as originals
 * but hidden and never proposed, like automated notifications.
 */
export const ruleFields = ["domain", "title", "body", "any"] as const;
export type RuleField = (typeof ruleFields)[number];
export const ruleFieldLabels: Record<RuleField, string> = {
  domain: "보낸 곳(도메인)",
  title: "제목",
  body: "본문",
  any: "제목·본문 어디든",
};
export const ruleModes = ["exclude", "include"] as const;
export type RuleMode = (typeof ruleModes)[number];
export const ruleModeLabels: Record<RuleMode, string> = {
  exclude: "이런 건 숨기기",
  include: "이 키워드 있는 것만 남기기",
};
export const ruleChannels = ["all", "gmail", "slack"] as const;
export type RuleChannel = (typeof ruleChannels)[number];
export const ruleChannelLabels: Record<RuleChannel, string> = {
  all: "메일·Slack 모두",
  gmail: "메일만",
  slack: "Slack만",
};
export const ruleSchema = z
  .object({
    id: z.uuid(),
    mode: z.enum(ruleModes).default("exclude"),
    channel: z.enum(ruleChannels).default("all"),
    field: z.enum(ruleFields),
    text: z
      .string()
      .trim()
      .min(2, "두 글자 이상 적어 주세요.")
      .max(100, "100자 이하로 적어 주세요."),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type ExcludeRule = z.infer<typeof ruleSchema>;

export type RuleInput = {
  title: string;
  body: string;
  /** Sender domain without "@", or null. */
  domain: string | null;
  /** Where it came from; pasted text (null) is never filtered. */
  channel?: "gmail" | "slack" | "calendar" | null;
};

const norm = (s: string) => s.normalize("NFC").toLowerCase();

export function ruleMatches(rule: ExcludeRule, it: RuleInput): boolean {
  const t = norm(rule.text);
  if (rule.field === "domain") {
    const d = norm((it.domain ?? "").replace(/^@/, ""));
    const want = t.replace(/^@/, "");
    return !!d && (d === want || d.endsWith(`.${want}`));
  }
  if (rule.field === "title") return norm(it.title).includes(t);
  if (rule.field === "body") return norm(it.body).includes(t);
  return norm(it.title).includes(t) || norm(it.body).includes(t);
}

const applies = (r: ExcludeRule, it: RuleInput) =>
  !!it.channel && (r.channel === "all" || r.channel === it.channel);

/**
 * Why an item is hidden, or null to keep it:
 * - an exclude rule for its channel matches, or
 * - include rules exist for its channel and none of them matches.
 * Pasted text and calendar events are never filtered.
 */
export function excludedBy(
  rules: ExcludeRule[],
  it: RuleInput,
): { label: string } | null {
  if (!it.channel || it.channel === "calendar") return null;
  const mine = rules.filter((r) => applies(r, it));
  const ex = mine.find((r) => r.mode === "exclude" && ruleMatches(r, it));
  if (ex) return { label: ruleLabel(ex) };
  const inc = mine.filter((r) => r.mode === "include");
  if (inc.length && !inc.some((r) => ruleMatches(r, it)))
    return { label: "포함 키워드 없음" };
  return null;
}

export const ruleLabel = (r: ExcludeRule) =>
  `${r.mode === "include" ? "남기기 · " : ""}${r.channel === "all" ? "" : `${ruleChannelLabels[r.channel]} · `}${ruleFieldLabels[r.field]}: ${r.text}`;

/** Channel of a registered source for rule matching. */
export const channelOfSource = (sourceType: string) =>
  sourceType === "mail" ? "gmail" : sourceType === "slack" ? "slack" : null;

/** Sender domain kept on a registered source ("보낸 곳 x.com"). */
export const domainFromRole = (role: string) =>
  role.match(/^보낸 곳 (\S+)$/)?.[1] ?? null;
