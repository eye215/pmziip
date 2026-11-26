import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  createState,
  applyCommand,
  type Runtime,
} from "../../src/features/records/model";
const KEY =
    "pmzip:synthetic:v1:00000000-0000-4000-8000-000000000010:00000000-0000-4000-8000-000000000001",
  COACH = "00000000-0000-4000-8000-000000000003",
  SURVEY = "00000000-0000-4000-8000-000000000004";
function seed() {
  let index = 100;
  const r: Runtime = {
    session: {
      mode: "synthetic",
      ownerId: "00000000-0000-4000-8000-000000000010",
      workspaceId: "00000000-0000-4000-8000-000000000001",
    },
    id: () => `00000000-0000-4000-8000-${String(index++).padStart(12, "0")}`,
    now: () => "2026-11-25T00:00:00.000Z",
  };
  let s = createState(r.session);
  s = applyCommand(
    s,
    {
      type: "source.save",
      data: {
        title: "합성 공통 원문",
        rawText: "입력 단계 줄이기\n응답 품질 점검",
        sourceType: "manual",
        reference: "",
        collectedAt: r.now(),
        requesterRole: "",
        sensitivity: "internal",
      },
    },
    r,
  );
  for (const [projectId, title] of [
    [COACH, "입력 개선"],
    [COACH, "위젯 개선"],
    [COACH, "QA 개선"],
    [SURVEY, "분석 개선"],
  ])
    s = applyCommand(
      s,
      {
        type: "initiative.save",
        data: {
          projectId,
          title,
          problem: "합성 문제",
          targetSegment: "합성 대상",
          expectedChange: "개선",
          category: "improvement",
          priority: "medium",
          assignee: "",
          contribution: "",
          decisionReason: "",
          alternative: "",
          plannedAt: null,
          targetMonth: "2026-11",
          status: "draft",
        },
        sourceIds: title === "입력 개선" ? [s.sources[0].id] : [],
      },
      r,
    );
  const base: Record<string, unknown> = JSON.parse(JSON.stringify(s));
  delete base.measurement;
  const raw = JSON.stringify({ ...base, schemaVersion: 1 });
  return { state: s, raw };
}
async function boot(page: Page) {
  const fixture = seed();
  await page.addInitScript(
    ([key, raw]) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, raw);
    },
    [KEY, fixture.raw],
  );
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname))
      throw new Error("External request: " + url.origin);
    await route.continue();
  });
  await page.goto("/");
  await page
    .getByRole("article", { name: "Demo Coach 프로젝트", exact: true })
    .getByRole("button", { name: "지표·전략", exact: true })
    .click();
  return fixture;
}
async function section(page: Page, label: string) {
  await page
    .getByRole("navigation", { name: "측정 메뉴" })
    .getByRole("button", { name: label, exact: true })
    .click();
}
async function save(page: Page) {
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await expect(page.locator(".measurement-editor")).toHaveCount(0);
}
async function approveMetric(page: Page, name = "REPORT 이벤트 완료율") {
  await section(page, "지표 사전");
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("article", { name: `${name} v1 지표`, exact: true })
    .getByRole("button", { name: "정의 승인", exact: true })
    .click();
  await expect(
    page.getByRole("article", { name: `${name} v1 지표`, exact: true }),
  ).toContainText("승인됨");
  await section(page, "측정 계획");
}
const stored = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), KEY);

