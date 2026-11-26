import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  MARKET_CHUNK_HEADER,
  marketFileSchema,
  parseStatCounterCsv,
  shareTable,
  vendors,
} from "../../src/lib/connectors/market-share";
import {
  joinSheetChunks,
  parseCsv,
} from "../../src/lib/connectors/sheet-source";
import { sha256 } from "../../src/features/coach-data/store";
import {
  commitMarket,
  latestPoints,
  loadMarket,
} from "../../src/features/market-share/store";

// Synthetic vendors, countries and shares only.
const csv = (rows: string[]) =>
  ['"Date","VendorA","VendorB","Other"', ...rows].join("\n");
const XA = csv([
  "2025-10,30.0,40.0,30.0",
  "2026-09,33.5,38.0,28.5",
  "2026-10,35.0,37.0,28.0",
]);

describe("StatCounter CSV", () => {
  it("parses monthly vendor shares; blank is null, not 0", () => {
    const p = parseStatCounterCsv("﻿" + csv(["2026-10,35.0,,65.0"]), "xa");
    expect(p).toEqual([
      { country: "XA", month: "2026-10", vendor: "VendorA", share: 35 },
      { country: "XA", month: "2026-10", vendor: "VendorB", share: null },
      { country: "XA", month: "2026-10", vendor: "Other", share: 65 },
    ]);
  });
  it("rejects wrong headers, daily dates, bad values and bad country codes", () => {
    expect(() => parseStatCounterCsv('"Vendor","Share"\nA,1', "XA")).toThrow(
      "Date",
    );
    expect(() =>
      parseStatCounterCsv(
        csv(["2026-10-05,1,2,3"]).replace("2026-10-05", "10/05/2026"),
        "XA",
      ),
    ).toThrow("월");
    expect(() => parseStatCounterCsv(csv(["2026-10,120,0,0"]), "XA")).toThrow();
    expect(() =>
      parseStatCounterCsv(csv(["2026-10,1,2,3"]), "Korea"),
    ).toThrow();
  });
  it("builds a latest-month table with year-ago %p change", () => {
    const points = parseStatCounterCsv(XA, "XA").concat(
      parseStatCounterCsv(csv(["2026-10,10,80,10"]), "XB"),
    );
    expect(vendors(points)[0]).toBe("VendorB");
    expect(shareTable(points, "VendorA")).toEqual([
      { country: "XA", month: "2026-10", share: 35, yearAgo: 30, changePp: 5 },
      {
        country: "XB",
        month: "2026-10",
        share: 10,
        yearAgo: null,
        changePp: null,
      },
    ]);
  });
});

