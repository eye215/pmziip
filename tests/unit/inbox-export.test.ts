import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  inboxExportSchema,
  parseInboxExport,
} from "../../src/lib/connectors/inbox-export";
import { extractCandidates } from "../../src/lib/connectors/requirement-extract";

// Runs the real Inbox.gs with fake GmailApp / CalendarApp (synthetic data).
function run() {
  const msg = (id: string, subject: string, body: string, from: string) => ({
    getId: () => id,
    getSubject: () => subject,
    getPlainBody: () => body,
    getFrom: () => from,
    getDate: () => new Date("2026-11-25T01:00:00Z"),
  });
  const event = (id: string, title: string, desc: string) => ({
    getId: () => `${id}@google.com`,
    getTitle: () => title,
    getDescription: () => desc,
    getStartTime: () => new Date("2026-11-20T05:00:00Z"),
  });
  const searches: string[] = [];
  const ctx: Record<string, unknown> = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => ({ INBOX_GMAIL_LABEL: "PMZIP" })[k] ?? null,
      }),
    },
    GmailApp: {
      search: (q: string) => {
        searches.push(q);
        return [
          {
            getPermalink: () => "https://mail.google.com/mail/u/0/#all/t1",
            getMessages: () => [
              msg(
                "m1",
                "합성 요청",
                "필터를 추가해 주세요.",
                "합성 담당 <someone@example.invalid>",
              ),
            ],
          },
        ];
      },
    },
    CalendarApp: {
      getDefaultCalendar: () => ({
        getId: () => "me@example.invalid",
        getEvents: () => [
          event(
            "e1",
            "합성 회의",
            "<b>안건</b> 다음 주까지 속도 조절 기능 필요",
          ),
          event("e2", "점심", ""),
        ],
      }),
    },
    Utilities: {
      base64EncodeWebSafe: (s: string) =>
        Buffer.from(s).toString("base64url") + "==",
    },
  };
  vm.createContext(ctx);
  vm.runInContext(
    readFileSync("tools/apps-script/coach-ga-export/Inbox.gs", "utf8"),
    ctx,
  );
  return {
    data: JSON.parse(
      JSON.stringify(vm.runInContext("buildInboxExport_()", ctx)),
    ),
    searches,
  };
}

describe("Inbox.gs → PM.zip intake contract", () => {
  it("exports labelled mail and calendar notes; sender reduced to domain", () => {
    const { data, searches } = run();
    expect(searches).toEqual(['label:"PMZIP" newer_than:30d']);
    const file = inboxExportSchema.parse(data);
    expect(file.items.map((i) => i.channel)).toEqual(["gmail", "calendar"]);
    expect(file.items[0].fromDomain).toBe("@example.invalid");
    expect(JSON.stringify(file)).not.toContain("someone@");
    expect(JSON.stringify(file)).not.toContain("합성 담당");
    expect(file.items[1].body).not.toContain("<b>");
    expect(file.items[1].link).toMatch(
      /^https:\/\/www\.google\.com\/calendar\/event\?eid=[^=]+$/,
    );
    expect(file.items).toHaveLength(2); // event without notes skipped
  });
  it("parses the synthetic export and finds candidates per item", () => {
    const file = parseInboxExport(
      readFileSync("tests/fixtures/inbox-export.synthetic.json", "utf8"),
    );
    const counts = file.items.map(
      (i) => extractCandidates(`${i.title}\n\n${i.body}`).length,
    );
    expect(counts[0]).toBeGreaterThanOrEqual(2);
    expect(counts[1]).toBe(0);
    expect(counts[2]).toBeGreaterThanOrEqual(2);
    expect(() => parseInboxExport("{")).toThrow("JSON");
    const bad = JSON.parse(
      readFileSync("tests/fixtures/inbox-export.synthetic.json", "utf8"),
    );
    bad.items[0].link = "http://insecure.invalid";
    expect(() => inboxExportSchema.parse(bad)).toThrow();
  });
});

describe("Inbox.gs shared-sheet path (opt-in) reduces what is exposed", () => {
  it("cuts quotes/signatures, masks e-mail and phone, keeps domain only", async () => {
    const { createHash } = await import("node:crypto");
    const { joinSheetChunks, parseCsv } =
      await import("../../src/lib/connectors/sheet-source");
    const { sha256 } = await import("../../src/features/coach-data/store");
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
          getProperty: (k: string) => (k === "INBOX_SHEET" ? "on" : null),
        }),
      },
      GmailApp: {
        search: () => [
          {
            getPermalink: () => "https://mail.google.com/mail/u/0/#all/t1",
            getMessages: () => [
              {
                getId: () => "m1",
                getSubject: () => "합성 요청 (문의 someone@example.invalid)",
                getPlainBody: () =>
                  "필터를 추가해 주세요. 연락처 010-1234-5678, 메일 a.b@example.invalid\n--\n서명 줄\n> 이전 답장",
                getFrom: () => "합성 <someone@example.invalid>",
                getDate: () => new Date("2026-11-25T01:00:00Z"),
              },
            ],
          },
        ],
      },
      CalendarApp: {
        getDefaultCalendar: () => ({ getId: () => "c", getEvents: () => [] }),
      },
      Utilities: {
        base64EncodeWebSafe: (s: string) =>
          Buffer.from(s).toString("base64url"),
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
    for (const f of ["Code.gs", "Inbox.gs"])
      vm.runInContext(
        readFileSync(`tools/apps-script/coach-ga-export/${f}`, "utf8"),
        ctx,
      );
    vm.runInContext("exportInboxToSheet()", ctx);
    const rows = sheets.get("pmzip_inbox")!;
    const text = await joinSheetChunks(
      parseCsv(rows.map((r) => `"${r[0].replaceAll('"', '""')}"`).join("\n")),
      sha256,
      "pmzip.inbox-export.chunks",
      "pmzip_inbox",
    );
    const file = inboxExportSchema.parse(JSON.parse(text));
    const all = JSON.stringify(file);
    expect(all).not.toContain("@example.invalid>");
    expect(all).not.toContain("someone@");
    expect(all).not.toContain("010-1234-5678");
    expect(all).not.toContain("서명 줄");
    expect(all).not.toContain("이전 답장");
    expect(file.items[0].body).toContain("[전화번호]");
    expect(file.items[0].body).toContain("[이메일]");
    expect(file.items[0].title).toBe("합성 요청 (문의 [이메일])");
    expect(file.items[0].fromDomain).toBe("@example.invalid");
  });
});
