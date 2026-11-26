import { test, expect, type Page } from "@playwright/test";
const KEY =
  "pmzip:synthetic:v1:00000000-0000-4000-8000-000000000010:00000000-0000-4000-8000-000000000001";
const COACH = "00000000-0000-4000-8000-000000000003",
  SURVEY = "00000000-0000-4000-8000-000000000004";
const raw = "  합성 원문\n<script>window.__unsafe=true</script>  ";
async function boot(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "원문 등록", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Demo Coach", exact: true }),
  ).toBeVisible();
}
async function tab(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "워크스페이스 메뉴" })
    .getByRole("button", { name, exact: true })
    .click();
}
async function save(page: Page) {
  await page
    .getByRole("button", { name: "확인하고 저장", exact: true })
    .click();
  await expect(page.locator(".editor")).toHaveCount(0);
}
async function source(page: Page, title = "공통 요구") {
  await tab(page, "통합 수집함");
  await page.getByRole("button", { name: "원문 등록", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel("원문 제목", { exact: true }).fill(title);
  await page.getByLabel("원문 내용", { exact: true }).fill(raw);
  await page.getByLabel("수집 일시", { exact: true }).fill("2026-11-30T23:59");
  await save(page);
}
async function work(page: Page, title: string, projectId: string) {
  await page
    .getByRole("article", { name: "공통 요구 원문", exact: true })
    .getByRole("button", { name: "과제로 만들기", exact: true })
    .click();
  await page
    .getByLabel("과제 프로젝트", { exact: true })
    .selectOption(projectId);
  await page.getByLabel("과제 제목", { exact: true }).fill(title);
  await page.getByLabel("목표 월", { exact: true }).fill("2026-12");
  await page
    .getByLabel("기획 일시 (선택)", { exact: true })
    .fill("2026-12-01T09:00");
  await save(page);
}
test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname))
      throw new Error("Unexpected external request: " + url.origin);
    await route.continue();
  });
});

test("one source → two projects; scope/month filters, rename/move/archive and reload preserve data", async ({
  page,
}, info) => {
  await boot(page);
  await source(page);
  await work(page, "Coach 입력 개선", COACH);
  await work(page, "Survey 입력 개선", SURVEY);
  const snapshot = () =>
    page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), KEY);
  let state = await snapshot();
  expect(state.sources).toHaveLength(1);
  expect(state.links).toHaveLength(2);
  expect(state.sources[0].rawText).toBe(raw);
  expect(await page.evaluate(() => "__unsafe" in window)).toBe(false);
  await tab(page, "개선 과제");
  await page
    .getByLabel("조회 범위", { exact: true })
    .selectOption("project:" + COACH);
  await expect(
    page.getByRole("article", { name: "Coach 입력 개선 과제", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "Survey 입력 개선 과제", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("조회 범위", { exact: true })
    .selectOption("project:" + SURVEY);
  await page.getByLabel("월 기준", { exact: true }).selectOption("planned");
  await expect(page.getByText("과제 0개", { exact: true })).toBeVisible();
  await page.getByLabel("조회 월", { exact: true }).fill("2026-12");
  await expect(
    page.getByRole("article", { name: "Survey 입력 개선 과제", exact: true }),
  ).toBeVisible();
  await tab(page, "프로젝트");
  await page.getByLabel("조회 범위", { exact: true }).selectOption("all");
  const coach = page.getByRole("article", {
    name: "Demo Coach 프로젝트",
    exact: true,
  });
  await coach.getByRole("button", { name: "수정", exact: true }).click();
  await page.getByLabel("프로젝트 이름", { exact: true }).fill("Renamed Coach");
  await page.getByLabel("고객사", { exact: true }).selectOption("");
  await save(page);
  const renamed = page.getByRole("article", {
    name: "Renamed Coach 프로젝트",
    exact: true,
  });
  page.once("dialog", (d) => d.accept());
  await renamed.getByRole("button", { name: "보관", exact: true }).click();
  await expect(renamed).toHaveCount(0);
  await page.getByLabel("보관 기록 포함", { exact: true }).check();
  await page
    .getByRole("article", { name: "Renamed Coach 프로젝트", exact: true })
    .getByRole("button", { name: "복원", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Renamed Coach", exact: true }),
  ).toBeVisible();
  state = await snapshot();
  expect(state.initiatives).toHaveLength(2);
  expect(state.links).toHaveLength(2);
  expect(
    state.workspace.projects.find((p: { id: string }) => p.id === COACH)
      .clientId,
  ).toBeNull();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("phase1-projects.png"),
    fullPage: true,
  });
  await page.getByLabel("조회 월", { exact: true }).fill("2026-11");
  await tab(page, "통합 수집함");
  await page
    .getByRole("article", { name: "공통 요구 원문", exact: true })
    .getByText("원문·출처·수정 이력", { exact: true })
    .click();
  await expect(page.getByText("연결 과제 2개", { exact: true })).toBeVisible();
  await page.screenshot({
    path: info.outputPath("phase1-inbox.png"),
    fullPage: true,
  });
});

