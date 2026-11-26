import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  PUBLIC_FIN_CHUNK_HEADER,
  publicFinSchema,
  quarterTable,
} from "../../src/lib/connectors/public-financials";
import {
  joinSheetChunks,
  parseCsv,
} from "../../src/lib/connectors/sheet-source";
import { sha256 } from "../../src/features/coach-data/store";
import {
  commitFin,
  finContent,
  latestFin,
  loadFin,
} from "../../src/features/public-financials/store";

// Synthetic company and amounts only. No real disclosure values or API key.
const KEY = "synthetic-test-key-not-real";
const CORP = "99999999";
type Item = Record<string, string>;
const item = (
  year: number,
  code: string,
  fs: string,
  account: string,
  amount: string,
  add = "",
): Item => ({
  rcept_no: `${year}0${code.slice(-2)}150000${fs === "CFS" ? "1" : "2"}`.padEnd(
    14,
    "0",
  ),
  reprt_code: code,
  bsns_year: String(year),
  corp_code: CORP,
  fs_div: fs,
  sj_div: "IS",
  account_nm: account,
  thstrm_amount: amount,
  thstrm_add_amount: add,
  currency: "KRW",
});
/** Revenue 100/110/120 (Q1..Q3), full year 460 → Q4 derived 130. Year-1 is 90/100/100/110. */
function dart(year: number, code: string) {
  const base = year === 2026 ? [100, 110, 120] : [90, 100, 100];
  const cum = (q: number) => base.slice(0, q).reduce((a, b) => a + b, 0);
  const q = { "11013": 1, "11012": 2, "11014": 3, "11011": 4 }[code]!;
  if (year === 2026 && q === 4)
    return { status: "013", message: "조회된 데이타가 없습니다." };
  const rev = (v: number) => `${v},000,000,000,000`;
  const annual = year === 2026 ? 460 : 400;
  const list =
    q === 4
      ? [
          item(year, code, "CFS", "매출액", rev(annual)),
          item(year, code, "CFS", "영업이익", rev(annual / 10)),
          item(year, code, "CFS", "매출원가", rev(1)),
        ]
      : [
          item(year, code, "CFS", "매출액", rev(base[q - 1]), rev(cum(q))),
          item(
            year,
            code,
            "CFS",
            "영업이익",
            rev(base[q - 1] / 10),
            rev(cum(q) / 10),
          ),
          item(year, code, "CFS", "당기순이익(손실)", "-", ""),
          item(
            year,
            code,
            "OFS",
            "매출액",
            rev(base[q - 1] / 2),
            rev(cum(q) / 2),
          ),
        ];
  return { status: "000", message: "정상", list };
}

function sandbox(fetchImpl: (url: string) => { code: number; body: unknown }) {
  const sheets = new Map<string, string[][]>();
  const urls: string[] = [];
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
          ({ DART_API_KEY: KEY, DART_CORP_CODE: CORP })[k] ?? null,
      }),
    },
    UrlFetchApp: {
      fetch: (url: string) => {
        urls.push(url);
        const r = fetchImpl(url);
        return {
          getResponseCode: () => r.code,
          getContentText: () => JSON.stringify(r.body),
        };
      },
    },
    Utilities: {
      formatDate: () => "2026",
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
  for (const f of ["Code.gs", "Dart.gs"])
    vm.runInContext(
      readFileSync(`tools/apps-script/coach-ga-export/${f}`, "utf8"),
      ctx,
    );
  return { ctx, sheets, urls };
}
const okDart = (url: string) => {
  const u = new URL(url);
  return {
    code: 200,
    body: dart(
      Number(u.searchParams.get("bsns_year")),
      u.searchParams.get("reprt_code")!,
    ),
  };
};

