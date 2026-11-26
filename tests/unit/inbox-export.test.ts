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