test("source edit keeps original history; legacy preview requires approval and is idempotent", async ({
  page,
}) => {
  await boot(page);
  await source(page);
  await page
    .getByRole("article", { name: "공통 요구 원문", exact: true })
    .getByRole("button", { name: "수정", exact: true })
    .click();
  await page.getByLabel("원문 내용", { exact: true }).fill("수정된 합성 원문");
  await save(page);
  let state = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    KEY,
  );
  expect(state.sources[0].revisions[0].rawText).toBe(raw);
  const legacy = JSON.stringify([
    {
      id: 42,
      project: "Legacy Demo",
      title: "가져온 과제",
      raw: "합성 원문",
      month: "2026-11",
      kpi: "이전 KPI",
      beforeN: "0",
      beforeD: "100",
    },
  ]);
  for (const first of [true, false]) {
    await tab(page, "백업·가져오기");
    await page
      .getByRole("button", { name: "이전 버전 가져오기", exact: true })
      .click();
    await page.getByLabel("또는 JSON 붙여넣기", { exact: true }).fill(legacy);
    await page.getByRole("button", { name: "미리보기", exact: true }).click();
    await expect(
      page.getByText(
        first ? "새 기록 1개 · 중복 제외 0개" : "새 기록 0개 · 중복 제외 1개",
        { exact: true },
      ),
    ).toBeVisible();
    if (first)
      await page
        .getByLabel("「Legacy Demo」 연결 프로젝트", { exact: true })
        .selectOption(COACH);
    await page
      .getByRole("button", { name: "확인하고 저장", exact: true })
      .click();
    await expect(page.locator("main").getByRole("alert")).toContainText("승인");
    await page
      .getByLabel("미리보기와 프로젝트 연결을 확인했습니다", { exact: true })
      .check();
    await save(page);
  }
  state = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    KEY,
  );
  expect(state.legacy).toHaveLength(1);
  expect(state.legacy[0].original.beforeN).toBe("0");
  expect(state.initiatives).toHaveLength(1);
});

test("failed local write preserves confirmed data and typed input", async ({
  page,
}) => {
  await boot(page);
  await source(page, "저장된 원문");
  await page.getByRole("button", { name: "원문 등록", exact: true }).click();
  await page.getByLabel("원문 제목", { exact: true }).fill("저장 실패 초안");
  await page.getByLabel("원문 내용", { exact: true }).fill("입력 유지");
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
  });
  await page
    .getByRole("button", { name: "확인하고 저장", exact: true })
    .click();
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("원문 내용", { exact: true })).toHaveValue(
    "입력 유지",
  );
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!).sources.length,
      KEY,
    ),
  ).toBe(1);
  await page.reload();
  await tab(page, "통합 수집함");
  await expect(
    page.getByRole("article", { name: "저장된 원문 원문", exact: true }),
  ).toBeVisible();
});

test("damaged storage is never silently replaced", async ({ page }) => {
  await page.addInitScript(
    (key) => localStorage.setItem(key, "broken-json"),
    KEY,
  );
  await page.goto("/");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "초기화하지 않았습니다",
  );
  await page.getByRole("button", { name: "다시 읽기", exact: true }).click();
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(
    "broken-json",
  );
});

test("another tab cannot overwrite an open edit", async ({ page, context }) => {
  await boot(page);
  await tab(page, "통합 수집함");
  await page.getByRole("button", { name: "원문 등록", exact: true }).click();
  await page.getByLabel("원문 제목", { exact: true }).fill("첫 탭 초안");
  await page.getByLabel("원문 내용", { exact: true }).fill("보존할 입력");
  const other = await context.newPage();
  await boot(other);
  await source(other, "둘째 탭 확정본");
  await page
    .getByRole("button", { name: "확인하고 저장", exact: true })
    .click();
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("원문 내용", { exact: true })).toHaveValue(
    "보존할 입력",
  );
  const state = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    KEY,
  );
  expect(state.sources).toHaveLength(1);
  expect(state.sources[0].title).toBe("둘째 탭 확정본");
  await other.close();
});