describe("Dart.gs exporter ↔ PM.zip contract", () => {
  it("exports reported Q1–Q3, derived Q4, null for missing, never the API key", async () => {
    const { ctx, sheets, urls } = sandbox(okDart);
    vm.runInContext("exportDartToSheet()", ctx);
    expect(urls).toHaveLength(12); // 3 years × 4 reports
    const rows = sheets.get("pmzip_dart")!;
    const csv = rows.map((r) => `"${r[0].replaceAll('"', '""')}"`).join("\n");
    const text = await joinSheetChunks(
      parseCsv(csv),
      sha256,
      PUBLIC_FIN_CHUNK_HEADER,
      "pmzip_dart",
    );
    expect(text).not.toContain(KEY);
    expect(JSON.stringify([...sheets.values()])).not.toContain(KEY);
    const file = publicFinSchema.parse(JSON.parse(text));
    const find = (y: number, q: number, a: string, fs = "CFS") =>
      file.rows.find(
        (r) =>
          r.year === y && r.quarter === q && r.account === a && r.fsDiv === fs,
      );
    expect(find(2026, 1, "revenue")?.amount).toBe(100e12);
    expect(find(2025, 4, "revenue")).toMatchObject({
      amount: 110e12,
      basis: "derived_q4",
    });
    expect(find(2026, 4, "revenue")).toBeUndefined(); // annual report not filed yet
    expect(find(2026, 1, "netIncome")?.amount).toBeNull(); // "-" is missing, not 0
    expect(file.rows.some((r) => r.accountName === "매출원가")).toBe(false);
    // OFS Q4 has no annual row in the synthetic data → absent, not invented.
    expect(find(2025, 4, "revenue", "OFS")).toBeUndefined();
    expect(sheets.get("pmzip_dart_summary")![0][0]).toBe("연도");
  });
  it("fails loudly on DART errors instead of writing partial data", () => {
    const { ctx, sheets } = sandbox(() => ({
      code: 200,
      body: { status: "020", message: "요청 제한을 초과하였습니다." },
    }));
    expect(() => vm.runInContext("exportDartToSheet()", ctx)).toThrow("020");
    expect(sheets.has("pmzip_dart")).toBe(false);
  });
});

describe("quarter table", () => {
  it("computes margin and YoY deterministically with N/A and missing", async () => {
    const { ctx } = sandbox(okDart);
    const file = publicFinSchema.parse(
      JSON.parse(JSON.stringify(vm.runInContext("buildDartExport_()", ctx))),
    );
    const t = quarterTable(file.rows, "CFS");
    expect(t[0].key).toBe("2026-Q3");
    const q1 = t.find((x) => x.key === "2026-Q1")!;
    expect(q1.operatingMargin.value).toBeCloseTo(0.1);
    expect(q1.revenueYoY.value).toBeCloseTo(100 / 90 - 1);
    expect(t.find((x) => x.key === "2024-Q1")!.revenueYoY).toEqual({
      value: null,
      reason: "missing",
    });
    const zero = structuredClone(file.rows).map((r) =>
      r.year === 2025 && r.quarter === 1 && r.account === "revenue"
        ? { ...r, amount: 0 }
        : r,
    );
    expect(
      quarterTable(zero, "CFS").find((x) => x.key === "2026-Q1")!.revenueYoY,
    ).toEqual({ value: null, reason: "denominator_zero" });
  });
  it("stores each distinct disclosure once (daily re-runs are not new data)", async () => {
    const { ctx } = sandbox(okDart);
    const file = publicFinSchema.parse(
      JSON.parse(JSON.stringify(vm.runInContext("buildDartExport_()", ctx))),
    );
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
    const s = {
      ownerId: "00000000-0000-4000-8000-000000000010",
      workspaceId: "00000000-0000-4000-8000-000000000001",
    };
    const rt = {
      id: () => "00000000-0000-4000-8000-000000000777",
      now: () => "2026-11-26T00:00:00.000Z",
    };
    const hash = await sha256(finContent(file));
    const saved = commitFin(storage, loadFin(storage, s), file, hash, s, rt)!;
    expect(saved.state.snapshots).toHaveLength(1);
    const rerun = { ...file, generatedAt: "2026-11-27T00:00:00.000Z" };
    const hash2 = await sha256(finContent(rerun));
    expect(
      commitFin(storage, loadFin(storage, s), rerun, hash2, s, rt),
    ).toBeNull();
    expect(latestFin(loadFin(storage, s).state)?.file.corpCode).toBe(CORP);
  });
});
