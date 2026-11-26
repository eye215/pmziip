import { describe, expect, it } from "vitest";
import { autoNoticeReason } from "../../src/lib/connectors/auto-notice";
import {
  extractCandidates,
  isBoilerplate,
} from "../../src/lib/connectors/requirement-extract";

// Synthetic notification texts shaped like the real ones (no real data).
const mail = (title: string, body = "", fromDomain: string | null = null) => ({
  channel: "gmail" as const,
  title,
  body,
  fromDomain,
});

describe("automated notification mail", () => {
  it("flags shares, access requests, comments, invites and tool notices", () => {
    expect(
      autoNoticeReason(
        mail('"[합성] 개편안_v1.docx"에 대한 공유 요청', "", "@google.com"),
      ),
    ).toBe("문서 공유·액세스 알림");
    expect(
      autoNoticeReason(
        mail(
          "합성사용자 replied to a thread in 합성 기획",
          "",
          "@email.figma.com",
        ),
      ),
    ).toBe("댓글·멘션 알림");
    expect(autoNoticeReason(mail("초대: 합성 주간 회의"))).toBe(
      "캘린더 초대 알림",
    );
    expect(
      autoNoticeReason(mail("디자인 업데이트", "", "@email.figma.com")),
    ).toBe("Figma 알림");
    expect(
      autoNoticeReason(mail("주간 소식", "수신 거부하려면 여기를 누르세요")),
    ).toBe("자동 발송 메일");
  });
  it("keeps mail written by people, and never flags Slack or calendar notes", () => {
    expect(
      autoNoticeReason(
        mail(
          "리포트 화면 요청",
          "국가별 필터를 추가해 주세요.",
          "@customer.example.invalid",
        ),
      ),
    ).toBeNull();
    expect(
      autoNoticeReason({
        channel: "slack",
        title: "[#pj] replied to 질문",
        body: "",
        fromDomain: null,
      }),
    ).toBeNull();
  });
});

describe("notification boilerplate is not a requirement", () => {
  it("drops access-request and footer sentences but keeps real requests", () => {
    const body = [
      "[이메일]님이 다음 문서에 대한 액세스를 요청합니다.",
      "문서의 소유자로서 해당 사용자에게 액세스 권한을 제공하려면 위의 링크를 클릭하고 공동작업자 또는 뷰어로 추가하세요.",
      "Google에서 보내는 알림 설정(https://docs.google.com/document/u/0/docos/notify)",
      "https://docs.google.com/document/d/synthetic-id/edit?usp=sharing_request",
      "앱 알림 설정 화면에 국가별 필터를 추가해 주세요.",
    ].join("\n\n");
    const c = extractCandidates(body);
    expect(c.map((x) => x.title)).toEqual([
      "앱 알림 설정 화면에 국가별 필터를 추가해 주세요.",
    ]);
    expect(
      isBoilerplate("문서 링크 https://example.invalid/a/b/c/d/e/f/g"),
    ).toBe(true);
  });
});
