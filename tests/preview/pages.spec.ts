import { test, expect } from "@playwright/test";
test("exported Pages artifact loads scripts, navigates, saves and restores local input", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.push(`${response.status()}: ${response.url()}`);
  });
  await page.route("**/*", async (route) => {
    expect(new URL(route.request().url()).hostname).toBe("127.0.0.1");
    await route.continue();
  });
  await page.goto("/pmziip/");
  await expect(
    page.getByRole("heading", { name: "Demo Coach", exact: true }),
  ).toBeVisible();
  const menu = page.getByRole("navigation", { name: "워크스페이스 메뉴" });
  await menu.getByRole("button", { name: "통합 수집함", exact: true }).click();
  await page.getByRole("button", { name: "원문 등록", exact: true }).click();
  await page
    .getByLabel("원문 제목", { exact: true })
    .fill("합성 미리보기 확인");
  await page
    .getByLabel("원문 내용", { exact: true })
    .fill("브라우저 로컬 저장 검증용 합성 문장");
  await page
    .getByRole("button", { name: "확인하고 저장", exact: true })
    .click();
  await expect(page.locator(".editor")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "합성 미리보기 확인", exact: true }),
  ).toBeVisible();
  await menu.getByRole("button", { name: "프로젝트", exact: true }).click();
  await page
    .getByRole("button", { name: "지표·전략", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "지표 사전", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "지표 만들기", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "월별 전략", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "전략 작성", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: info.outputPath("published-preview.png"),
    fullPage: true,
  });
});