test("rule draft → definition approval → independent plan approval → ready successor and Markdown", async ({
  page,
}, info) => {
  const fixture = await boot(page);
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(
    fixture.raw,
  );
  await page
    .getByRole("button", { name: "규칙 기반 초안 만들기", exact: true })
    .click();
  await expect(
    page.getByRole("article", { name: "측정 계획 v1", exact: true }),
  ).toContainText("미승인 초안");
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key + ":before-v2:5"),
      KEY,
    ),
  ).toBe(fixture.raw);
  await approveMetric(page);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("article", { name: "측정 계획 v1", exact: true })
    .getByRole("button", { name: "계획 승인", exact: true })
    .click();
  await expect(
    page.getByText("측정 준비: 준비 일부 누락", { exact: true }),
  ).toBeVisible();
  const original = await stored(page);
  await page.getByRole("button", { name: "계획 새 버전", exact: true }).click();
  await page
    .getByRole("article", { name: "측정 계획 v2", exact: true })
    .getByRole("button", { name: "계획 초안 수정", exact: true })
    .click();
  await page
    .getByLabel("KPI 1 기준값 상태", { exact: true })
    .selectOption("available");
  await page.getByLabel("KPI 1 기준값", { exact: true }).fill("0");
  await page
    .getByLabel("KPI 1 기준값 근거·해당 없음 사유", { exact: true })
    .fill("합성 기준값 확인");
  await page
    .getByLabel("KPI 1 로그 확인", { exact: true })
    .selectOption("available");
  await page
    .getByLabel("KPI 1 로그 근거", { exact: true })
    .fill("합성 필드 확인");
  await page.getByLabel("KPI 1 데이터 담당", { exact: true }).fill("데모 담당");
  await page
    .getByLabel("KPI 1 요청 데이터 형식", { exact: true })
    .fill("CSV · UTF-8 · 기간별 집계");
  await page.getByLabel("미확인 사항 (한 줄에 하나)", { exact: true }).fill("");
  await page.getByLabel("측정 QA", { exact: true }).selectOption("passed");
  await page.getByLabel("QA 확인 근거", { exact: true }).fill("합성 QA 확인");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await save(page);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("article", { name: "측정 계획 v2", exact: true })
    .getByRole("button", { name: "계획 승인", exact: true })
    .click();
  await expect(
    page.getByText("측정 준비: 준비 확인됨", { exact: true }),
  ).toBeVisible();
  const next = await stored(page);
  expect(next.measurement.plans[0]).toEqual(original.measurement.plans[0]);
  expect(next.measurement.plans[1].metrics[0].baselineValue).toBe(0);
  expect(next.measurement.plans[1].metrics[0].targetValue).toBeNull();
  const download = page.waitForEvent("download");
  await page
    .getByRole("article", { name: "측정 계획 v2", exact: true })
    .getByRole("button", { name: "데이터 요청서 내려받기", exact: true })
    .click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("pmzip-data-request-v2.md");
  expect(await readFile((await file.path())!, "utf8")).toContain("기준값: 0");
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("synthetic denied");
        },
      },
    }),
  );
  const copyButton = page
    .getByRole("article", { name: "측정 계획 v2", exact: true })
    .getByRole("button", { name: "데이터 요청서 복사", exact: true });
  await copyButton.click();
  await expect(
    page.getByText(
      "복사하지 못했습니다. 데이터 요청서 내려받기를 사용해 주세요.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as unknown as { copiedRequest: string }).copiedRequest =
            value;
        },
      },
    }),
  );
  await copyButton.click();
  await expect(
    page.getByText("데이터 요청서를 복사했습니다.", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { copiedRequest: string }).copiedRequest,
    ),
  ).toContain("CSV · UTF-8 · 기간별 집계");
  expect((await stored(page)).measurement.plans).toEqual(
    next.measurement.plans,
  );
  await page.reload();
  await expect(
    page.getByText("측정 준비: 준비 확인됨", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => scrollTo(0, 0));
  const kpiName = page.locator(".measurement-kpis li strong").first();
  expect(
    await kpiName.evaluate(
      (node) =>
        node.getBoundingClientRect().width >=
        node.parentElement!.getBoundingClientRect().width * 0.8,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("phase2-plans.png"),
    fullPage: true,
  });
});

