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
    .getByRole("button", { name: "백업·가져오기", exact: true })
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

  const oct = panel.getByRole("article", {
    name: "2026-10-01~2026-10-31 GA 기간",
  });
  await expect(oct).toContainText("300 / 620");
  await expect(oct).toContainText("유효 점수(1~5) 건수600");
  await expect(oct).toContainText("점수 없는 REPORT20");
  await expect(oct).toContainText("GA 임계값");
  await expect(oct).toContainText("75%");
  const nov = panel.getByRole("article", {
    name: "2026-11-01~2026-11-24 GA 기간",
  });
  await expect(nov).toContainText("N/A (분모 0)");
  await expect(nov).toContainText("미집계");
  await oct.getByText("국가·Sales Case별 이용 현황").click();
  await expect(oct.getByRole("table", { name: "국가별" })).toContainText("XA");
  await expect(oct).toContainText("합산하지 않습니다");

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
  await expect(again.getByRole("article", { name: /GA 기간$/ })).toHaveCount(2);
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
    .getByRole("button", { name: "프로젝트", exact: true })
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
  await expect(panel.getByRole("article", { name: /GA 기간$/ })).toHaveCount(2);
  expect(requests[0]).toBe(
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&headers=1&sheet=pmzip_export`,
  );
  await noOverflow(page);

  // Next visit syncs automatically; identical data adds nothing.
  const again = await openPanel(page);
  await expect(again).toContainText("새 기간 0개 · 재수집 0개 · 변경 없음 2개");
  expect(requests).toHaveLength(2);
  await expect(again.getByRole("article", { name: /GA 기간$/ })).toHaveCount(2);

  // A failing fetch writes nothing and keeps saved periods.
  status = 404;
  await again.getByRole("button", { name: "지금 동기화", exact: true }).click();
  await expect(again.getByRole("alert")).toContainText("HTTP 404");
  await expect(again.getByRole("article", { name: /GA 기간$/ })).toHaveCount(2);

  // Disconnect removes only the setting, not imported data.
  page.once("dialog", (d) => d.accept());
  await again
    .getByRole("button", { name: "시트 연결 해제", exact: true })
    .click();
  await expect(
    again.getByLabel("GA 스프레드시트 링크 또는 ID", { exact: true }),
  ).toBeVisible();
  await expect(again.getByRole("article", { name: /GA 기간$/ })).toHaveCount(2);
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
  // Default: plain-language view of the first company.
  const easy = fin.getByRole("region", { name: /합성전자 쉽게 보기/ });
  await expect(easy).toContainText("2026년 3분기");
  await expect(easy).toContainText("한마디로: 1년 전보다 좋아지고 있어요.");
  await expect(easy).toContainText("AI 미사용");
  await fin
    .getByLabel("회사", { exact: true })
    .selectOption({ label: "합성에듀" });
  const edu = fin.getByRole("region", { name: /합성에듀 쉽게 보기/ });
  await expect(edu).toContainText("돈이 남는 회사로 바뀌었어요");
  await expect(fin.getByLabel("재무제표 기준", { exact: true })).toHaveValue(
    "OFS",
  );
  await noOverflow(page);
  await fin
    .getByLabel("회사", { exact: true })
    .selectOption({ label: "합성전자" });
  await fin.getByRole("button", { name: "표로 보기", exact: true }).click();
  await expect(
    fin.getByRole("button", { name: "표로 보기", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const table = fin.getByRole("table");
  const q1 = table.getByRole("row", { name: /2026 Q1/ });
  await expect(q1).toContainText("1,000,000억");
  await expect(q1).toContainText("10%");
  await expect(q1).toContainText("+11.1%");
  await expect(table.getByRole("row", { name: /2025 Q4\*/ })).toBeVisible();
  await expect(table.getByRole("row", { name: /2025 Q1/ })).toContainText("—");
  await expect(fin).toContainText("인과관계로 해석하지 않습니다");
  await noOverflow(page);

  await openPanel(page);
  await expect(
    page.getByRole("region", { name: "공시 실적 (DART)" }),
  ).toContainText("변경 없음 · 35개 항목");
});
