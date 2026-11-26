import { test, expect, type Page } from "@playwright/test";

// Synthetic texts only; no mail or chat service is contacted.
const KEY =
  "pmzip:synthetic:v1:00000000-0000-4000-8000-000000000010:00000000-0000-4000-8000-000000000001";
const chat = [
  "[오후 2:10] 김합성: 오늘 회의 수고하셨습니다",
  "[오후 2:11] 이합성: 시뮬레이션 결과 화면에서 다시하기 버튼이 안 돼요",
  "[오후 2:12] 김합성: 다음 주까지 영어 음성 속도 조절 기능 필요합니다",
].join("\n");

test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname))
      throw new Error("Unexpected external request: " + url.origin);
    await route.continue();
  });
});
async function openIntake(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Demo Coach", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "워크스페이스 메뉴" })
    .getByRole("button", { name: "통합 수집함", exact: true })
    .click();
  const intake = page.getByRole("region", { name: "요구사항 수집" });
  await expect(intake).toBeVisible();
  return intake;
}
const stored = (page: Page) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), KEY);
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
        if (!n.textContent?.trim() || n.parentElement?.closest("pre")) continue;
        range.selectNodeContents(n);
        const r = range.getBoundingClientRect();
        if (r.width && r.right > w + 0.5)
          out.push(n.textContent.trim().slice(0, 30));
      }
      return out;
    }, width),
  ).toEqual([]);
}

test("paste → rule-based candidates → confirm → 원문 + 과제 drafts; duplicates blocked", async ({
  page,
}) => {
  const intake = await openIntake(page);
  await intake
    .getByLabel("어디서 온 내용인가요")
    .selectOption({ label: "카카오톡·메신저" });
  await intake.getByLabel("붙여넣을 내용").fill(chat);
  await intake.getByRole("button", { name: "요구사항 후보 찾기" }).click();
  await expect(intake.getByRole("status").first()).toHaveText("1건 · 후보 2개");
  const review = intake.getByRole("article");
  await expect(review).toContainText("오류");
  await expect(review).toContainText("기한: 다음 주까지");
  expect(await stored(page)).toBeNull(); // nothing saved before confirm
  await noOverflow(page);

  await intake.getByLabel("선택한 후보로 과제 초안도 만들기").check();
  await intake
    .getByLabel("과제 프로젝트")
    .selectOption({ label: "Demo Coach" });
  // Edit one title and drop nothing.
  await intake.getByLabel("후보 제목").first().fill("다시하기 버튼 오류");
  await intake
    .getByRole("button", { name: "수집함에 등록 (원문 1건 · 과제 초안 2건)" })
    .click();
  await expect(intake.getByRole("status")).toContainText(
    "원문 1건, 과제 초안 2건을 등록했습니다.",
  );

  const state = await stored(page);
  expect(state.sources).toHaveLength(1);
  expect(state.sources[0].rawText).toBe(chat); // original kept exactly
  expect(
    state.initiatives.map(
      (w: { title: string; status: string; category: string }) => [
        w.title,
        w.status,
        w.category,
      ],
    ),
  ).toEqual([
    ["다시하기 버튼 오류", "draft", "fix"],
    ["다음 주까지 영어 음성 속도 조절 기능 필요합니다", "draft", "improvement"],
  ]);
  expect(state.links).toHaveLength(2);
  expect(state.sources[0].status).toBe("linked");

  // Same text again: flagged as already collected and not selectable.
  await intake.getByLabel("붙여넣을 내용").fill(chat);
  await intake.getByRole("button", { name: "요구사항 후보 찾기" }).click();
  await expect(intake.getByRole("status").first()).toContainText(
    "이미 수집함에 있음 1건",
  );
  await expect(
    intake.getByRole("button", { name: /수집함에 등록/ }),
  ).toBeDisabled();
});

test("Gmail·Calendar export file: review, skip items without candidates, keep links", async ({
  page,
}) => {
  const intake = await openIntake(page);
  await intake.getByRole("button", { name: "Gmail·캘린더 파일" }).click();
  await intake
    .getByLabel("Gmail·캘린더 내보내기 파일")
    .setInputFiles("tests/fixtures/inbox-export.synthetic.json");
  await expect(intake.getByRole("status").first()).toContainText("3건 · 후보");
  const weekly = intake.getByRole("article", {
    name: "[합성] 주간 공유 수집 후보",
  });
  await expect(weekly).toContainText("요구사항 후보를 찾지 못했습니다");
  await expect(weekly.getByRole("checkbox").first()).not.toBeChecked();
  await intake
    .getByRole("button", { name: "수집함에 등록 (원문 2건)" })
    .click();
  await expect(intake.getByRole("status")).toContainText(
    "원문 2건을 등록했습니다.",
  );
  const state = await stored(page);
  expect(
    state.sources.map(
      (s: { sourceType: string; reference: string; requesterRole: string }) => [
        s.sourceType,
        s.reference,
        s.requesterRole,
      ],
    ),
  ).toEqual([
    [
      "mail",
      "https://mail.google.com/mail/u/0/#all/synthetic001",
      "보낸 곳 @example.invalid",
    ],
    ["other", "https://www.google.com/calendar/event?eid=c3ludGhldGlj", ""],
  ]);
  expect(state.initiatives).toHaveLength(0);
  // Re-import: both already collected.
  await intake
    .getByLabel("Gmail·캘린더 내보내기 파일")
    .setInputFiles("tests/fixtures/inbox-export.synthetic.json");
  await expect(intake.getByRole("status").first()).toContainText(
    "이미 수집함에 있음 2건",
  );
  await noOverflow(page);
});
