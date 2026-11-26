import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

// Synthetic export only: no GA, Apps Script or company data is contacted.
const RECORDS_KEY =
  "pmzip:synthetic:v1:00000000-0000-4000-8000-000000000010:00000000-0000-4000-8000-000000000001";
const COACH_KEY =
  "pmzip:coach-ga:v1:00000000-0000-4000-8000-000000000010:00000000-0000-4000-8000-000000000001";
const fixture = () =>
  readFile("tests/fixtures/coach-export.synthetic.json", "utf8");

test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname))
      throw new Error("Unexpected external request: " + url.origin);
    await route.continue();
  });
});

async function openPanel(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Demo Coach", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "워크스페이스 메뉴" })
    .getByRole("button", { name: "설정", exact: true })
    .click();
  const panel = page.getByRole("region", { name: "Galaxy Coach GA 가져오기" });
  await expect(panel).toBeVisible();
  return panel;
}
async function noOverflow(page: Page) {
  const width = page.viewportSize()!.width;
  expect(
    await page.evaluate((w) => {
      const out: string[] = [];
      const range = document.createRange();
      const walker = document.createTreeWalker(
        document.querySelector("main")!,
        NodeFilter.SHOW_TEXT,
      );
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (
          !n.textContent?.trim() ||
          n.parentElement?.closest(".coach-table-wrap")
        )
          continue;
        range.selectNodeContents(n);
        const r = range.getBoundingClientRect();
        if (r.width && r.right > w + 0.5)
          out.push(n.textContent.trim().slice(0, 30));
      }
      return out;
    }, width),
  ).toEqual([]);
}

