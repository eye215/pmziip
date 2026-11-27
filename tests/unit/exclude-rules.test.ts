import { describe, expect, it } from "vitest";
import {
  domainFromRole,
  excludedBy,
  ruleSchema,
  type ExcludeRule,
} from "../../src/lib/connectors/exclude-rules";
import {
  addRule,
  loadRules,
  removeRule,
} from "../../src/features/intake/rules-store";

const rule = (field: ExcludeRule["field"], text: string, n = 1): ExcludeRule =>
  ruleSchema.parse({
    id: `00000000-0000-4000-8000-00000000090${n}`,
    field,
    text,
    createdAt: "2026-11-27T00:00:00.000Z",
  });
const mail = {
  title: "[합성] 주간 Newsletter",
  body: "합성 본문 수신거부",
  domain: "news.example.invalid",
  channel: "gmail" as const,
};

describe("exclusion rules", () => {
  it("matches case-insensitively by field; domain covers subdomains", () => {
    expect(excludedBy([rule("title", "newsletter")], mail)).not.toBeNull();
    expect(excludedBy([rule("title", "수신거부")], mail)).toBeNull();
    expect(excludedBy([rule("body", "수신거부")], mail)).not.toBeNull();
    expect(excludedBy([rule("any", "주간")], mail)).not.toBeNull();
    expect(
      excludedBy([rule("domain", "example.invalid")], mail),
    ).not.toBeNull();
    expect(
      excludedBy([rule("domain", "@example.invalid")], mail),
    ).not.toBeNull();
    expect(excludedBy([rule("domain", "ample.invalid")], mail)).toBeNull();
    expect(
      excludedBy([rule("domain", "example.invalid")], {
        ...mail,
        domain: null,
      }),
    ).toBeNull();
  });
  it("include keywords keep only matching items per channel", () => {
    const inc = (text: string, channel: "all" | "gmail" | "slack", n = 3) =>
      ruleSchema.parse({ ...rule("any", text, n), mode: "include", channel });
    const slack = {
      title: "",
      body: "합성 버튼 오류 제보",
      domain: null,
      channel: "slack" as const,
    };
    const chat = { ...slack, body: "점심 뭐 먹지" };
    const rules = [inc("오류", "slack"), inc("요청", "slack", 4)];
    expect(excludedBy(rules, slack)).toBeNull();
    expect(excludedBy(rules, chat)?.label).toBe("포함 키워드 없음");
    expect(excludedBy(rules, mail)).toBeNull(); // Slack-only rules skip mail
    // An exclude rule still wins inside the kept ones.
    expect(excludedBy([...rules, rule("body", "버튼")], slack)).not.toBeNull();
    // Pasted text and calendar are never filtered.
    expect(excludedBy(rules, { ...chat, channel: null })).toBeNull();
    expect(
      excludedBy([rule("title", "주간")], { ...mail, channel: "calendar" }),
    ).toBeNull();
  });
  it("rejects too short text; reads the domain kept on a source", () => {
    expect(
      ruleSchema.safeParse({ ...rule("title", "ab"), text: "a" }).success,
    ).toBe(false);
    expect(domainFromRole("보낸 곳 @example.invalid")).toBe("@example.invalid");
    expect(domainFromRole("")).toBeNull();
  });
  it("store: no duplicates, removable, workspace-scoped", () => {
    const m = new Map<string, string>();
    const st = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    };
    const s = {
      ownerId: "00000000-0000-4000-8000-000000000010",
      workspaceId: "00000000-0000-4000-8000-000000000001",
    };
    expect(addRule(st, s, rule("title", "뉴스레터", 1)).added).toBe(true);
    expect(addRule(st, s, rule("title", "뉴스레터", 2)).added).toBe(false);
    expect(loadRules(st, s).rules).toHaveLength(1);
    removeRule(st, s, "00000000-0000-4000-8000-000000000901");
    expect(loadRules(st, s).rules).toEqual([]);
    expect(() =>
      loadRules(st, {
        ...s,
        workspaceId: "00000000-0000-4000-8000-000000000099",
      }),
    ).not.toThrow(); // other key → empty, not mixed
  });
});
