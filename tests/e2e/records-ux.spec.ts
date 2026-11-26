import { test, expect, type Page } from "@playwright/test";

// Synthetic data only. No real company names, people or links.
const KEY =
  "pmzip:synthetic:v1:00000000-0000-4000-8000-000000000010:00000000-0000-4000-8000-000000000001";
const COACH = "00000000-0000-4000-8000-000000000003";
const LONG_EN =
  "SyntheticRequirementTitleWithoutAnySpacesToReproduceHorizontalOverflowOnNarrowScreens";
const LONG_TITLE = `합성 긴 제목 확인용 요구사항 ${LONG_EN}`;
const LONG_URL =
  "https://example.invalid/synthetic/" +
  "very-long-path-segment-without-breaks-".repeat(4) +
  "?query=" +
  "a".repeat(80);
const LONG_RAW =
  "합성 원문 첫 줄\n" +
  "UnbrokenSyntheticRawTextToken_".repeat(6) +
  "\n" +
  LONG_URL;
const LONG_PROJECT = `합성 프로젝트 ${LONG_EN}`;
// CAPTURE=before|after writes docs/screenshots/claude-records-*; unset in CI.
const CAPTURE = process.env.CAPTURE;
async function capture(
  page: Page,
  project: string,
  name: string,
  fullPage = true,
) {
  if (!CAPTURE || project === "chromium-desktop") return;
  const size = project === "webkit-small" ? "320" : "375";
  await page.screenshot({
    path: `docs/screenshots/claude-records-${size}-${name}-${CAPTURE}.png`,
    fullPage,
  });
}

test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname))
      throw new Error("Unexpected external request: " + url.origin);
    await route.continue();
  });
});