test("Coach GA export: validate, preview, approve, save once, reload", async ({
  page,
}) => {
  const panel = await openPanel(page);
  await panel.getByText("파일로 직접 가져오기", { exact: true }).click();
  const json = panel.getByLabel("내보내기 JSON 붙여넣기", { exact: true });
  const preview = panel.getByRole("button", {
    name: "GA 파일 미리보기",
    exact: true,
  });
  const recordsBefore = await page.evaluate(
    (k) => localStorage.getItem(k),
    RECORDS_KEY,
  );

  // Old completion event is rejected with a linked, focused message.
  const old = JSON.parse(await fixture());
  old.definition.doneEvent = "galaxy_coach_simulation_Done";
  await json.fill(JSON.stringify(old));
  await preview.click();
  const alert = panel.getByRole("alert");
  await expect(alert).toContainText("definition.doneEvent");
  await expect(alert).toBeFocused();
  await expect(json).toHaveAttribute("aria-invalid", "true");

  await json.fill(await fixture());
  await preview.click();
  await expect(
    panel.getByText("기간 2개 · 새로 저장 2개 · 중복 제외 0개 · 재수집 0개"),
  ).toBeVisible();
  const save = panel.getByRole("button", {
    name: "GA 기간 저장",
    exact: true,
  });
  await save.click();
  await expect(panel.getByRole("alert")).toContainText("확인해 주세요");
  expect(
    await page.evaluate((k) => localStorage.getItem(k), COACH_KEY),
  ).toBeNull();
  await panel.getByLabel("기간·조회 정의·품질 경고를 확인했습니다").check();
  await save.click();
  await expect(
    panel.getByText("GA 기간 2개를 저장했습니다. 중복 0개는 제외했습니다."),
  ).toBeVisible();
  await noOverflow(page);

  await expect(panel).toContainText("저장된 기간 2개");

  // Viewing happens in the 성과 tab.
  await panel.getByRole("button", { name: "성과 탭에서 보기" }).click();
  const coach = page.getByRole("region", { name: "Galaxy Coach 이용" });
  await expect(coach.getByLabel("기간")).toHaveValue(/.+/);
  await expect(coach.getByLabel("기간").locator("option:checked")).toHaveText(
    "2026년 10월",
  );
  await expect(coach.locator(".stat-row")).toContainText("진입 UU1,000");
  await expect(coach.locator(".stat-row")).toContainText("훈련 완료율 (UU)75%");
  await expect(coach.locator(".stat-row")).toContainText(
    "훈련 완료율 (횟수)68.9%",
  );
  await expect(coach).toContainText("GA 임계값");
  await expect(coach).toContainText("한 달 전체 기간이 2개 이상 쌓이면");
  await coach.getByText("2026년 10월 전체 지표").click();
  await expect(coach).toContainText("300 / 620");
  await expect(coach).toContainText("유효 점수(1~5) 건수600");
  await expect(coach).toContainText("점수 없는 REPORT20");
  await coach.getByText("국가·Sales Case별 이용 현황").click();
  await expect(coach.getByRole("table", { name: "국가별" })).toContainText(
    "XA",
  );
  await expect(coach).toContainText("합산하지 않습니다");
  await coach
    .getByLabel("기간")
    .selectOption({ label: "2026-11-01 ~ 2026-11-24" });
  await expect(coach.locator(".stat-row")).toContainText(
    "훈련 완료율 (UU)미집계",
  );
  await coach.getByText(/전체 지표$/).click();
  await expect(coach).toContainText("N/A (분모 0)");
  await noOverflow(page);
  await page
    .getByRole("navigation", { name: "워크스페이스 메뉴" })
    .getByRole("button", { name: "설정", exact: true })
    .click();

  // Records state is untouched; GA data lives under its own key.
  expect(await page.evaluate((k) => localStorage.getItem(k), RECORDS_KEY)).toBe(
    recordsBefore,
  );
  expect(
    await page.evaluate(
      (k) => JSON.parse(localStorage.getItem(k)!).snapshots.length,
      COACH_KEY,
    ),
  ).toBe(2);

  // Reload keeps data; identical re-import is skipped.
  await page.reload();
  const again = await openPanel(page);
  await again.getByText("파일로 직접 가져오기", { exact: true }).click();
  await expect(again).toContainText("저장된 기간 2개");
  await again
    .getByLabel("내보내기 JSON 붙여넣기", { exact: true })
    .fill(await fixture());
  await again
    .getByRole("button", { name: "GA 파일 미리보기", exact: true })
    .click();
  await expect(
    again.getByText("기간 2개 · 새로 저장 0개 · 중복 제외 2개 · 재수집 0개"),
  ).toBeVisible();
  await expect(
    again.getByRole("button", { name: "GA 기간 저장", exact: true }),
  ).toBeDisabled();

  // Backup of imported periods (sheet link is never included).
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    again
      .getByRole("button", { name: "GA 가져오기 기록 백업", exact: true })
      .click(),
  ]);
  const backup = await readFile((await download.path())!, "utf8");
  expect(JSON.parse(backup).snapshots).toHaveLength(2);
  expect(backup).not.toContain("sheetId");

  // Coach card shows the latest full month; other projects stay "미수집".
  await page
    .getByRole("navigation", { name: "워크스페이스 메뉴" })
    .getByRole("button", { name: "홈", exact: true })
    .click();
  const card = page.getByRole("article", {
    name: "Demo Coach 프로젝트",
    exact: true,
  });
  await expect(card.locator(".metrics")).toContainText("훈련 완료율 (UU)75%");
  // REPORT 620 / start count 900
  await expect(card.locator(".metrics")).toContainText(
    "훈련 완료율 (횟수)68.9%",
  );
  await expect(card).toContainText("GA 기간 2개 가져옴");
  await expect(card).not.toContainText("데이터 수집은 아직");
  await expect(card.locator(".metrics")).toContainText("평균 평가점수4");
  await expect(card).toContainText("GA 2026-10-01~2026-10-31");
  await expect(
    page
      .getByRole("article", { name: "Demo Survey 프로젝트", exact: true })
      .locator(".metrics"),
  ).toContainText("미수집");
  await noOverflow(page);
});

/** Same chunk layout as Code.gs exportToSheet, served like gviz CSV. */
async function sheetCsv() {
  const json = JSON.stringify(JSON.parse(await fixture()));
  const chunks: string[] = [];
  for (let i = 0; i < json.length; i += 700)
    chunks.push("|" + json.slice(i, i + 700) + "|");
  const hash = createHash("sha256").update(json, "utf8").digest("hex");
  return [`pmzip.coach-ga-export.chunks|v1|${chunks.length}|${hash}`, ...chunks]
    .map((c) => `"${c.replaceAll('"', '""')}"`)
    .join("\n");
}
const SHEET_ID = "SyntheticSheetId_0123456789abcdefghij";

