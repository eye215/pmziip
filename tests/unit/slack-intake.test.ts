import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { inboxExportSchema } from "../../src/lib/connectors/inbox-export";
import { extractCandidates } from "../../src/lib/connectors/requirement-extract";
import {
  joinSheetChunks,
  parseCsv,
} from "../../src/lib/connectors/sheet-source";
import { sha256 } from "../../src/features/coach-data/store";

// Fake Slack Web API with synthetic messages; no token or workspace is real.
const TOKEN = "xoxb-synthetic-not-real";
function slack(url: string) {
  const u = new URL(url);
  const method = u.pathname.replace("/api/", "");
  const ok = (b: object) => ({ ok: true, ...b });
  if (method === "auth.test")
    return ok({ url: "https://synthetic.slack.com/" });
  if (method === "conversations.list")
    return u.searchParams.get("cursor")
      ? ok({
          channels: [{ id: "G0002", name: "next-ai-team" }],
          response_metadata: { next_cursor: "" },
        })
      : ok({
          channels: [{ id: "C0001", name: "pj-coach" }],
          response_metadata: { next_cursor: "p2" },
        });
  if (method === "conversations.history") {
    if (u.searchParams.get("channel") === "C0001")
      return ok({
        messages: [
          {
            ts: "1764000000.000100",
            text: "<@U1> 리포트에 국가별 필터를 추가해 주세요. 담당 a.b@example.invalid",
            reply_count: 1,
          },
          { ts: "1764000001.000200", text: "일간 통계 리포트", bot_id: "B1" },
          { ts: "1764000002.000300", subtype: "channel_join", text: "joined" },
        ],
      });
    return ok({
      messages: [
        {
          ts: "1764000003.000400",
          text: "<https://example.invalid/doc|기획서> 확인 부탁드립니다",
        },
      ],
    });
  }
  if (method === "conversations.replies")
    return ok({
      messages: [
        { ts: "1764000000.000100", text: "parent" },
        {
          ts: "1764000000.000500",
          text: "로그인 후 화면이 멈춤 현상도 있어요 010-1234-5678",
        },
        { ts: "1764000000.000600", text: "봇 응답", bot_id: "B1" },
      ],
    });
  return { ok: false, error: "unknown_method" };
}
function world(props: Record<string, string>) {
  const calls: { url: string; auth: string }[] = [];
  const sheets = new Map<string, string[][]>();
  const sheet = (name: string) => ({
    clearContents: () => sheets.set(name, []),
    getRange: () => {
      const r = {
        setNumberFormat: () => r,
        setValues: (rows: string[][]) =>
          void sheets.set(
            name,
            rows.map((x) => x.map(String)),
          ),
      };
      return r;
    },
  });
  const ctx: Record<string, unknown> = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => props[k] ?? null,
      }),
    },
    UrlFetchApp: {
      fetch: (url: string, opt: { headers: { Authorization: string } }) => {
        calls.push({ url, auth: opt.headers.Authorization });
        const body = slack(url);
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify(body),
        };
      },
    },
    GmailApp: { search: () => [] },
    CalendarApp: {
      getDefaultCalendar: () => ({ getId: () => "c", getEvents: () => [] }),
    },
    Utilities: {
      base64EncodeWebSafe: (s: string) => Buffer.from(s).toString("base64url"),
      computeDigest: (_a: unknown, t: string) =>
        [...createHash("sha256").update(t, "utf8").digest()].map((b) =>
          b > 127 ? b - 256 : b,
        ),
      DigestAlgorithm: { SHA_256: "SHA_256" },
      Charset: { UTF_8: "UTF_8" },
    },
    Session: { getScriptTimeZone: () => "Asia/Seoul" },
    Logger: { log: () => {} },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: sheet,
        insertSheet: sheet,
      }),
    },
    LockService: {
      getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }),
    },
  };
  vm.createContext(ctx);
  for (const f of ["Code.gs", "Inbox.gs", "Slack.gs"])
    vm.runInContext(
      readFileSync(`tools/apps-script/coach-ga-export/${f}`, "utf8"),
      ctx,
    );
  return { ctx, calls, sheets };
}

describe("Slack.gs intake", () => {
  it("collects human messages with thread replies from named channels", () => {
    const w = world({
      SLACK_BOT_TOKEN: TOKEN,
      SLACK_CHANNELS: "#pj-coach, next-ai-team",
      INBOX_CALENDAR_DAYS: "0",
    });
    const file = inboxExportSchema.parse(
      JSON.parse(JSON.stringify(vm.runInContext("buildInboxExport_()", w.ctx))),
    );
    expect(file.items.map((i) => i.channel)).toEqual(["slack", "slack"]);
    const [a, b] = file.items;
    expect(a.title).toBe(
      "[#pj-coach] @사용자 리포트에 국가별 필터를 추가해 주세요. 담당 a.b@example.invalid",
    );
    expect(a.body).toContain("멈춤 현상도 있어요");
    expect(a.body).not.toContain("일간 통계 리포트");
    expect(a.body).not.toContain("봇 응답");
    expect(a.link).toBe(
      "https://synthetic.slack.com/archives/C0001/p1764000000000100",
    );
    expect(b.body).toBe(
      "기획서 (https://example.invalid/doc) 확인 부탁드립니다",
    );
    expect(
      extractCandidates(`${a.title}\n\n${a.body}`).map((c) => c.type),
    ).toEqual(expect.arrayContaining(["request", "bug"]));
    expect(w.calls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true);
    expect(w.calls.some((c) => c.url.includes(TOKEN))).toBe(false); // token only in header
  });
  it("shared-sheet path masks e-mail and phone in Slack text, never writes the token", async () => {
    const w = world({
      SLACK_BOT_TOKEN: TOKEN,
      SLACK_CHANNELS: "pj-coach",
      INBOX_SHEET: "on",
      INBOX_CALENDAR_DAYS: "0",
    });
    vm.runInContext("exportInboxToSheet()", w.ctx);
    const rows = w.sheets.get("pmzip_inbox")!;
    const text = await joinSheetChunks(
      parseCsv(rows.map((r) => `"${r[0].replaceAll('"', '""')}"`).join("\n")),
      sha256,
      "pmzip.inbox-export.chunks",
      "pmzip_inbox",
    );
    expect(text).not.toContain("a.b@example.invalid");
    expect(text).not.toContain("010-1234-5678");
    expect(text).not.toContain(TOKEN);
    expect(inboxExportSchema.parse(JSON.parse(text)).items[0].body).toContain(
      "[전화번호]",
    );
  });
  it("does nothing without a token, and notes channels it cannot see", () => {
    const none = world({ INBOX_CALENDAR_DAYS: "0" });
    vm.runInContext("buildInboxExport_()", none.ctx);
    expect(none.calls).toHaveLength(0);
    const w = world({
      SLACK_BOT_TOKEN: TOKEN,
      SLACK_CHANNELS: "unknown-channel",
      INBOX_CALENDAR_DAYS: "0",
    });
    const r = vm.runInContext("slackItems_(10)", w.ctx);
    expect(r.items).toHaveLength(0);
    expect(r.notes[0]).toContain("unknown-channel");
  });
});