test("three tasks select distinct KPIs without overwriting an existing draft", async ({
  page,
}) => {
  const fixture = await boot(page);
  for (const [index, goal] of [
    [0, "report-rate"],
    [1, "task-success"],
    [2, "qa-pass"],
  ] as const) {
    await page
      .getByLabel("측정할 과제", { exact: true })
      .selectOption(fixture.state.initiatives[index].id);
    await page
      .getByLabel("초안의 지표 유형", { exact: true })
      .selectOption(goal);
    await page
      .getByRole("button", { name: "규칙 기반 초안 만들기", exact: true })
      .click();
    await expect(
      page.getByRole("article", { name: "측정 계획 v1", exact: true }),
    ).toBeVisible();
  }
  const before = await stored(page);
  await page
    .getByRole("button", { name: "규칙 기반 초안 만들기", exact: true })
    .click();
  await expect(
    page.getByText(
      "작성 중인 초안을 먼저 확인해 주세요. 자동 덮어쓰지 않습니다.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(await stored(page)).toEqual(before);
  expect(before.measurement.metrics).toHaveLength(3);
  expect(before.measurement.plans).toHaveLength(3);
  await section(page, "지표 사전");
  await page
    .getByRole("article", { name: "태스크 성공률 v1 지표", exact: true })
    .getByRole("button", { name: "초안 수정", exact: true })
    .click();
  await page
    .getByLabel("지표 이름", { exact: true })
    .fill("아직 저장하지 않은 이름");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("article", { name: "AI 정책·QA 준수율 v1 지표", exact: true })
    .getByRole("button", { name: "초안 수정", exact: true })
    .click();
  await expect(page.getByLabel("지표 이름", { exact: true })).toHaveValue(
    "AI 정책·QA 준수율",
  );
  expect(await stored(page)).toEqual(before);
});

test("dictionary successor and monthly strategy copy keep old references unchanged", async ({
  page,
}, info) => {
  await boot(page);
  await page
    .getByRole("button", { name: "규칙 기반 초안 만들기", exact: true })
    .click();
  await approveMetric(page);
  await section(page, "월별 전략");
  await page.getByRole("button", { name: "전략 작성", exact: true }).click();
  await page.getByLabel("핵심 테마", { exact: true }).fill("입력 품질");
  await page
    .getByLabel("월별 목표 (사용자 결정)", { exact: true })
    .fill("기준값 확보");
  await page.getByRole("checkbox", { name: "입력 개선", exact: true }).check();
  await page
    .getByRole("checkbox", { name: "REPORT 이벤트 완료율 · v1", exact: true })
    .check();
  await save(page);
  await page.getByLabel("복사할 대상 월", { exact: true }).fill("2026-12");
  await page
    .getByRole("button", { name: "선택 월로 복사", exact: true })
    .click();
  await expect(
    page.getByRole("article", { name: "2026-12 입력 품질 전략", exact: true }),
  ).toBeVisible();
  const original = await stored(page);
  await section(page, "지표 사전");
  await page.getByRole("button", { name: "새 버전 초안", exact: true }).click();
  await page
    .getByRole("article", { name: "REPORT 이벤트 완료율 v2 지표", exact: true })
    .getByRole("button", { name: "초안 수정", exact: true })
    .click();
  await page.getByLabel("지표 이름", { exact: true }).fill("REPORT 정의 개정");
  await save(page);
  const next = await stored(page);
  expect(next.measurement.metricVersions[0]).toEqual(
    original.measurement.metricVersions[0],
  );
  expect(next.measurement.strategies).toEqual(original.measurement.strategies);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("phase2-metrics.png"),
    fullPage: true,
  });
  await section(page, "월별 전략");
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("phase2-strategies.png"),
    fullPage: true,
  });
});

test("source split is a review-only proposal until explicit project mapping and approval", async ({
  page,
}) => {
  await boot(page);
  await page
    .getByRole("navigation", { name: "워크스페이스 메뉴" })
    .getByRole("button", { name: "수집함", exact: true })
    .click();
  await page
    .getByRole("button", { name: "분리 초안 검토", exact: true })
    .click();
  await page
    .getByLabel("분리 초안 1 프로젝트", { exact: true })
    .selectOption(COACH);
  await page
    .getByLabel("분리 초안 2 프로젝트", { exact: true })
    .selectOption(SURVEY);
  const original = await stored(page);
  await page
    .getByRole("button", { name: "선택 초안 등록", exact: true })
    .click();
  await expect(
    page.getByText("초안·프로젝트·원문 연결을 먼저 확인해 주세요.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(await stored(page)).toEqual(original);
  await page
    .getByLabel("선택한 초안과 프로젝트 연결을 확인했습니다", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "선택 초안 등록", exact: true })
    .click();
  await expect(
    page.getByText("원문을 복사하지 않고 과제 초안을 연결했습니다.", {
      exact: true,
    }),
  ).toBeVisible();
  const next = await stored(page);
  expect(next.sources).toEqual(
    original.sources.map((s: { status: string }) => ({
      ...s,
      status: "linked",
    })),
  );
  expect(next.initiatives).toHaveLength(6);
  expect(
    next.initiatives.slice(-2).map((w: { projectId: string }) => w.projectId),
  ).toEqual([COACH, SURVEY]);
});

test("v1 backup write failure and cancelled navigation keep both old bytes and current form", async ({
  page,
}) => {
  const fixture = await boot(page);
  await section(page, "지표 사전");
  await page.getByRole("button", { name: "지표 만들기", exact: true }).click();
  await page.getByLabel("지표 이름", { exact: true }).fill("보존할 초안");
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("navigation", { name: "워크스페이스 메뉴" })
    .getByRole("button", { name: "홈", exact: true })
    .click();
  await expect(page.getByLabel("지표 이름", { exact: true })).toHaveValue(
    "보존할 초안",
  );
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.includes(":before-v2:"))
        throw new DOMException("quota", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("지표 이름", { exact: true })).toHaveValue(
    "보존할 초안",
  );
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(
    fixture.raw,
  );
});