async function boot(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Demo Coach", exact: true }),
  ).toBeVisible();
}
function nav(page: Page) {
  return page.getByRole("navigation", { name: "워크스페이스 메뉴" });
}
async function tab(page: Page, name: string) {
  await nav(page).getByRole("button", { name, exact: true }).click();
}
async function save(page: Page) {
  await page
    .getByRole("button", { name: "확인하고 저장", exact: true })
    .click();
  await expect(page.locator(".editor")).toHaveCount(0);
}
/** Elements whose right edge passes the viewport (ignores the fixed nav). */
async function overflow(page: Page) {
  // WebKit mobile widens the layout viewport to fit content, so compare with
  // the configured viewport instead of clientWidth.
  const width = page.viewportSize()!.width;
  return page.evaluate((width) => {
    const out: string[] = [];
    if (document.documentElement.scrollWidth > width)
      out.push(`document ${document.documentElement.scrollWidth}>${width}`);
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(" ")[0] : ""}`;
    for (const el of document.querySelectorAll("main *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (getComputedStyle(el).position === "fixed") continue;
      if (r.right > width + 0.5 || r.left < -0.5) out.push(describe(el));
    }
    // Text can overflow its own (correctly sized) box, e.g. keep-all words.
    const walker = document.createTreeWalker(
      document.querySelector("main")!,
      NodeFilter.SHOW_TEXT,
    );
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      range.selectNodeContents(node);
      const r = range.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.right > width + 0.5)
        out.push(
          `text in ${describe(node.parentElement!)}: ${node.textContent.trim().slice(0, 24)}`,
        );
    }
    return out;
  }, width);
}
async function seedLongRecords(page: Page) {
  await tab(page, "수집함");
  await page.getByRole("button", { name: "원문 등록", exact: true }).click();
  await page.getByLabel("원문 제목", { exact: true }).fill(LONG_TITLE);
  await page.getByLabel("원문 내용", { exact: true }).fill(LONG_RAW);
  await page.getByLabel("원문 링크", { exact: true }).fill(LONG_URL);
  await page.getByLabel("요청자 역할", { exact: true }).fill(LONG_EN);
  await page.getByLabel("수집 일시", { exact: true }).fill("2026-11-20T10:00");
  await save(page);
  // Edit once so a revision exists (history must render without overflow too).
  await page
    .getByRole("article", { name: `${LONG_TITLE} 원문`, exact: true })
    .getByRole("button", { name: "수정", exact: true })
    .click();
  await page
    .getByLabel("원문 내용", { exact: true })
    .fill(LONG_RAW + "\n수정본");
  await save(page);
  await page
    .getByRole("article", { name: `${LONG_TITLE} 원문`, exact: true })
    .getByRole("button", { name: "과제로 만들기", exact: true })
    .click();
  await page.getByLabel("과제 프로젝트", { exact: true }).selectOption(COACH);
  await page.getByLabel("문제", { exact: true }).fill(LONG_RAW);
  await page.getByLabel("담당", { exact: true }).fill(LONG_EN);
  await page.getByLabel("우선순위", { exact: true }).selectOption("high");
  await page.getByLabel("목표 월", { exact: true }).fill("2026-11");
  await save(page);
}
async function openAllDetails(page: Page) {
  await page.evaluate(() =>
    document.querySelectorAll("main details").forEach((d) => {
      (d as HTMLDetailsElement).open = true;
    }),
  );
}

test("long titles, English, URLs and raw text do not overflow horizontally", async ({
  page,
}, info) => {
  await boot(page);
  await seedLongRecords(page);
  // Long project / client names on the projects tab.
  await tab(page, "홈");
  await page
    .getByRole("button", { name: "프로젝트 추가", exact: true })
    .click();
  await page.getByLabel("프로젝트 이름", { exact: true }).fill(LONG_PROJECT);
  await page.getByLabel("프로젝트 설명", { exact: true }).fill(LONG_RAW);
  await save(page);
  await page.getByRole("button", { name: "고객사 추가", exact: true }).click();
  await page
    .getByLabel("고객사 이름", { exact: true })
    .fill(`합성 고객사 ${LONG_EN}`);
  await save(page);
  await capture(page, info.project.name, "projects");
  expect.soft(await overflow(page)).toEqual([]);

  await tab(page, "수집함");
  await openAllDetails(page);
  await capture(page, info.project.name, "inbox");
  expect.soft(await overflow(page)).toEqual([]);
  // Editors with long content (checkbox labels, textarea, select options).
  await page
    .getByRole("article", { name: `${LONG_TITLE} 원문`, exact: true })
    .getByRole("button", { name: "기존 과제 연결", exact: true })
    .click();
  expect.soft(await overflow(page)).toEqual([]);
  await page.getByRole("button", { name: "취소", exact: true }).click();

  await tab(page, "과제");
  await openAllDetails(page);
  await capture(page, info.project.name, "work");
  expect.soft(await overflow(page)).toEqual([]);
  await page
    .getByRole("article", { name: `${LONG_TITLE} 과제`, exact: true })
    .getByRole("button", { name: "수정", exact: true })
    .click();
  expect.soft(await overflow(page)).toEqual([]);
});

async function openSourceEditor(page: Page) {
  await tab(page, "수집함");
  const add = page.getByRole("button", { name: "원문 등록", exact: true });
  await add.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "원문 등록", exact: true }),
  ).toBeFocused();
  return add;
}

test("closing an editor returns focus to the button that opened it", async ({
  page,
}) => {
  await boot(page);
  // Keyboard: open → cancel.
  const add = await openSourceEditor(page);
  await page.getByRole("button", { name: "취소", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".editor")).toHaveCount(0);
  await expect(add).toBeFocused();
  // Keyboard: open → save.
  await page.keyboard.press("Enter");
  await page.getByLabel("원문 제목", { exact: true }).fill("포커스 합성 원문");
  await page.getByLabel("원문 내용", { exact: true }).fill("합성 내용");
  await page.getByLabel("수집 일시", { exact: true }).fill("2026-11-20T10:00");
  await page
    .getByRole("button", { name: "확인하고 저장", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".editor")).toHaveCount(0);
  await expect(add).toBeFocused();
  // Row action button survives the save and gets focus back.
  const edit = page
    .getByRole("article", { name: "포커스 합성 원문 원문", exact: true })
    .getByRole("button", { name: "수정", exact: true });
  await edit.focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("요청자 역할", { exact: true }).fill("합성 역할");
  await page
    .getByRole("button", { name: "확인하고 저장", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".editor")).toHaveCount(0);
  await expect(edit).toBeFocused();
  // Pointer/touch: WebKit does not focus a clicked button, still restored.
  await tab(page, "홈");
  const client = page.getByRole("button", { name: "고객사 추가", exact: true });
  await client.click();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(client).toBeFocused();
});

test("errors are linked to fields, focus moves to them, and typed input is kept", async ({
  page,
}, info) => {
  await boot(page);
  await openSourceEditor(page);
  const title = page.getByLabel("원문 제목", { exact: true }),
    raw = page.getByLabel("원문 내용", { exact: true }),
    link = page.getByLabel("원문 링크", { exact: true });
  await title.fill("오류 합성 원문");
  await raw.fill("합성 내용 유지");
  await link.fill("ftp://synthetic.invalid/file");
  await page
    .getByRole("button", { name: "확인하고 저장", exact: true })
    .click();
  const alert = page.locator("main").getByRole("alert");
  await expect(alert).toBeVisible();
  await capture(page, info.project.name, "error");
  await expect(alert).toContainText("원문 링크: http 또는 https 링크");
  await expect(link).toBeFocused();
  await expect(link).toHaveAttribute("aria-invalid", "true");
  await expect(link).toHaveAttribute("aria-describedby", "editor-error");
  await expect(link).toHaveAccessibleDescription(/http 또는 https 링크/);
  await expect(title).not.toHaveAttribute("aria-invalid", "true");
  await expect(title).toHaveValue("오류 합성 원문");
  await expect(raw).toHaveValue("합성 내용 유지");
  await expect(link).toHaveValue("ftp://synthetic.invalid/file");
  expect(
    await page.evaluate(
      (key) =>
        JSON.parse(localStorage.getItem(key) || '{"sources":[]}').sources
          .length,
      KEY,
    ),
  ).toBe(0);
  // Editing the field clears its invalid state.
  await link.fill("https://synthetic.invalid/ok");
  await expect(link).not.toHaveAttribute("aria-invalid", "true");

  // Storage failure (no field to blame): focus the message, keep input.
  await page.evaluate(() => {
    (window as unknown as { __setItem: unknown }).__setItem =
      Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
  });
  await page
    .getByRole("button", { name: "확인하고 저장", exact: true })
    .click();
  await expect(alert).toBeFocused();
  await expect(raw).toHaveValue("합성 내용 유지");
  await page.evaluate(() => {
    Storage.prototype.setItem = (
      window as unknown as {
        __setItem: Storage["setItem"];
      }
    ).__setItem;
  });
  await save(page);

  // Duplicate confirmation checkbox is the invalid control.
  for (let i = 0; i < 2; i++) {
    await page
      .getByRole("article", { name: "오류 합성 원문 원문", exact: true })
      .getByRole("button", { name: "과제로 만들기", exact: true })
      .click();
    await page.getByLabel("과제 제목", { exact: true }).fill("합성 중복 과제");
    await page
      .getByRole("button", { name: "확인하고 저장", exact: true })
      .click();
  }
  const confirm = page.getByLabel("서로 다른 과제임을 확인했습니다", {
    exact: true,
  });
  await expect(confirm).toBeFocused();
  await expect(confirm).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("과제 제목", { exact: true })).toHaveValue(
    "합성 중복 과제",
  );
  await page.getByRole("button", { name: "취소", exact: true }).click();
});

test("detail labels are Korean while stored values and times stay unchanged", async ({
  page,
}) => {
  await boot(page);
  await openSourceEditor(page);
  await page.getByLabel("원문 제목", { exact: true }).fill("표시 합성 원문");
  await page.getByLabel("원문 내용", { exact: true }).fill("합성 내용");
  await page.getByLabel("수집 일시", { exact: true }).fill("2026-11-20T10:00");
  await save(page);
  await page
    .getByRole("article", { name: "표시 합성 원문 원문", exact: true })
    .getByRole("button", { name: "과제로 만들기", exact: true })
    .click();
  await page.getByLabel("과제 프로젝트", { exact: true }).selectOption(COACH);
  await page.getByLabel("우선순위", { exact: true }).selectOption("high");
  await page.getByLabel("목표 월", { exact: true }).fill("2026-11");
  await page
    .getByLabel("기획 일시 (선택)", { exact: true })
    .fill("2026-11-21T09:30");
  await save(page);
  const state = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    KEY,
  );
  const [src] = state.sources,
    [work] = state.initiatives;
  expect([src.sourceType, src.sensitivity]).toEqual(["manual", "internal"]);
  expect([work.category, work.priority]).toEqual(["improvement", "high"]);

  await tab(page, "과제");
  const card = page.getByRole("article", {
    name: "표시 합성 원문 과제",
    exact: true,
  });
  await openAllDetails(page);
  const text = await card.innerText();
  expect(text).not.toMatch(/\b(manual|internal|improvement|high)\b/);
  expect(text).toContain("출처: 직접 입력 · 민감도: 내부");
  await expect(card.locator(".detail-fields")).toContainText("유형개선");
  await expect(card.locator(".detail-fields")).toContainText("우선순위높음");
  await expect(card).toContainText("과제 저장");
  // Stored instants are shown verbatim (seconds, offset, UTC suffix).
  expect(text).toContain(`수집: ${src.collectedAt}`);
  expect(text).toContain(work.plannedAt);
  expect(text).toContain(state.audit.at(-1).at);
  await expect(card).toContainText("업무 상태와 측정 준비는 별도로 관리합니다");
  // Phase 2 adds a derived readiness summary beside the actions. The details
  // themselves must still avoid the old hardcoded status.
  const details = card.locator("details").first();
  await expect(details).not.toContainText("측정 준비: 미준비");
  await expect(
    card.getByRole("button", { name: "측정 계획", exact: true }),
  ).toBeVisible();
});

test("touch targets ≥44px, bottom menu reachable, save button not covered", async ({
  page,
}, info) => {
  await boot(page);
  await openSourceEditor(page);
  await page.getByLabel("원문 제목", { exact: true }).fill("터치 합성 원문");
  await page.getByLabel("원문 내용", { exact: true }).fill("합성 내용");
  await page
    .getByLabel("원문 링크", { exact: true })
    .fill("https://synthetic.invalid/doc");
  await page.getByLabel("수집 일시", { exact: true }).fill("2026-11-20T10:00");
  await save(page);
  await openAllDetails(page);
  await page
    .getByRole("article", { name: "터치 합성 원문 원문", exact: true })
    .getByRole("button", { name: "과제로 만들기", exact: true })
    .click();
  const small = await page.evaluate(() => {
    const out: string[] = [];
    const controls = document.querySelectorAll<HTMLElement>(
      "main :is(button, a[href], select, input, textarea, summary)",
    );
    for (const el of controls) {
      const target =
        el instanceof HTMLInputElement &&
        ["checkbox", "radio"].includes(el.type)
          ? el.closest("label") || el
          : el;
      const r = target.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.height < 44 || r.width < 44)
        out.push(
          `${target.tagName.toLowerCase()} "${target.textContent?.trim().slice(0, 16)}" ${Math.round(r.width)}×${Math.round(r.height)}`,
        );
    }
    return out;
  });
  expect.soft(small).toEqual([]);

  // Keyboard focus on the editor's last button is not hidden by the menu.
  // Worst case: the button is already "in the viewport" but under the fixed
  // bottom menu, so the browser would not scroll for it by itself.
  const submit = page.getByRole("button", {
    name: "확인하고 저장",
    exact: true,
  });
  await page
    .getByRole("checkbox", { name: "터치 합성 원문", exact: true })
    .focus();
  await submit.evaluate((el) =>
    scrollBy(0, el.getBoundingClientRect().bottom - innerHeight + 10),
  );
  await page.keyboard.press("Tab");
  await expect(submit).toBeFocused();
  await capture(page, info.project.name, "save", false);
  const hit = await submit.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const n = document.querySelector(".workspace-nav")!.getBoundingClientRect();
    const overlapsMenu =
      r.left < n.right &&
      r.right > n.left &&
      r.top < n.bottom &&
      r.bottom > n.top;
    const top = document.elementFromPoint(r.left + r.width / 2, r.bottom - 4);
    return {
      inViewport: r.top >= 0 && r.bottom <= innerHeight,
      overlapsMenu,
      onTop: top === el || el.contains(top),
    };
  });
  expect
    .soft(hit)
    .toEqual({ inViewport: true, overlapsMenu: false, onTop: true });
  await page.getByRole("button", { name: "취소", exact: true }).click();

  // Bottom menu: each item ≥52px on mobile, inside the viewport, keyboard usable.
  const menu = nav(page);
  const viewport = page.viewportSize()!;
  for (const name of ["홈", "수집함", "과제", "설정"]) {
    const box = (await menu
      .getByRole("button", { name, exact: true })
      .boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(
      info.project.name === "chromium-desktop" ? 44 : 52,
    );
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
  }
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await menu.getByRole("button", { name: "과제", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "과제", exact: true }),
  ).toBeVisible();
  await expect(
    menu.getByRole("button", { name: "과제", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});