test("linked sheet: connect, auto-sync once per visit, idempotent, failure keeps data", async ({
  page,
}) => {
  let status = 200;
  const requests: string[] = [];
  const body = await sheetCsv();
  await page.route("https://docs.google.com/**", async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      status,
      contentType: "text/csv",
      headers: { "access-control-allow-origin": "*" },
      body: status === 200 ? body : "not found",
    });
  });
  const panel = await openPanel(page);
  await panel
    .getByLabel("GA 스프레드시트 링크 또는 ID", { exact: true })
    .fill(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0`);
  await panel.getByRole("button", { name: "시트 연결", exact: true }).click();
  await expect(panel.getByRole("status").first()).toContainText("동기화 완료");
  await expect(panel).toContainText("새 기간 2개 · 재수집 0개 · 변경 없음 0개");
  await expect(panel).toContainText("저장된 기간 2개");
  expect(requests[0]).toBe(
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&headers=1&sheet=pmzip_export`,
  );
  await noOverflow(page);

  // Next visit syncs automatically; identical data adds nothing.
  const again = await openPanel(page);
  await expect(again).toContainText("새 기간 0개 · 재수집 0개 · 변경 없음 2개");
  expect(requests).toHaveLength(2);
  await expect(again).toContainText("저장된 기간 2개");

  // A failing fetch writes nothing and keeps saved periods.
  status = 404;
  await again.getByRole("button", { name: "지금 동기화", exact: true }).click();
  await expect(again.getByRole("alert")).toContainText("HTTP 404");
  await expect(again).toContainText("저장된 기간 2개");

  // Disconnect removes only the setting, not imported data.
  page.once("dialog", (d) => d.accept());
  await again
    .getByRole("button", { name: "시트 연결 해제", exact: true })
    .click();
  await expect(
    again.getByLabel("GA 스프레드시트 링크 또는 ID", { exact: true }),
  ).toBeVisible();
  await expect(again).toContainText("저장된 기간 2개");
});

const FIN_SHEET = "SyntheticFinSheet_0123456789abcdefghij";
async function finCsv() {
  const json = JSON.stringify(
    JSON.parse(
      await readFile("tests/fixtures/public-financials.synthetic.json", "utf8"),
    ),
  );
  const chunks: string[] = [];
  for (let i = 0; i < json.length; i += 900)
    chunks.push("|" + json.slice(i, i + 900) + "|");
  const hash = createHash("sha256").update(json, "utf8").digest("hex");
  return [
    `pmzip.public-financials.chunks|v1|${chunks.length}|${hash}`,
    ...chunks,
  ]
    .map((c) => `"${c.replaceAll('"', '""')}"`)
    .join("\n");
}

