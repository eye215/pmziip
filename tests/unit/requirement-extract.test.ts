import { describe, expect, it } from "vitest";
import {
  cleanMessage,
  extractCandidates,
  findDue,
  isTeamsPaste,
  normalizeTeamsPaste,
  splitUnits,
} from "../../src/lib/connectors/requirement-extract";

// Synthetic texts only.
const mail = `안녕하세요, 합성 고객사 담당자입니다.

- 리포트 화면에 국가별 필터를 추가해 주세요.
- 로그인 후 간헐적으로 화면이 멈춤 현상이 있습니다.
- 점수 기준 문구를 '평가 점수'로 변경 부탁드립니다. 11/30까지 가능할까요?
- 지난 회의에서 월간 리포트는 PDF로 제공하기로 했습니다.

감사합니다.
--
합성 담당자
> 이전 메일: 버그 아님`;

describe("requirement candidates (rule-based, deterministic)", () => {
  it("cuts quotes and signatures", () => {
    const c = cleanMessage(
      mail + "\n-----Original Message-----\n추가로 기능 요청",
    );
    expect(c).not.toContain("이전 메일");
    expect(c).not.toContain("합성 담당자");
    expect(c).not.toContain("추가로 기능 요청");
  });
  it("finds requests, bugs, changes and decisions with evidence and due", () => {
    const c = extractCandidates(mail);
    expect(c.map((x) => x.type)).toEqual([
      "request",
      "bug",
      "change",
      "decision",
    ]);
    expect(c[0].title).toBe("리포트 화면에 국가별 필터를 추가해 주세요.");
    expect(c[0].matched).toEqual(expect.arrayContaining(["추가", "해 주세"]));
    expect(c[1].evidence).toContain("멈춤");
    expect(c[2].due).toBe("11/30까지");
    expect(c.every((x) => !x.evidence.includes("감사합니다"))).toBe(true);
    // Same input → same output.
    expect(extractCandidates(mail)).toEqual(c);
  });
  it("splits chat logs by speaker and ignores small talk", () => {
    const chat = [
      "[오후 2:10] 김합성: 오늘 회의 수고하셨습니다",
      "[오후 2:11] 이합성: 시뮬레이션 결과 화면에서 다시하기 버튼이 안 돼요",
      "[오후 2:12] 김합성: 다음 주까지 영어 음성 속도 조절 기능 필요합니다",
      "[오후 2:13] 이합성: 네 확인했습니다",
    ].join("\n");
    const units = splitUnits(chat);
    expect(units[1]).toBe("시뮬레이션 결과 화면에서 다시하기 버튼이 안 돼요");
    const c = extractCandidates(chat);
    expect(c.map((x) => [x.type, x.due])).toEqual([
      ["bug", null],
      ["request", "다음 주까지"],
    ]);
  });
  it("handles English and plain paragraphs", () => {
    const c = extractCandidates(
      "The export fails on large files. Could you add a CSV option? Thanks a lot.",
    );
    expect(c.map((x) => x.type)).toEqual(["bug", "request"]);
  });
  it("returns nothing for text without requirement signals", () => {
    expect(
      extractCandidates("좋은 하루 보내세요. 회의록 공유드립니다."),
    ).toEqual([]);
  });
  it("reads due expressions", () => {
    expect(findDue("2026-12-05까지 반영")).toBe("2026-12-05까지");
    expect(findDue("이번 주 중 확인")).toBe("이번 주 중");
    expect(findDue("언제든지")).toBeNull();
  });
  it("cleans Teams copy-paste (name/time headers, edited, reactions)", () => {
    const newTeams = [
      "김합성",
      "오후 2:10",
      "오늘 회의 수고하셨습니다",
      "이합성",
      "오후 2:11",
      "시뮬레이션 결과 화면에서 다시하기 버튼이 안 돼요",
      "편집됨",
      "좋아요 2",
      "김합성",
      "어제 오후 2:12",
      "다음 주까지 영어 음성 속도 조절 기능 필요합니다",
    ].join("\n");
    expect(isTeamsPaste(newTeams)).toBe(true);
    const norm = normalizeTeamsPaste(newTeams);
    expect(norm).not.toMatch(/합성\n|오후|편집됨|좋아요/);
    expect(norm.split("\n\n")).toHaveLength(3);
    expect(extractCandidates(newTeams).map((x) => [x.type, x.title])).toEqual([
      ["bug", "시뮬레이션 결과 화면에서 다시하기 버튼이 안 돼요"],
      ["request", "다음 주까지 영어 음성 속도 조절 기능 필요합니다"],
    ]);

    const classic = [
      "[오후 2:11] 이합성",
      "리포트에 국가 필터 추가해 주세요",
      "[2:12 PM] Kim Synth",
      "The export fails on large files.",
      "Synth Lee, 2:13 PM",
      "Thanks!",
    ].join("\n");
    expect(extractCandidates(classic).map((x) => x.type)).toEqual([
      "request",
      "bug",
    ]);
  });
  it("leaves ordinary text with a single time alone", () => {
    const t = "내일 회의는 오후 3:00에 합니다.\n로그인 오류가 있습니다.";
    expect(isTeamsPaste(t)).toBe(false);
    expect(extractCandidates(t).map((x) => x.type)).toEqual(["bug"]);
  });
});
