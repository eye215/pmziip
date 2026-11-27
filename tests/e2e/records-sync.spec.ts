import { test, expect, type Page, type BrowserContext } from "@playwright/test";

// Synthetic records only. The Apps Script web app is replaced by an in-memory
// fake that speaks the same protocol (tools/apps-script/records-sync/Sync.gs).
const URL_ =
  "https://script.google.com/macros/s/AKfycbSYNTHETIC" +
  "x".repeat(20) +
  "/exec";
const TOKEN = "s".repeat(48);

function fakeServer() {
  let revision = 0;
  let hash: string | null = null;
  let bundle: unknown = null;
  return async (ctx: BrowserContext | Page) => {
    await ctx.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === "script.google.com") {
        const body = JSON.parse(route.request().postData() || "{}");
        const reply = (obj: unknown) =>
          route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify(obj),
          });
        if (body.token !== TOKEN)
          return reply({ ok: false, error: "동기화 토큰이 맞지 않습니다." });
        if (body.action === "pull")
          return reply({ ok: true, revision, hash, bundle });
        if (body.baseRevision !== revision)
          return reply({ ok: false, conflict: true, revision });
        revision += 1;
        hash = body.hash;
        bundle = body.bundle;
        return reply({ ok: true, revision });
      }
      if (!["127.0.0.1", "localhost"].includes(url.hostname))
        return route.abort();
      return route.continue();
    });
  };
}

async function tab(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "워크스페이스 메뉴" })
    .getByRole("button", { name, exact: true })
    .click();
}

test("records sync: PC records reach the phone through the sheet", async ({
  page,
  browser,
}, info) => {
  const serve = fakeServer();
  await serve(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Demo Coach", exact: true }),
  ).toBeVisible();

  // PC: write a source, then connect sync in settings (first push).
  await tab(page, "수집함");
  await page.getByRole("button", { name: "원문 등록", exact: true }).click();
  await page.getByLabel("원문 제목", { exact: true }).fill("PC에서 쓴 원문");
  await page.getByLabel("원문 내용", { exact: true }).fill("합성 원문 내용");
  await page.getByLabel("수집 일시", { exact: true }).fill("2026-11-20T10:00");
  await page
    .getByRole("button", { name: "확인하고 저장", exact: true })
    .click();
  await expect(page.locator(".editor")).toHaveCount(0);

  await tab(page, "설정");
  const panel = page.getByRole("region", { name: "기기 간 기록 동기화" });
  await panel.getByLabel("웹 앱 주소 (/exec)").fill("https://example.invalid");
  await panel.getByRole("button", { name: "연결하고 동기화" }).click();
  await expect(panel.getByRole("alert")).toContainText(
    "Apps Script 웹 앱 주소",
  );
  await panel.getByLabel("웹 앱 주소 (/exec)").fill(URL_);
  await panel.getByLabel("동기화 토큰").fill(TOKEN);
  await panel.getByRole("button", { name: "연결하고 동기화" }).click();
  await expect(panel).toContainText("시트 버전 1");

  // The device link now carries the sync address and token.
  const link = await page
    .getByRole("region", { name: "다른 기기에서 보기" })
    .getByLabel("연결 링크", { exact: true })
    .inputValue();

  // Phone: a fresh browser opens the link and receives the records.
  const other = await browser.newContext(
    info.project.use.viewport ? { viewport: info.project.use.viewport } : {},
  );
  await serve(other);
  const phone = await other.newPage();
  await phone.goto(link);
  await expect(phone.getByRole("status").first()).toContainText("기록 동기화");
  await tab(phone, "수집함");
  await expect(
    phone.getByRole("article", { name: "PC에서 쓴 원문 원문", exact: true }),
  ).toBeVisible({ timeout: 15_000 });

  // Phone edits flow back to the PC.
  await phone.getByRole("button", { name: "원문 등록", exact: true }).click();
  await phone.getByLabel("원문 제목", { exact: true }).fill("휴대폰 원문");
  await phone.getByLabel("원문 내용", { exact: true }).fill("합성");
  await phone.getByLabel("수집 일시", { exact: true }).fill("2026-11-21T10:00");
  await phone
    .getByRole("button", { name: "확인하고 저장", exact: true })
    .click();
  await tab(phone, "설정");
  await phone
    .getByRole("region", { name: "기기 간 기록 동기화" })
    .getByRole("button", { name: "지금 동기화" })
    .click();
  await expect(
    phone.getByRole("region", { name: "기기 간 기록 동기화" }),
  ).toContainText("시트 버전 2");

  await panel.getByRole("button", { name: "지금 동기화" }).click();
  await expect(panel).toContainText("시트 버전 2");
  await tab(page, "수집함");
  await expect(
    page.getByRole("article", { name: "휴대폰 원문 원문", exact: true }),
  ).toBeVisible();
  await other.close();
});
