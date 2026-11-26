import { test, expect, type Page } from "@playwright/test";

// Synthetic records only; no external request.
const COACH = "00000000-0000-4000-8000-000000000003";
test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname))
      throw new Error("Unexpected external request: " + url.origin);
    await route.continue();
  });
});
async function tab(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "워크스페이스 메뉴" })
    .getByRole("button", { name, exact: true })
    .click();
}

test("impact report: period draft, finalize once as a snapshot, survives reload", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Demo Coach", exact: true }),
  ).toBeVisible();
  await tab(page, "과제");
  await page.getByRole("button", { name: "과제 추가", exact: true }).click();
  await page.getByLabel("과제 프로젝트", { exact: true }).selectOption(COACH);
  await page.getByLabel("과제 제목", { exact: true }).fill("합성 보고서 과제");
  await page.getByLabel("업무 상태", { exact: true }).selectOption("released");
  await page.getByLabel("배포 일시", { exact: true }).fill("2026-11-18T10:00");
  await page
    .getByRole("button", { name: "확인하고 저장", exact: true })
    .click();
  await expect(page.locator(".editor")).toHaveCount(0);

  await tab(page, "성과");
  const panel = page.getByRole("region", { name: "내 성과 보고서" });
  await panel.getByLabel("시작 월", { exact: true }).fill("2026-11");
  await panel.getByLabel("끝 월", { exact: true }).fill("2026-11");
  const released = panel.locator(".report-summary div").filter({
    has: page.getByText("배포", { exact: true }),
  });
  await expect(released.locator("dd")).toHaveText("1");
  // No GA comparison yet: the ratio is N/A, never 0 / 0.
  await expect(panel.locator(".report-hero-v").first()).toHaveText("N/A");
  await expect(
    panel
      .getByRole("list", { name: "흐름" })
      .first()
      .getByRole("listitem")
      .filter({ hasText: /^배포/ }),
  ).toContainText("1");
  await expect(panel.locator(".report-case summary")).toContainText(
    "합성 보고서 과제",
  );
  await panel.getByRole("button", { name: "이 내용으로 확정" }).click();
  await expect(panel.getByRole("status").last()).toContainText("v1로 확정");
  await panel.getByRole("button", { name: "이 내용으로 확정" }).click();
  await expect(panel.getByRole("alert")).toContainText("이미 확정");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);

  await page.reload();
  await tab(page, "성과");
  await expect(
    page
      .getByRole("region", { name: "내 성과 보고서" })
      .locator(".report-saved > summary"),
  ).toContainText("2026-11 ~ 2026-11 · v1");
});
