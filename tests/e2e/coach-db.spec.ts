import { test, expect, type Page } from "@playwright/test";

// Synthetic Mongo export files; everything is computed in the browser.
const dir = "tests/fixtures/coach-db/";
const files = ["voice_sessions", "stage_infos", "sales_infos", "users"].map(
  (n) => `${dir}${n}.synthetic.json`,
);

test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const host = new URL(route.request().url()).hostname;
    if (!["127.0.0.1", "localhost"].includes(host)) return route.abort();
    return route.continue();
  });
});
async function tab(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "워크스페이스 메뉴" })
    .getByRole("button", { name, exact: true })
    .click();
}

test("Coach DB export: V1/V2 sessions → monthly metrics, quality, downloads", async ({
  page,
}) => {
  await page.goto("/");
  await tab(page, "설정");
  const panel = page.getByRole("region", {
    name: "Galaxy Coach DB 세션 가져오기",
  });
  await panel
    .getByLabel("JSON 파일 (여러 개 선택, 새 달 파일 추가 가능)")
    .setInputFiles(files);
  await expect(panel).toContainText(
    "voice_sessions.synthetic.json → voice_sessions",
  );
  await panel.getByRole("button", { name: "집계" }).click();
  await expect(panel.getByRole("status")).toContainText("집계했습니다");
  await expect(panel.getByRole("status")).toContainText("2개월");
  await panel.getByText(/데이터 품질 점검/).click();
  await expect(
    panel.getByRole("table", { name: "데이터 품질 점검" }),
  ).toContainText("V1·V2 기간 중첩");
  const dl = page.waitForEvent("download");
  await panel.getByRole("button", { name: "엑셀(xlsx)" }).click();
  expect((await dl).suggestedFilename()).toBe("galaxy_coach_statistics.xlsx");
  // Only aggregates are stored (no user ids).
  const raw = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith("pmzip:coach-db:"))
      .map((k) => localStorage.getItem(k))
      .join(""),
  );
  expect(raw).toContain('"year_month":"2026-01"');
  expect(raw).not.toContain("000000000000000000000001");

  await tab(page, "성과");
  const view = page.getByRole("region", {
    name: "Galaxy Coach 이용 · DB 세션 기준",
  });
  const months = view.getByRole("table", { name: "월별 전체" });
  await expect(months.getByRole("row")).toHaveCount(3);
  await expect(months.getByRole("row").nth(1)).toContainText("2026-01");
  await expect(months.getByRole("row").nth(1)).toContainText("50.0%");
  await expect(months.getByRole("row").nth(1)).toContainText("2 / 0");
  await view.getByLabel("국가별 보기 월").selectOption("2026-01");
  await expect(
    view.getByRole("table", { name: "2026-01 국가별" }),
  ).toContainText("US");
});
