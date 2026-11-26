import { test, expect, type Page } from "@playwright/test";

// Synthetic records only; no external request.
const KEY =
  "pmzip:synthetic:v1:00000000-0000-4000-8000-000000000010:00000000-0000-4000-8000-000000000001";
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

test("case study fields save on the initiative and show as eight lines", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Demo Coach", exact: true }),
  ).toBeVisible();
  await tab(page, "과제");
  await page.getByRole("button", { name: "과제 추가", exact: true }).click();
  await page.getByLabel("과제 프로젝트", { exact: true }).selectOption(COACH);
  await page
    .getByLabel("과제 제목", { exact: true })
    .fill("합성 다시하기 개선");
  await page.getByLabel("업무 상태", { exact: true }).selectOption("released");
  await page.getByLabel("목표 월", { exact: true }).fill("2026-11");
  await page.getByLabel("개인 기여", { exact: true }).fill("원인 분석과 기획");
  await page
    .getByLabel("사이트 주소", { exact: true })
    .fill("https://example.invalid/coach");
  await page.getByLabel("바뀐 점", { exact: true }).fill("버튼 위치 이동");
  await page.getByRole("button", { name: "막힘 지점 추가" }).click();
  await page.getByLabel("막힘 지점 1", { exact: true }).fill("버튼이 작음");
  await page
    .getByLabel("배포 후 결과", { exact: true })
    .selectOption("happened");
  await page.getByLabel("배포 일시", { exact: true }).fill("2026-11-20T10:00");
  await page.getByLabel("아쉬운 점", { exact: true }).fill("사전 테스트 부족");
  // Bad link is reported on its own field and nothing is saved.
  await page.getByLabel("기획서 링크", { exact: true }).fill("javascript:x");
  await page
    .getByRole("button", { name: "확인하고 저장", exact: true })
    .click();
  await expect(page.getByLabel("기획서 링크", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page.getByLabel("기획서 링크", { exact: true }).fill("");
  await page
    .getByRole("button", { name: "확인하고 저장", exact: true })
    .click();
  await expect(page.locator(".editor")).toHaveCount(0);

  const stored = await page.evaluate(
    (k) => JSON.parse(localStorage.getItem(k)!),
    KEY,
  );
  const w = stored.initiatives.find(
    (x: { title: string }) => x.title === "합성 다시하기 개선",
  );
  expect(w.siteUrl).toBe("https://example.invalid/coach");
  expect(w.frictions).toEqual([
    { point: "버튼이 작음", outcome: "happened", note: "" },
  ]);
  expect(w.releasedAt).toMatch(/^2026-11-20T/);

  // The list shows the current view month by target month.
  await page.getByLabel("월 기준", { exact: true }).selectOption("target");
  const card = page
    .getByRole("article")
    .filter({ hasText: "합성 다시하기 개선" });
  await card.getByText(/케이스 스터디 · \d\/8 작성/).click();
  const lines = card.locator(".case-lines li");
  await expect(lines).toHaveCount(8);
  await expect(lines.nth(3)).toContainText("버튼 위치 이동");
  await expect(lines.nth(5)).toContainText("실제 발생 1");
  await expect(lines.nth(6)).toContainText(
    "판매 데이터가 아직 연결되지 않았습니다",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("released Coach initiative shows GA before/after as observations", async ({
  page,
}) => {
  const { readFile } = await import("node:fs/promises");
  const base = JSON.parse(
    await readFile("tests/fixtures/coach-export.synthetic.json", "utf8"),
  ).periods[0];
  const snap = (
    i: number,
    startDate: string,
    endDate: string,
    done: number,
  ) => ({
    id: `00000000-0000-4000-8000-${String(700 + i).padStart(12, "0")}`,
    projectId: COACH,
    importedAt: "2026-11-28T00:00:00.000Z",
    source: "apps-script-export",
    generator: { name: "test", version: "1" },
    definitionVersion: "coach-ga4-1.2",
    propertyTimeZone: "Asia/Seoul",
    generatedAt: "2026-11-28T00:00:00.000Z",
    contentHash: String(i).repeat(64).slice(0, 64),
    period: {
      ...base,
      startDate,
      endDate,
      totals: {
        main: { users: 1000, count: 4000 },
        start: { users: 100, count: 200 },
        done: { users: 50, count: done },
      },
    },
  });
  await page.goto("/");
  await page.evaluate(
    (store) => {
      localStorage.setItem(
        "pmzip:coach-ga:v1:00000000-0000-4000-8000-000000000010:00000000-0000-4000-8000-000000000001",
        JSON.stringify(store),
      );
    },
    {
      schemaVersion: 1,
      ownerId: "00000000-0000-4000-8000-000000000010",
      workspaceId: "00000000-0000-4000-8000-000000000001",
      revision: 1,
      snapshots: [
        snap(1, "2026-11-10", "2026-11-16", 60),
        snap(2, "2026-11-21", "2026-11-27", 80),
      ],
    },
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Demo Coach", exact: true }),
  ).toBeVisible();
  await tab(page, "과제");
  await page.getByRole("button", { name: "과제 추가", exact: true }).click();
  await page.getByLabel("과제 프로젝트", { exact: true }).selectOption(COACH);
  await page
    .getByLabel("과제 제목", { exact: true })
    .fill("합성 완료 흐름 개선");
  await page.getByLabel("목표 월", { exact: true }).fill("2026-11");
  await page.getByLabel("업무 상태", { exact: true }).selectOption("released");
  await page.getByLabel("배포 일시", { exact: true }).fill("2026-11-18T10:00");
  await page
    .getByRole("button", { name: "확인하고 저장", exact: true })
    .click();
  await expect(page.locator(".editor")).toHaveCount(0);
  await page.getByLabel("월 기준", { exact: true }).selectOption("target");
  const card = page
    .getByRole("article")
    .filter({ hasText: "합성 완료 흐름 개선" });
  await card.getByText(/케이스 스터디 · \d\/8 작성/).click();
  const table = card.getByRole("table");
  await expect(table).toContainText("배포 전후 7일");
  await expect(table.getByRole("row", { name: /횟수 완료율/ })).toContainText(
    "+10.0%p",
  );
  await expect(card.locator(".case-lines li").nth(5)).toContainText(
    "배포 전후 7일 횟수 완료율 30% → 40% (+10.0%p)",
  );
  await expect(card).toContainText("관찰값입니다");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