test("DART public financials: sheet sync, quarterly table, idempotent", async ({
  page,
}) => {
  const body = await finCsv();
  const tabs: string[] = [];
  await page.route("https://docs.google.com/**", async (route) => {
    tabs.push(new URL(route.request().url()).searchParams.get("sheet") || "");
    await route.fulfill({
      status: 200,
      contentType: "text/csv",
      headers: { "access-control-allow-origin": "*" },
      body,
    });
  });
  await openPanel(page);
  const fin = page.getByRole("region", { name: "공시 실적 (DART)" });
  await expect(fin).toContainText("아직 가져온 공시 실적이 없습니다.");
  await fin
    .getByLabel("공시 스프레드시트 링크 또는 ID", { exact: true })
    .fill(`https://docs.google.com/spreadsheets/d/${FIN_SHEET}/edit`);
  await fin
    .getByRole("button", { name: "공시 시트 연결", exact: true })
    .click();
  await expect(fin).toContainText("동기화 완료");
  await expect(fin).toContainText("새 공시 반영 · 35개 항목");
  expect(tabs).toEqual(["pmzip_dart"]);
  await expect(fin).toContainText("회사 2곳 · 35개 항목");
  await fin.getByRole("button", { name: "성과 탭에서 보기" }).click();
  const view = page.getByRole("region", { name: "공시 실적" });
  const companies = view.getByRole("group", { name: "회사" });
  await expect(
    companies.getByRole("button", { name: "합성전자" }),
  ).toHaveAttribute("aria-pressed", "true");
  const easy = view.getByRole("region", { name: /쉽게 보기/ });
  await expect(easy).toContainText("2026년 3분기");
  await expect(easy).toContainText("한마디로: 1년 전보다 좋아지고 있어요.");
  await expect(
    view.getByRole("img", { name: "합성전자 분기 매출" }),
  ).toBeVisible();
  await companies.getByRole("button", { name: "합성에듀" }).click();
  await expect(easy).toContainText("돈이 남는 회사로 바뀌었어요");
  await expect(view.getByLabel("재무제표 기준")).toHaveValue("OFS");
  await noOverflow(page);
  await companies.getByRole("button", { name: "합성전자" }).click();
  await view.getByText("분기 표 보기").click();
  const table = view.getByRole("table");
  const q1 = table.getByRole("row", { name: /2026 Q1/ });
  await expect(q1).toContainText("100조");
  await expect(q1).toContainText("10%");
  await expect(q1).toContainText("+11.1%");
  await expect(table.getByRole("row", { name: /2025 Q4\*/ })).toBeVisible();
  await expect(table.getByRole("row", { name: /2025 Q1/ })).toContainText("—");
  await expect(view).toContainText("인과관계로 해석하지 않습니다");
  await noOverflow(page);

  await openPanel(page);
  await expect(
    page.getByRole("region", { name: "공시 실적 (DART)" }),
  ).toContainText("변경 없음 · 35개 항목");
});

test("StatCounter CSV upload: share table with year-ago change and same-month Coach UU", async ({
  page,
}) => {
  const panel = await openPanel(page);
  // Import GA first so the Coach column (2026-10, country XA/XB) appears.
  await panel.getByText("파일로 직접 가져오기", { exact: true }).click();
  await panel
    .getByLabel("내보내기 JSON 붙여넣기", { exact: true })
    .fill(await fixture());
  await panel.getByRole("button", { name: "GA 파일 미리보기" }).click();
  await panel.getByLabel("기간·조회 정의·품질 경고를 확인했습니다").check();
  await panel.getByRole("button", { name: "GA 기간 저장" }).click();
  // Navigate only after the save finished (otherwise it can be interrupted).
  await expect(
    panel.getByText("GA 기간 2개를 저장했습니다. 중복 0개는 제외했습니다."),
  ).toBeVisible();
  await openPanel(page);

  const market = page.getByRole("region", {
    name: "국가별 제조사 점유율 (StatCounter)",
  });
  await expect(
    market.getByRole("link", { name: /StatCounter Global Stats/ }),
  ).toBeVisible();
  await market
    .getByText("StatCounter CSV 직접 올리기", { exact: true })
    .click();
  const upload = async (code: string, body: string) => {
    await market.getByLabel("국가 코드 (예: KR)", { exact: true }).fill(code);
    await market.getByLabel("또는 CSV 붙여넣기", { exact: true }).fill(body);
    await market
      .getByRole("button", { name: "점유율 CSV 가져오기", exact: true })
      .click();
  };
  await upload(
    "XA",
    '"Date","VendorA","VendorB","Other"\n2025-10,30.0,40.0,30.0\n2026-10,35.0,37.0,28.0',
  );
  await expect(market.getByRole("status")).toContainText("XA 점유율 새 값 6개");
  await upload("XB", '"Date","VendorA","VendorB"\n2026-10,10,90');
  // Wait for the save to finish (it clears the CSV box) before the next upload.
  await expect(market.getByRole("status")).toContainText("XB 점유율 새 값 2개");
  await expect(
    market.getByLabel("또는 CSV 붙여넣기", { exact: true }),
  ).toHaveValue("");
  await upload("XB", '"Date","VendorA","VendorB"\n2026-10,10,90');
  await expect(market.getByRole("status")).toContainText(
    "새 값 0개 · 변경 없음 2개",
  );

  await expect(market).toContainText("2개국 · 8개 값");
  await expect(
    market.getByLabel("또는 CSV 붙여넣기", { exact: true }),
  ).toHaveValue("");

  await upload("Korea", '"Date","VendorA"\n2026-10,1');
  await expect(market.getByRole("alert")).toContainText("영문 대문자 2자리");
  await noOverflow(page);

  // Viewing in the 성과 tab: share, year-ago change, same-month Coach UU.
  await market.getByRole("button", { name: "성과 탭에서 보기" }).click();
  const view = page.getByRole("region", { name: "국가별 제조사 점유율" });
  await expect(view).toContainText("판매량이 아닌 웹 이용 기반 점유율");
  await view.getByLabel("제조사", { exact: true }).selectOption("VendorA");
  const table = view.getByRole("table");
  await expect(table).toContainText("Coach UU 2026-10");
  const xa = table.getByRole("row", { name: /XA/ });
  await expect(xa).toContainText("35.0%");
  await expect(xa).toContainText("▲ 5.0%p");
  await expect(xa).toContainText("600");
  await expect(table.getByRole("row", { name: /XB/ })).toContainText("—");
  await view.getByLabel("정렬").selectOption("coach");
  await expect(table.getByRole("row").nth(1)).toContainText("XA");
  await noOverflow(page);
});

