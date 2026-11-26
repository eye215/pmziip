import { test, expect } from "@playwright/test";

test("synthetic workspace is honest, scoped, responsive, and makes no external requests", async ({ page }, info) => {
  const external: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      external.push(url.origin); await route.abort();
    } else await route.continue();
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "제품의 변화, 근거와 함께" })).toBeVisible();
  await expect(page.getByText("합성 데이터 · 운영 미연결", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Demo Coach", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Demo Survey", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("all-projects.png"), fullPage: true });
  await page.getByLabel("조회 범위").selectOption("project:00000000-0000-4000-8000-000000000004");
  await expect(page.getByRole("heading", { name: "Demo Survey", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Demo Coach", exact: true })).toHaveCount(0);
  await page.getByLabel("조회 월").fill("2026-12");
  await expect(page.getByText("2026-12 · 프로젝트 기준", { exact: true })).toBeVisible();
  await expect(page.getByText("미수집", { exact: true })).toHaveCount(2);
  await expect(page.getByText("GA4 · 미연결", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("foundation.png"), fullPage: true });
});
