import { describe, expect, it } from "vitest";
import { maskText, parseHidden } from "../../src/features/report/public-export";

// Synthetic names only.
const m = {
  projects: ["Demo Coach", "Demo Coach Pro"],
  clients: ["합성고객"],
  hidden: parseHidden("합성전자, 비밀제품\n합성전자, x"),
};

describe("public export masking", () => {
  it("aliases names (longest first), hides listed words, removes contacts and links", () => {
    expect(m.hidden).toEqual(["합성전자", "비밀제품"]);
    const out = maskText(
      "Demo Coach Pro와 demo coach 개선 · 합성고객 요청 · 합성전자 비밀제품 · 문의 a.b@example.invalid 010-1234-5678 · https://example.invalid/x",
      m,
    );
    expect(out).toBe(
      "프로젝트 B와 프로젝트 A 개선 · 고객사 A 요청 · [비공개] [비공개] · 문의 [이메일] [전화번호] · [링크]",
    );
  });
  it("masks money and large counts; keeps rates, small counts and dates", () => {
    const out = maskText(
      "매출 71조 원, 1.2억, 3,000만 원, $5M, 진입 UU 12,345명, 완료 8000건 · 횟수 완료율 30% → 40% (+10.0%p) · 배포 2026-11-18 · 2025년 · 과제 12개",
      m,
    );
    expect(out).toBe(
      "매출 [수치], [수치], [수치], [수치], 진입 UU [수치]명, 완료 [수치]건 · 횟수 완료율 30% → 40% (+10.0%p) · 배포 2026-11-18 · 2025년 · 과제 12개",
    );
  });
});