test("client/project creation validates input, and reviewed task merge preserves both originals", async ({
  page,
}, info) => {
  await boot(page);
  await page.getByRole("button", { name: "고객사 추가", exact: true }).click();
  await page.getByLabel("고객사 이름", { exact: true }).fill("새 합성 고객사");
  await save(page);
  await page
    .getByRole("button", { name: "프로젝트 추가", exact: true })
    .click();
  await page
    .getByLabel("프로젝트 이름", { exact: true })
    .fill("새 합성 프로젝트");
  await page
    .getByLabel("고객사", { exact: true })
    .selectOption({ label: "새 합성 고객사" });
  await page
    .getByLabel("프로젝트 시간대", { exact: true })
    .fill("Invalid/Zone");
  await page
    .getByRole("button", { name: "확인하고 저장", exact: true })
    .click();
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("프로젝트 이름", { exact: true })).toHaveValue(
    "새 합성 프로젝트",
  );
  await page.getByLabel("프로젝트 시간대", { exact: true }).fill("Asia/Seoul");
  await save(page);
  await expect(
    page.getByRole("heading", { name: "새 합성 프로젝트", exact: true }),
  ).toBeVisible();
  await source(page);
  await work(page, "중복 검토 A", COACH);
  await work(page, "중복 검토 B", COACH);
  await tab(page, "개선 과제");
  await page
    .getByRole("article", { name: "중복 검토 A 과제", exact: true })
    .getByRole("button", { name: "중복 검토·병합", exact: true })
    .click();
  await page
    .getByLabel("남길 과제", { exact: true })
    .selectOption({ label: "중복 검토 B" });
  await page.getByLabel("병합 사유", { exact: true }).fill("합성 중복 검토");
  await page
    .getByLabel("원본이 보관되고 연결이 추가됨을 확인했습니다", { exact: true })
    .check();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("phase1-merge-review.png"),
    fullPage: true,
  });
  await save(page);
  const state = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    KEY,
  );
  expect(state.initiatives).toHaveLength(2);
  expect(state.initiatives[0].status).toBe("archived");
  expect(state.initiatives[0].title).toBe("중복 검토 A");
  expect(state.initiatives[1].title).toBe("중복 검토 B");
  await expect(
    page.getByRole("article", { name: "중복 검토 A 과제", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("보관 기록 포함", { exact: true }).check();
  await expect(
    page.getByRole("article", { name: "중복 검토 A 과제", exact: true }),
  ).toBeVisible();
});

test("simultaneous tab saves are serialized; only one initial revision can commit", async ({
  page,
  context,
}) => {
  await boot(page);
  const other = await context.newPage();
  await boot(other);
  for (const [p, title] of [
    [page, "동시 초안 A"],
    [other, "동시 초안 B"],
  ] as const) {
    await tab(p, "통합 수집함");
    await p.getByRole("button", { name: "원문 등록", exact: true }).click();
    await p.getByLabel("원문 제목", { exact: true }).fill(title);
    await p.getByLabel("원문 내용", { exact: true }).fill("합성 동시 저장");
  }
  await page.evaluate((key) => {
    const host = window as unknown as { held?: boolean; release?: () => void };
    void navigator.locks.request(key, () => {
      host.held = true;
      return new Promise<void>((resolve) => {
        host.release = resolve;
      });
    });
  }, KEY);
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { held?: boolean }).held),
    )
    .toBe(true);
  await Promise.all([
    page.getByRole("button", { name: "확인하고 저장", exact: true }).click(),
    other.getByRole("button", { name: "확인하고 저장", exact: true }).click(),
  ]);
  await expect(
    page.getByRole("button", { name: "저장 중…", exact: true }),
  ).toBeVisible();
  await expect(
    other.getByRole("button", { name: "저장 중…", exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { release: () => void }).release(),
  );
  await expect
    .poll(
      async () =>
        (await page.locator(".editor").count()) +
        (await other.locator(".editor").count()),
    )
    .toBe(1);
  const state = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    KEY,
  );
  expect(state.sources).toHaveLength(1);
  expect(state.revision).toBe(1);
  const rejected = (await page.locator(".editor").count()) ? page : other;
  await expect(rejected.locator("main").getByRole("alert")).toBeVisible();
  await expect(rejected.getByLabel("원문 내용", { exact: true })).toHaveValue(
    "합성 동시 저장",
  );
  await other.close();
});
