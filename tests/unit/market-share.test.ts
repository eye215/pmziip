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

describe("StatCounter.gs exporter ↔ PM.zip", () => {
  it("fetches each country once, skips failures with a note, round-trips via sheet", async () => {
    const urls: string[] = [];
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
          getProperty: (k: string) =>
            ({ STATCOUNTER_COUNTRIES: "xa, XB, XC" })[k] ?? null,
        }),
      },
      UrlFetchApp: {
        fetch: (url: string) => {
          urls.push(url);
          const code = new URL(url).searchParams.get("region_hidden");
          return {
            getResponseCode: () => (code === "XC" ? 404 : 200),
            getContentText: () =>
              code === "XA" ? XA : csv(["2026-10,10,80,10"]),
          };
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
    for (const f of ["Code.gs", "StatCounter.gs"])
      vm.runInContext(
        readFileSync(`tools/apps-script/coach-ga-export/${f}`, "utf8"),
        ctx,
      );
    vm.runInContext("exportStatCounterToSheet()", ctx);
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain("fromInt=202411");
    expect(urls[0]).toContain("toInt=202610");
    const rows = sheets.get("pmzip_statcounter")!;
    const text = await joinSheetChunks(
      parseCsv(rows.map((r) => `"${r[0].replaceAll('"', '""')}"`).join("\n")),
      sha256,
      MARKET_CHUNK_HEADER,
      "pmzip_statcounter",
    );
    const file = marketFileSchema.parse(JSON.parse(text));
    expect(file.attribution).toBe("StatCounter Global Stats");
    expect(file.notes).toEqual(["XC: HTTP 404 (건너뜀)"]);
    expect(shareTable(file.series, "VendorA").map((r) => r.country)).toEqual([
      "XA",
      "XB",
    ]);
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
