import { test, expect, type Page } from "@playwright/test";
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
});