test("connection link: another browser connects all sheets and syncs", async ({
  page,
  browser,
}, info) => {
  const csv = await sheetCsv();
  const route = async (p: Page) =>
    p.route("https://docs.google.com/**", (r) => {
      const tab = new URL(r.request().url()).searchParams.get("sheet");
      return r.fulfill({
        status: tab === "pmzip_export" ? 200 : 404,
        contentType: "text/csv",
        headers: { "access-control-allow-origin": "*" },
        body: tab === "pmzip_export" ? csv : "not found",
      });
    });
  await route(page);
  const panel = await openPanel(page);
  await expect(
    page.getByRole("region", { name: "다른 기기에서 보기" }),
  ).toHaveCount(0);
  await panel
    .getByLabel("GA 스프레드시트 링크 또는 ID", { exact: true })
    .fill(SHEET_ID);
  await panel.getByRole("button", { name: "시트 연결", exact: true }).click();
  await expect(panel).toContainText("저장된 기간 2개");
  await openPanel(page);
  const share = page.getByRole("region", { name: "다른 기기에서 보기" });
  const link = await share
    .getByLabel("연결 링크", { exact: true })
    .inputValue();
  expect(link).toContain("#connect=");
  expect(new URL(link).search).toBe("?tab=data");

  // A fresh browser (no storage) opens the link.
  const other = await browser.newContext({
    ...(info.project.use.viewport
      ? { viewport: info.project.use.viewport }
      : {}),
  });
  const phone = await other.newPage();
  await phone.route("**/*", async (r) => {
    const host = new URL(r.request().url()).hostname;
    if (host === "docs.google.com") return r.fallback();
    if (!["127.0.0.1", "localhost"].includes(host))
      throw new Error("Unexpected external request: " + host);
    await r.continue();
  });
  await route(phone);
  await phone.goto(link);
  await expect(phone.getByRole("status").first()).toContainText(
    "이 기기를 시트에 연결했습니다 (GA)",
  );
  expect(new URL(phone.url()).hash).toBe("");
  const phonePanel = phone.getByRole("region", {
    name: "Galaxy Coach GA 가져오기",
  });
  await expect(phonePanel).toContainText("저장된 기간 2개");
  await phone
    .getByRole("navigation", { name: "워크스페이스 메뉴" })
    .getByRole("button", { name: "성과", exact: true })
    .click();
  await expect(
    phone
      .getByRole("region", { name: "Galaxy Coach 이용" })
      .locator(".stat-row"),
  ).toContainText("훈련 완료율 (UU)75%");
  await other.close();
});
