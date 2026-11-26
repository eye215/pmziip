import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fakeSpreadsheet } from "./fake-spreadsheet";
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
          channels: [{ id: "C0001", name: "pj-coach", is_member: true }],
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
  const fake = fakeSpreadsheet();
  const sheets = fake.grids;
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
      getActiveSpreadsheet: () => fake.ss,
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
  it("writes a status line (counts and reasons) to B1, and Slack errors do not stop mail", () => {
    const w = world({
      SLACK_BOT_TOKEN: TOKEN,
      SLACK_CHANNELS: "pj-coach, unknown-channel",
      INBOX_SHEET: "on",
      INBOX_CALENDAR_DAYS: "0",
    });
    const status = vm.runInContext("exportInboxToSheet()", w.ctx);
    // The channel list is refreshed first; typed names it does not contain are
    // not checked, so only the visible channel is read.
    expect(status).toBe(
      "Gmail 0건 (라벨 PMZIP, 최근 30일) · 캘린더 끔 · Slack 1건",
    );
    expect(w.sheets.get("pmzip_inbox")![0][1]).toContain(status);
    expect(w.sheets.get("pmzip_inbox")![0][1]).not.toContain(TOKEN);

    const bad = world({
      SLACK_BOT_TOKEN: TOKEN,
      SLACK_CHANNELS: "pj-coach",
      INBOX_SHEET: "on",
      INBOX_CALENDAR_DAYS: "0",
    });
    (bad.ctx.UrlFetchApp as { fetch: unknown }).fetch = () => ({
      getResponseCode: () => 200,
      getContentText: () =>
        JSON.stringify({ ok: false, error: "missing_scope" }),
    });
    const s2 = vm.runInContext("exportInboxToSheet()", bad.ctx);
    expect(s2).toContain("Slack 실패 — Slack auth.test: missing_scope");
    expect(bad.sheets.get("pmzip_inbox")![0][0]).toMatch(
      /^pmzip\.inbox-export\.chunks\|v1\|/,
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
  it("Slack channels as checkboxes (columns E–G) with bot membership; checked channels are read", () => {
    const w = world({
      SLACK_BOT_TOKEN: TOKEN,
      SLACK_CHANNELS: "pj-coach",
      INBOX_CALENDAR_DAYS: "0",
    });
    expect(vm.runInContext("pmzipRefreshSlackList_()", w.ctx)).toBe(2);
    const grid = w.sheets.get("pmzip_settings")!;
    const at = grid.findIndex((r) => r[4] === "Slack 채널 목록");
    expect(at).toBe(0); // row 1, beside the settings
    expect(grid.slice(1, 3).map((r) => [r[4], r[5], r[6]])).toEqual([
      ["pj-coach", "true", "봇 참여"],
      ["next-ai-team", "false", "초대 필요 (/invite)"],
    ]);
    // Settings in A–C are untouched by the Slack list.
    expect(grid[1][0]).toBe("Gmail 라벨");
    // Tick next-ai-team, untick pj-coach → only next-ai-team is read.
    grid[1][5] = "false";
    grid[2][5] = "TRUE";
    const file = inboxExportSchema.parse(
      JSON.parse(JSON.stringify(vm.runInContext("buildInboxExport_()", w.ctx))),
    );
    expect(file.items.map((i) => i.title)).toEqual([
      "[#next-ai-team] 기획서 (https://example.invalid/doc) 확인 부탁드립니다",
    ]);
    // Gmail label list (A–C) and Slack list (E–G) do not overwrite each other.
    (w.ctx.GmailApp as Record<string, unknown>).getUserLabels = () =>
      ["PMZIP", "고객요청", "a", "b", "c", "d", "e", "f"].map((n) => ({
        getName: () => n,
      }));
    vm.runInContext("pmzipRefreshLabelList_()", w.ctx);
    vm.runInContext("pmzipRefreshSlackList_()", w.ctx);
    const g2 = w.sheets.get("pmzip_settings")!;
    expect(g2.filter((r) => r[4] === "Slack 채널 목록")).toHaveLength(1);
    expect(g2.filter((r) => r[0] === "Gmail 라벨 목록")).toHaveLength(1);
    expect(g2[2][5]).toBe("true"); // check kept
  });
  it("saving a Slack pick keeps only visible channels and lists ones needing /invite", () => {
    const w = world({
      SLACK_BOT_TOKEN: TOKEN,
      INBOX_CALENDAR_DAYS: "0",
    });
    for (const f of ["Menu.gs"])
      vm.runInContext(
        readFileSync(`tools/apps-script/coach-ga-export/${f}`, "utf8"),
        w.ctx,
      );
    const msg = vm.runInContext(
      'pmzipSaveSlackPick(["#pj-coach", "next-ai-team", "없는채널"], false)',
      w.ctx,
    );
    expect(msg).toBe(
      "저장했습니다: pj-coach, next-ai-team\n\n봇 초대가 필요한 채널: #next-ai-team (각 채널에서 /invite @봇이름)",
    );
    const grid = w.sheets.get("pmzip_settings")!;
    expect(grid.find((r) => r[0] === "Slack 채널")![1]).toBe(
      "pj-coach, next-ai-team",
    );
    expect(JSON.stringify(grid)).not.toContain(TOKEN);
    expect(() =>
      vm.runInContext('pmzipSaveSlackPick(["없는채널"], false)', w.ctx),
    ).toThrow("하나 이상");
  });
  it("waits on 429 (Retry-After), lists channels once per run, and notes channels the bot is not in", () => {
    const w = world({
      SLACK_BOT_TOKEN: TOKEN,
      SLACK_CHANNELS: "pj-coach, next-ai-team",
      INBOX_SHEET: "on",
      INBOX_CALENDAR_DAYS: "0",
    });
    const slept: number[] = [];
    (w.ctx.Utilities as Record<string, unknown>).sleep = (ms: number) =>
      void slept.push(ms);
    const urls: string[] = [];
    let limited = false;
    (w.ctx.UrlFetchApp as { fetch: unknown }).fetch = (url: string) => {
      urls.push(url);
      const u = new URL(url);
      if (u.pathname.endsWith("conversations.history") && !limited) {
        limited = true;
        return {
          getResponseCode: () => 429,
          getHeaders: () => ({ "Retry-After": "2" }),
          getContentText: () => "",
        };
      }
      const body =
        u.pathname.endsWith("conversations.history") &&
        u.searchParams.get("channel") === "G0002"
          ? { ok: false, error: "not_in_channel" }
          : slack(url);
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify(body),
      };
    };
    const status = vm.runInContext("exportInboxToSheet()", w.ctx);
    expect(slept).toEqual([2500]);
    expect(status).toBe(
      "Gmail 0건 (라벨 PMZIP, 최근 30일) · 캘린더 끔 · Slack 1건 — 봇 초대 필요: #next-ai-team",
    );
    // Two list pages, fetched once for both the checkbox list and reading.
    expect(urls.filter((x) => x.includes("conversations.list"))).toHaveLength(
      2,
    );
    expect(urls.find((x) => x.includes("conversations.list"))).toContain(
      "limit=1000",
    );
  });
});
