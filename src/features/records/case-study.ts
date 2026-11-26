import type { Initiative, RecordsState } from "./model";

/**
 * One initiative as a portfolio case study: eight lines built only from what
 * is recorded (no guesses). Empty parts are marked missing so the user sees
 * what to fill, never invented text. Deterministic for the same records.
 */
export type CaseLine = {
  key:
    | "problem"
    | "decision"
    | "role"
    | "change"
    | "hypothesis"
    | "result"
    | "business"
    | "retro";
  label: string;
  text: string;
  missing: boolean;
};

const statusText: Record<string, string> = {
  draft: "검토 중",
  approved: "하기로 결정",
  planned: "일정 확정",
  in_progress: "진행 중",
  released: "배포됨",
  archived: "보관",
  canceled: "안 하기로 결정",
};
const channelText: Record<string, string> = {
  manual: "직접",
  mail: "메일",
  slack: "Slack",
  teams: "Teams",
  other: "기타",
};

const join = (parts: (string | false | null | undefined)[]) =>
  parts
    .map((p) => (p || "").trim())
    .filter(Boolean)
    .join(" · ");

/** YYYY-MM-DD of an instant in the given IANA time zone. */
export function dayIn(instant: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

export function caseStudy(work: Initiative, state: RecordsState): CaseLine[] {
  const project = state.workspace.projects.find((p) => p.id === work.projectId);
  const zone = project?.timezone || "UTC";
  const sources = state.links
    .filter((l) => l.initiativeId === work.id)
    .map((l) => state.sources.find((s) => s.id === l.sourceId))
    .filter((s) => !!s);
  const byChannel = new Map<string, number>();
  for (const s of sources)
    byChannel.set(s.sourceType, (byChannel.get(s.sourceType) ?? 0) + 1);
  const evidence = sources.length
    ? `근거 원문 ${sources.length}건(${[...byChannel]
        .map(([k, n]) => `${channelText[k] ?? k} ${n}`)
        .join(", ")})`
    : "";
  const frictions = work.frictions;
  const happened = frictions.filter((f) => f.outcome === "happened").length;
  const notHappened = frictions.filter(
    (f) => f.outcome === "not_happened",
  ).length;
  const plans = state.measurement.plans.filter(
    (p) => p.initiativeId === work.id && p.status === "approved",
  ).length;
  const links = join([
    work.specUrl && `기획서 ${work.specUrl}`,
    work.siteUrl && `사이트 ${work.siteUrl}`,
    work.beforeRef && `변경 전 ${work.beforeRef}`,
    work.afterRef && `변경 후 ${work.afterRef}`,
  ]);
  const decided = work.status !== "draft";

  const lines: Omit<CaseLine, "missing">[] = [
    { key: "problem", label: "문제", text: join([work.problem, evidence]) },
    {
      key: "decision",
      label: "결정",
      text: decided
        ? join([
            statusText[work.status] ?? work.status,
            work.decisionReason && `사유: ${work.decisionReason}`,
            work.alternative && `검토한 대안: ${work.alternative}`,
            work.targetMonth && `목표 ${work.targetMonth}`,
          ])
        : "",
    },
    {
      key: "role",
      label: "내 역할",
      text: join([work.contribution, work.assignee && `담당 ${work.assignee}`]),
    },
    {
      key: "change",
      label: "변경",
      text: join([work.changeSummary, links]),
    },
    {
      key: "hypothesis",
      label: "가설",
      text: join([
        work.expectedChange && `기대 변화: ${work.expectedChange}`,
        work.expectedUsage && `예상 사용: ${work.expectedUsage}`,
        frictions.length > 0 &&
          `예상 막힘 ${frictions.length}곳: ${frictions.map((f) => f.point).join(", ")}`,
      ]),
    },
    {
      key: "result",
      label: "결과",
      text: work.releasedAt
        ? join([
            `배포 ${dayIn(work.releasedAt, zone)}`,
            frictions.length > 0 &&
              `예상 막힘 ${frictions.length}곳 중 실제 발생 ${happened}, 발생 안 함 ${notHappened}, 미확인 ${frictions.length - happened - notHappened}`,
            plans ? `승인된 측정 계획 ${plans}개` : "측정 계획 없음",
          ])
        : "",
    },
    {
      key: "business",
      label: "비즈니스",
      // No product sales source is connected yet; never inferred.
      text: "",
    },
    {
      key: "retro",
      label: "회고",
      text: join([
        work.retro && `아쉬운 점: ${work.retro}`,
        work.nextTime && `다음에는: ${work.nextTime}`,
      ]),
    },
  ];
  return lines.map((l) => ({ ...l, missing: !l.text }));
}

const missingText: Record<CaseLine["key"], string> = {
  problem: "문제와 근거 원문을 연결해 주세요.",
  decision: "업무 상태와 결정 근거를 적어 주세요.",
  role: "개인 기여를 적어 주세요.",
  change: "바뀐 점과 기획서·사이트 링크를 적어 주세요.",
  hypothesis: "기대 변화, 예상 사용, 예상 막힘 지점을 적어 주세요.",
  result: "배포 일시를 적으면 결과를 정리합니다.",
  business: "판매 데이터가 아직 연결되지 않았습니다.",
  retro: "아쉬운 점과 다음에 다르게 할 것을 적어 주세요.",
};
export const missingHint = (key: CaseLine["key"]) => missingText[key];

/** Plain-text copy for drafting a portfolio (internal: not anonymized). */
export function caseStudyText(work: Initiative, lines: CaseLine[]) {
  return [
    `# ${work.title}`,
    "",
    ...lines.map(
      (l, i) => `${i + 1}. ${l.label}: ${l.missing ? "(미작성)" : l.text}`,
    ),
  ].join("\n");
}
