import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createState,
  decodeState,
  type Runtime,
} from "../../src/features/records/model";
import {
  caseStudy,
  caseStudyText,
} from "../../src/features/records/case-study";

// Synthetic records only.
let n = 0;
const runtime: Runtime = {
  session: {
    mode: "synthetic",
    ownerId: "00000000-0000-4000-8000-000000000010",
    workspaceId: "00000000-0000-4000-8000-000000000001",
  },
  now: () => "2026-11-26T01:00:00.000Z",
  id: () => `00000000-0000-4000-8000-${String(100 + n++).padStart(12, "0")}`,
};

describe("case study (portfolio)", () => {
  it("old initiatives load with empty case-study fields (no data loss)", () => {
    const s = createState(runtime.session);
    const raw = JSON.parse(JSON.stringify(s));
    const project = raw.workspace.projects[0].id;
    raw.initiatives.push({
      projectId: project,
      title: "합성 과제",
      problem: "",
      targetSegment: "",
      expectedChange: "",
      category: "fix",
      priority: "medium",
      assignee: "",
      contribution: "",
      decisionReason: "",
      alternative: "",
      plannedAt: null,
      targetMonth: null,
      status: "draft",
      id: "00000000-0000-4000-8000-000000000900",
      measurementStatus: "not_ready",
      mergedInto: null,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    });
    const loaded = decodeState(raw);
    const w = loaded.initiatives[0];
    expect(w.title).toBe("합성 과제");
    expect([w.specUrl, w.retro, w.frictions, w.releasedAt]).toEqual([
      "",
      "",
      [],
      null,
    ]);
  });

  it("builds eight lines from records only; missing parts stay missing", () => {
    let s = createState(runtime.session);
    const project = s.workspace.projects[0].id;
    s = applyCommand(
      s,
      {
        type: "source.save",
        data: {
          title: "합성 요청",
          rawText: "결과 화면에서 다시하기 버튼이 안 돼요",
          sourceType: "slack",
          reference: "",
          collectedAt: "2026-11-02T00:00:00.000Z",
          requesterRole: "",
          sensitivity: "internal",
        },
      },
      runtime,
    );
    const sourceId = s.sources[0].id;
    s = applyCommand(
      s,
      {
        type: "initiative.save",
        sourceIds: [sourceId],
        data: {
          projectId: project,
          title: "다시하기 버튼 수정",
          problem: "결과 화면에서 다시 시작할 수 없음",
          targetSegment: "",
          expectedChange: "재시작 비율 증가",
          category: "fix",
          priority: "high",
          assignee: "",
          contribution: "원인 분석과 기획",
          decisionReason: "요청 반복",
          alternative: "",
          plannedAt: null,
          targetMonth: "2026-12",
          status: "released",
          siteUrl: "https://example.invalid/coach",
          changeSummary: "버튼 위치 이동",
          expectedUsage: "",
          releasedAt: "2026-11-20T15:30:00.000Z",
          frictions: [
            { point: "버튼이 작음", outcome: "happened", note: "" },
            { point: "문구 혼동", outcome: "unknown", note: "" },
          ],
          retro: "",
          nextTime: "",
        },
      },
      runtime,
    );
    const work = s.initiatives[0];
    const lines = caseStudy(work, s);
    const by = Object.fromEntries(lines.map((l) => [l.key, l]));
    expect(by.problem.text).toBe(
      "결과 화면에서 다시 시작할 수 없음 · 근거 원문 1건(Slack 1)",
    );
    expect(by.decision.text).toContain("배포됨");
    expect(by.change.text).toBe(
      "버튼 위치 이동 · 사이트 https://example.invalid/coach",
    );
    // Day is in the project time zone, not UTC.
    const zone = s.workspace.projects[0].timezone;
    expect(by.result.text).toContain(
      zone === "Asia/Seoul" ? "배포 2026-11-21" : "배포 2026-11-2",
    );
    expect(by.result.text).toContain(
      "예상 막힘 2곳 중 실제 발생 1, 발생 안 함 0, 미확인 1",
    );
    expect(by.business.missing).toBe(true); // never inferred
    expect(by.retro.missing).toBe(true);
    expect(caseStudyText(work, lines)).toContain("8. 회고: (미작성)");
    expect(caseStudy(work, s)).toEqual(lines); // deterministic
  });
});

describe("flow stages", () => {
  it("marks each stage from records only; declined is flagged", async () => {
    const { flowStages } =
      await import("../../src/features/records/case-study");
    let s = createState(runtime.session);
    const p = s.workspace.projects[0].id;
    s = applyCommand(
      s,
      {
        type: "initiative.save",
        sourceIds: [],
        data: {
          projectId: p,
          title: "합성 단계",
          problem: "",
          targetSegment: "",
          expectedChange: "",
          category: "fix",
          priority: "medium",
          assignee: "",
          contribution: "",
          decisionReason: "",
          alternative: "",
          plannedAt: null,
          targetMonth: null,
          status: "approved",
          changeSummary: "버튼 이동",
        },
      },
      runtime,
    );
    const w = s.initiatives.at(-1)!;
    const f = flowStages(w, s, false);
    expect(f.stages.map((x) => [x.key, x.done])).toEqual([
      ["collect", false],
      ["decide", true],
      ["change", true],
      ["release", false],
      ["impact", false],
    ]);
    expect(f.declined).toBe(false);
    expect(flowStages({ ...w, status: "canceled" }, s, false).declined).toBe(
      true,
    );
  });
});
