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
import { explainQuarters } from "../../src/lib/connectors/easy-explain";
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
  if (u.pathname.endsWith("company.json"))
    return {
      code: 200,
      body: {
        status: "000",
        corp_name:
          u.searchParams.get("corp_code") === CORP ? "합성전자" : "합성에듀",
      },
    };
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
    expect(urls).toHaveLength(13); // company info + 3 years × 4 reports
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
    expect(sheets.get("pmzip_dart_summary")![0].slice(0, 2)).toEqual([
      "회사",
      "연도",
    ]);
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
    expect(
      latestFin(loadFin(storage, s).state)?.file.companies[0].corpCode,
    ).toBe(CORP);
  });
});

describe("multiple companies", () => {
  it("exports each corp code with its name and keeps rows separate", () => {
    const { ctx } = sandbox(okDart);
    vm.runInContext(
      `PropertiesService.getScriptProperties = function () { return { getProperty: function (k) { return { DART_API_KEY: '${KEY}', DART_CORP_CODE: '${CORP}, 99999998' }[k] || null; } }; };`,
      ctx,
    );
    const file = publicFinSchema.parse(
      JSON.parse(JSON.stringify(vm.runInContext("buildDartExport_()", ctx))),
    );
    expect(file.companies).toEqual([
      { corpCode: CORP, corpName: "합성전자" },
      { corpCode: "99999998", corpName: "합성에듀" },
    ]);
    expect(quarterTable(file.rows, "CFS", "99999998")[0].key).toBe("2026-Q3");
    expect(quarterTable(file.rows, "CFS", CORP)).toHaveLength(
      quarterTable(file.rows, "CFS", "99999998").length,
    );
  });
  it("rejects rows for a company that is not listed", () => {
    const f = JSON.parse(
      readFileSync("tests/fixtures/public-financials.synthetic.json", "utf8"),
    );
    f.companies = f.companies.slice(0, 1);
    expect(publicFinSchema.safeParse(f).success).toBe(false);
  });
});

describe("easy explanation (초등학생 눈높이, rule-based)", () => {
  const fixture = publicFinSchema.parse(
    JSON.parse(
      readFileSync("tests/fixtures/public-financials.synthetic.json", "utf8"),
    ),
  );
  it("explains growth and a loss-to-profit turn with numbers from the table", () => {
    const e = explainQuarters(quarterTable(fixture.rows, "OFS", "99999998"));
    expect(e.period).toBe("2026년 3분기");
    expect(e.mood).toBe("better");
    const text = e.sentences.join(" ");
    expect(text).toContain("번 돈(매출)은 40억 원");
    expect(text).toContain("1년 전 같은 때보다 29% 더 많이");
    expect(text).toContain("손해였는데, 이번에는 돈이 남는 회사로 바뀌었어요");
    expect(text).toContain("100원어치를 팔면 약 5원");
    expect(text).toContain("꾸준히 커지는 중");
    expect(e.caution.join(" ")).toContain("원인");
  });
  it("reports worse, missing comparison and no data without inventing values", () => {
    const rows = quarterTable(fixture.rows, "CFS", "99999999").map((r) =>
      r.key === "2026-Q3"
        ? { ...r, revenueYoY: { value: -0.2 }, operatingIncome: -5e9 }
        : r,
    );
    const worse = explainQuarters(rows);
    expect(worse.mood).toBe("worse");
    expect(worse.sentences.join(" ")).toContain("손해");
    const single = explainQuarters(
      quarterTable(fixture.rows, "CFS", "99999999").filter(
        (r) => r.key === "2025-Q1",
      ),
    );
    expect(single.sentences.join(" ")).toContain("비교는 못 했어요");
    expect(single.mood).toBe("unknown");
    expect(explainQuarters([]).headline).toContain("없어요");
  });
});

describe("findDartCorpCode (corpCode.zip without a zip content type)", () => {
  const xml = [
    "<result>",
    "<list><corp_code>99999999</corp_code><corp_name>합성전자</corp_name><corp_eng_name>SYN</corp_eng_name><stock_code>000001</stock_code><modify_date>20260101</modify_date></list>",
    "<list><corp_code>99999998</corp_code><corp_name>합성에듀</corp_name><stock_code>000002</stock_code></list>",
    "</result>",
  ].join("");
  function run(
    body: { zip: boolean; text?: string },
    stocks = "000001, 000002",
  ) {
    const logs: string[] = [];
    let retyped = "";
    const ctx: Record<string, unknown> = {
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: (k: string) =>
            ({ DART_API_KEY: KEY, DART_STOCK_CODE: stocks })[k] ?? null,
        }),
      },
      UrlFetchApp: {
        fetch: () => ({
          getResponseCode: () => 200,
          getContentText: () => body.text ?? "",
          getBlob: () => {
            const blob = {
              getBytes: () => (body.zip ? [0x50, 0x4b, 3, 4] : [0x3c, 0x3f]),
              setContentType: (t: string) => {
                retyped = t;
                return blob;
              },
            };
            return blob;
          },
        }),
      },
      Utilities: {
        // Mirrors Apps Script: refuses blobs that are not typed as zip.
        unzip: () => {
          if (retyped !== "application/zip")
            throw new Error(
              "잘못된 인수(ContentType)입니다. application/zip 형식이어야 합니다.",
            );
          return [{ getDataAsString: () => xml }];
        },
      },
      Logger: { log: (m: string) => void logs.push(m) },
    };
    vm.createContext(ctx);
    vm.runInContext(
      readFileSync("tools/apps-script/coach-ga-export/Dart.gs", "utf8"),
      ctx,
    );
    return {
      result: () => vm.runInContext("findDartCorpCode()", ctx) as string,
      logs,
    };
  }
  it("retypes the blob, finds each corp code and logs progress", () => {
    const r = run({ zip: true });
    expect(r.result()).toBe("99999999,99999998");
    expect(r.logs).toContain("000001 → 고유번호 99999999 (합성전자)");
    expect(r.logs.at(-1)).toBe("DART_CORP_CODE에 넣을 값: 99999999,99999998");
  });
  it("reports DART's error body instead of failing to unzip", () => {
    const r = run({
      zip: false,
      text: '<?xml version="1.0"?><result><status>010</status><message>등록되지 않은 키입니다.</message></result>',
    });
    expect(() => r.result()).toThrow("등록되지 않은 키입니다.");
  });
  it("names a stock code that is not listed", () => {
    expect(() => run({ zip: true }, "000003").result()).toThrow("000003");
  });
});