describe("StatCounter.gs exporter ↔ PM.zip (resumable, many countries)", () => {
  /** Fake Apps Script world with a clock that advances 2 minutes per batch. */
  function world(
    countries: string,
    csvFor: (code: string) => { code: number; text: string },
  ) {
    const urls: string[] = [];
    const sheets = new Map<string, string[][]>();
    const sheet = (name: string) => ({
      clearContents: () => sheets.set(name, []),
      getDataRange: () => ({ getValues: () => sheets.get(name) ?? [] }),
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
          getProperty: (k: string) =>
            ({ STATCOUNTER_COUNTRIES: countries })[k] ?? null,
        }),
      },
      UrlFetchApp: {
        fetchAll: (reqs: { url: string }[]) => {
          vm.runInContext("__now += 120000", ctx);
          return reqs.map(({ url }) => {
            urls.push(url);
            const r = csvFor(new URL(url).searchParams.get("region_hidden")!);
            return {
              getResponseCode: () => r.code,
              getContentText: () => r.text,
            };
          });
        },
      },
      Utilities: {
        formatDate: (_d: Date, _tz: string, f: string) =>
          f === "yyyy" ? "2026" : "11",
        parseCsv: (t: string) => parseCsv(t),
        sleep: () => {},
        computeDigest: (_a: unknown, text: string) =>
          [...createHash("sha256").update(text, "utf8").digest()].map((b) =>
            b > 127 ? b - 256 : b,
          ),
        DigestAlgorithm: { SHA_256: "SHA_256" },
        Charset: { UTF_8: "UTF_8" },
      },
      Logger: { log: () => {} },
      Session: { getScriptTimeZone: () => "Asia/Seoul" },
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
      "var __now = Date.UTC(2026, 10, 26); Date.now = function () { return __now; };",
      ctx,
    );
    for (const f of ["Code.gs", "StatCounter.gs"])
      vm.runInContext(
        readFileSync(`tools/apps-script/coach-ga-export/${f}`, "utf8"),
        ctx,
      );
    vm.runInContext("SC_BATCH = 2; SC_RUN_START = Date.now();", ctx);
    const run = () => {
      vm.runInContext(
        "SC_RUN_START = Date.now(); exportStatCounterToSheet();",
        ctx,
      );
      const rows = sheets.get("pmzip_statcounter")!;
      return rows;
    };
    return { urls, sheets, run, ctx };
  }
  const many = (n: number) =>
    ['"Date",' + Array.from({ length: n }, (_, i) => `"V${i + 1}"`).join(",")]
      .concat(
        ["2025-10", "2026-10"].map((m) =>
          [
            m,
            ...Array.from({ length: n }, (_, i) =>
              (i < 2 ? 30 : 40 / (n - 2)).toFixed(2),
            ),
          ].join(","),
        ),
      )
      .join("\n");

  it("stops before the time limit, resumes next run, skips non-ISO codes", async () => {
    const w = world("KR, US, SQ, JP, JS, DE, FR, GB, IN, BR, MX, ID", (code) =>
      code === "BR" ? { code: 404, text: "" } : { code: 200, text: XA },
    );
    let rows = w.run();
    // 4.5 min budget, 2 min per batch → 3 batches × 2 countries.
    expect(w.urls).toHaveLength(6);
    const read = async (r: string[][]) =>
      marketFileSchema.parse(
        JSON.parse(
          await joinSheetChunks(
            parseCsv(
              r.map((x) => `"${x[0].replaceAll('"', '""')}"`).join("\n"),
            ),
            sha256,
            MARKET_CHUNK_HEADER,
            "pmzip_statcounter",
          ),
        ),
      );
    let file = await read(rows);
    expect(file.notes.join(" ")).toContain(
      "국가 코드가 아니어서 건너뜀: SQ, JS",
    );
    expect(file.notes.join(" ")).toContain("4개국은 다음 실행에서 이어서");
    expect(new Set(file.series.map((p) => p.country)).size).toBe(6);

    rows = w.run(); // fetches only the remaining 4, cached ones are fresh
    expect(w.urls).toHaveLength(10);
    file = await read(rows);
    expect(new Set(file.series.map((p) => p.country)).size).toBe(9);
    expect(file.notes.join(" ")).toContain("받지 못한 국가 1개: BR(HTTP 404)");
    expect(file.notes.join(" ")).not.toContain("다음 실행");
    w.run(); // only the failed country is retried; fresh ones are not refetched
    expect(w.urls).toHaveLength(11);
    expect(new URL(w.urls[10]).searchParams.get("region_hidden")).toBe("BR");
  });

  it("keeps the top 8 vendors and sums the rest into Other (null stays null)", async () => {
    const w = world("KR", () => ({ code: 200, text: many(12) }));
    const rows = w.run();
    const file = marketFileSchema.parse(
      JSON.parse(
        await joinSheetChunks(
          parseCsv(
            rows.map((x) => `"${x[0].replaceAll('"', '""')}"`).join("\n"),
          ),
          sha256,
          MARKET_CHUNK_HEADER,
          "pmzip_statcounter",
        ),
      ),
    );
    const oct = file.series.filter((p) => p.month === "2026-10");
    expect(oct).toHaveLength(9);
    expect(oct.at(-1)).toMatchObject({ vendor: "Other", share: 16 });
    const total = oct.reduce((a, p) => a + (p.share ?? 0), 0);
    expect(total).toBeCloseTo(100, 1);
  });
});

describe("market share store", () => {
  it("adds only new or changed values and keeps history", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
    const s = {
      ownerId: "00000000-0000-4000-8000-000000000010",
      workspaceId: "00000000-0000-4000-8000-000000000001",
    };
    const points = parseStatCounterCsv(XA, "XA");
    const a = commitMarket(
      storage,
      loadMarket(storage, s),
      points,
      "csv",
      s,
      "2026-11-01T00:00:00.000Z",
    );
    expect([a.added, a.unchanged]).toEqual([9, 0]);
    const b = commitMarket(
      storage,
      loadMarket(storage, s),
      points,
      "sheet",
      s,
      "2026-11-02T00:00:00.000Z",
    );
    expect([b.added, b.unchanged]).toEqual([0, 9]);
    const revised = points.map((p) =>
      p.month === "2026-10" && p.vendor === "VendorA"
        ? { ...p, share: 35.2 }
        : p,
    );
    const c = commitMarket(
      storage,
      loadMarket(storage, s),
      revised,
      "sheet",
      s,
      "2026-11-03T00:00:00.000Z",
    );
    expect(c.added).toBe(1);
    const state = loadMarket(storage, s).state;
    expect(state.points).toHaveLength(10);
    expect(shareTable(latestPoints(state), "VendorA")[0].share).toBe(35.2);
  });
});
