import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { coachExportSchema } from "../../src/lib/connectors/coach-export";
import {
  joinSheetChunks,
  parseCsv,
  sheetCsvUrl,
  sheetIdFrom,
} from "../../src/lib/connectors/sheet-source";
import { sha256 } from "../../src/features/coach-data/store";

/**
 * Runs the real tools/apps-script/coach-ga-export/Code.gs in a sandbox with
 * mocked Google services and synthetic GA responses (no network, no IDs).
 */
type Req = {
  dimensions?: { name: string }[];
  dimensionFilter: unknown;
  dateRanges: { startDate: string }[];
};
function sandbox(answer: (req: Req) => unknown) {
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
        getProperty: (k: string) => (k === "GA_PROPERTY_ID" ? "1234567" : null),
      }),
    },
    AnalyticsData: { Properties: { runReport: (req: Req) => answer(req) } },
    Session: { getScriptTimeZone: () => "Asia/Seoul" },
    Utilities: {
      formatDate: (d: Date, _tz: string, f: string) => {
        const iso = new Date(d.getTime() + 9 * 3600e3).toISOString();
        return f === "yyyy"
          ? iso.slice(0, 4)
          : f === "MM"
            ? iso.slice(5, 7)
            : iso.slice(0, 10);
      },
      computeDigest: (_a: unknown, text: string) =>
        [...createHash("sha256").update(text, "utf8").digest()].map((b) =>
          b > 127 ? b - 256 : b,
        ),
      DigestAlgorithm: { SHA_256: "SHA_256" },
      Charset: { UTF_8: "UTF_8" },
    },
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
  vm.runInContext(
    readFileSync("tools/apps-script/coach-ga-export/Code.gs", "utf8"),
    ctx,
  );
  return { ctx, sheets };
}
const row = (key: string | null, ...values: number[]) => ({
  ...(key === null ? {} : { dimensionValues: [{ value: key }] }),
  metricValues: values.map((v) => ({ value: String(v) })),
});
const filterText = (r: Req) => JSON.stringify(r.dimensionFilter);
/** Synthetic GA: no REPORT rows in the latest period (missing, not zero). */
function syntheticGa(req: Req) {
  const dim = req.dimensions?.[0]?.name;
  const f = filterText(req);
  const latest = req.dateRanges[0].startDate >= "2026-11-18";
  const meta = {
    timeZone: "Asia/Seoul",
    subjectToThresholding: dim === "countryId",
  };
  if (f.includes("GALAXY_COACH_REPORT") && latest)
    return { rows: [], rowCount: 0, metadata: meta };
  if (!dim) {
    if (f.includes("screen_view"))
      return { rows: [row(null, 1000, 4000)], rowCount: 1, metadata: meta };
    if (f.includes("SIMULATION"))
      return { rows: [row(null, 400, 900)], rowCount: 1, metadata: meta };
    return { rows: [row(null, 300, 620)], rowCount: 1, metadata: meta };
  }
  if (dim === "customEvent:nsp_value")
    return {
      rows: [
        row("5", 240),
        row("4", 200),
        row("3", 100),
        row("2", 40),
        row("1", 20),
        row("(not set)", 20),
      ],
      rowCount: 6,
      metadata: meta,
    };
  return {
    rows: [row(dim === "countryId" ? "XA" : "switcher", 10, 20)],
    rowCount: 2,
    metadata: meta,
  };
}

