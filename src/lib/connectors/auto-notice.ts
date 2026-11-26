/**
 * Deterministic "automated notification" check for collected mail (Google
 * Docs share/access/comment mails, Figma/Jira/Notion/GitHub notices,
 * calendar invitations, no-reply mail). Such items are kept as originals
 * but are not proposed as requirements and are hidden by default.
 * Returns a short Korean reason, or null for mail written by a person.
 */
export type NoticeInput = {
  channel: "gmail" | "calendar" | "slack";
  title: string;
  body: string;
  fromDomain: string | null;
};

const TITLE: [RegExp, string][] = [
  [
    /에 대한 공유 요청|님이 .{0,80}공유(했습니다|함)|공유됨[:：]|shared .{0,120}with you|액세스 요청|access request|request(ed)? (to )?access/i,
    "문서 공유·액세스 알림",
  ],
  [
    /replied to|commented on|mentioned you|님이 (댓글|회신|답글)|댓글을 남겼|새 댓글|님이 .{0,30}언급/i,
    "댓글·멘션 알림",
  ],
  [
    /^(초대|업데이트된 초대|수락함|수락됨|거절함|거절됨|취소된 (이벤트|일정)|invitation|updated invitation|accepted|declined|canceled event|cancelled event)\s*[:：]/i,
    "캘린더 초대 알림",
  ],
  [/^\[(jira|confluence)\]/i, "Jira·Confluence 알림"],
];

const DOMAIN: [RegExp, string][] = [
  [/(^|\.)figma\.com$/i, "Figma 알림"],
  [/(^|\.)atlassian\.(net|com)$/i, "Jira·Confluence 알림"],
  [/(^|\.)github\.com$/i, "GitHub 알림"],
  [/(^|\.)notion\.so$/i, "Notion 알림"],
  [/(^|\.)slack\.com$/i, "Slack 알림 메일"],
  [/(^|\.)(zoom\.us|linkedin\.com|facebookmail\.com)$/i, "서비스 알림"],
  // Docs/Drive/Calendar notices all come from google.com addresses.
  [/(^|\.)google\.com$/i, "Google 알림"],
];

const BODY =
  /unsubscribe|수신\s?거부|발신 전용|do ?not ?reply|회신하지 마(세요|십시오)|you (are )?receiv(ed|ing) this (email|message|notification)|이 (이메일|메일)은 .{0,40}자동/i;

export function autoNoticeReason(it: NoticeInput): string | null {
  if (it.channel !== "gmail") return null;
  for (const [re, why] of TITLE) if (re.test(it.title)) return why;
  const domain = (it.fromDomain ?? "").replace(/^@/, "");
  for (const [re, why] of DOMAIN) if (re.test(domain)) return why;
  if (BODY.test(it.body)) return "자동 발송 메일";
  return null;
}