describe("Apps Script exporter (Code.gs) ↔ PM.zip contract", () => {
  it("builds a valid coach-ga4-1.2 export: missing stays null, scores split, quality kept", () => {
    const { ctx } = sandbox(syntheticGa);
    const data = vm.runInContext(
      `buildExport_([{startDate:'2026-10-01',endDate:'2026-10-31'},{startDate:'2026-11-18',endDate:'2026-11-24'}])`,
      ctx,
    );
    const file = coachExportSchema.parse(JSON.parse(JSON.stringify(data)));
    const [oct, latest] = file.periods;
    expect(oct.totals.done).toEqual({ users: 300, count: 620 });
    expect(oct.scores).toEqual({
      "1": 20,
      "2": 40,
      "3": 100,
      "4": 200,
      "5": 240,
    });
    expect(oct.invalidScores).toEqual([{ value: "(not set)", count: 20 }]);
    expect(oct.quality.thresholded).toBe(true);
    expect(oct.quality.truncated).toBe(true); // rowCount 2 > 1 returned row
    expect(latest.totals.done).toEqual({ users: null, count: null });
    expect(latest.scores["5"]).toBeNull();
    expect(file.propertyTimeZone).toBe("Asia/Seoul");
    expect(JSON.stringify(file)).not.toContain("1234567");
  });
  it("writes sheet chunks that PM.zip reassembles and verifies (via CSV)", async () => {
    const { ctx, sheets } = sandbox(syntheticGa);
    vm.runInContext(
      `CHUNK_SIZE = 500; defaultPeriods_ = function(){ return [{startDate:'2026-10-01',endDate:'2026-10-31'}]; };`,
      ctx,
    );
    vm.runInContext("exportToSheet()", ctx);
    const rows = sheets.get("pmzip_export")!;
    expect(rows.length).toBeGreaterThan(3);
    expect(sheets.get("pmzip_summary")![1].slice(0, 9)).toEqual([
      "2026-10-01",
      "2026-10-31",
      "1000",
      "4000",
      "400",
      "900",
      "300",
      "620",
      "600",
    ]);
    // Same shape as gviz CSV output: every value quoted, "" escapes.
    const csv = rows.map((r) => `"${r[0].replaceAll('"', '""')}"`).join("\n");
    const text = await joinSheetChunks(parseCsv(csv), sha256);
    expect(
      coachExportSchema.parse(JSON.parse(text)).periods[0].totals.main.users,
    ).toBe(1000);

    const missing = rows.filter((_, i) => i !== 2);
    await expect(
      joinSheetChunks(
        missing.map((r) => [r[0]]),
        sha256,
      ),
    ).rejects.toThrow("불완전");
    const flip = (c: string) =>
      c.slice(0, 5) + (c[5] === "x" ? "y" : "x") + c.slice(6);
    const tampered = rows.map((r, i) => (i === 1 ? [flip(r[0])] : r));
    await expect(joinSheetChunks(tampered, sha256)).rejects.toThrow("검증값");
    // Missing tab: Google returns the first tab instead → explain and show it.
    await expect(joinSheetChunks([["이름", "값"]], sha256)).rejects.toThrow(
      '시트에 pmzip_export 탭이 없거나 PM.zip 내보내기 형식이 아닙니다. Apps Script에서 내보내기 함수를 실행했는지, 탭 이름이 정확히 pmzip_export인지 확인해 주세요. (읽힌 첫 칸: "이름"',
    );
    await expect(joinSheetChunks([], sha256)).rejects.toThrow("비어 있음");
  });
});

describe("sheet source helpers", () => {
  it("extracts the ID from a URL and builds a read-only CSV URL", () => {
    const id = "abcdefghijklmnopqrstuvwxyz0123456789_-AB";
    expect(
      sheetIdFrom(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`),
    ).toBe(id);
    expect(sheetIdFrom(` ${id} `)).toBe(id);
    expect(() => sheetIdFrom("https://example.invalid/x")).toThrow();
    expect(sheetCsvUrl(id)).toBe(
      `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&headers=1&sheet=pmzip_export`,
    );
  });
  it("parses quoted CSV with commas, quotes and CRLF", () => {
    expect(parseCsv('"a,b","c""d"\r\n"e"\n')).toEqual([["a,b", 'c"d'], ["e"]]);
    expect(() => parseCsv('"open')).toThrow();
  });
});
