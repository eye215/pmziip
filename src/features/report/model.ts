import { z } from "zod";
import { projectMonth } from "../../lib/time";
import type { Initiative, RecordsState } from "../records/model";
import { caseStudy } from "../records/case-study";

/**
 * Period impact report ("my performance"). Built deterministically from
 * records; a finalized report is an immutable snapshot (append-only store).
 * Re-finalizing the same period makes a new version, never an edit.
 */
export const REPORT_DEFINITION = "impact-report-1";
const id = z.uuid();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const count = z.number().int().nonnegative();

const summarySchema = z
  .object({
    collected: count,
    created: count,
    go: count,
    no: count,
    pending: count,
    archived: count,
    released: count,
    releasedWithPlan: count,
    comparable: count,
    improvedObserved: count,
  })
  .strict();
const lineSchema = z
  .object({
    key: z.string().max(40),
    label: z.string().max(40),
    text: z.string().max(20000),
    missing: z.boolean(),
  })
  .strict();
const caseSchema = z
  .object({
    initiativeId: id,
    title: z.string().max(200),
    project: z.string().max(120),
    kind: z.enum(["released", "declined"]),
    lines: z.array(lineSchema).max(8),
  })
  .strict();
export const reportContentSchema = z
  .object({
    definition: z.literal(REPORT_DEFINITION),
    fromMonth: month,
    toMonth: month,
    timeZone: z.string().max(80),
    summary: summarySchema,
    cases: z.array(caseSchema).max(500),
  })
  .strict();
export const reportSchema = reportContentSchema
  .extend({
    id,
    version: z.number().int().positive(),
    supersedesId: id.nullable(),
    finalizedAt: z.iso.datetime({ offset: true }),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export const reportStoreSchema = z
  .object({
    schemaVersion: z.literal(1),
    ownerId: id,
    workspaceId: id,
    revision: z.number().int().nonnegative(),
    reports: z.array(reportSchema),
  })
  .strict();
export type ReportContent = z.infer<typeof reportContentSchema>;
export type Report = z.infer<typeof reportSchema>;
export type ReportStore = z.infer<typeof reportStoreSchema>;

/** Observed GA result for a released initiative (from release-compare). */
export type Observed = { line: string; improved: boolean | null };

const goStatuses = ["approved", "planned", "in_progress", "released"];

export function buildReport(
  state: RecordsState,
  fromMonth: string,
  toMonth: string,
  timeZone: string,
  observe: (work: Initiative) => Observed,
): ReportContent {
  if (fromMonth > toMonth) throw new Error("시작 월이 끝 월보다 늦습니다.");
  const inRange = (instant: string | null) => {
    if (!instant) return false;
    const m = projectMonth(instant, timeZone);
    return m >= fromMonth && m <= toMonth;
  };
  const works = state.initiatives.filter((w) => !w.mergedInto);
  const created = works.filter((w) => inRange(w.createdAt));
  const released = works.filter((w) => inRange(w.releasedAt));
  const plans = (w: Initiative) =>
    state.measurement.plans.some(
      (p) => p.initiativeId === w.id && p.status === "approved",
    );
  const observed = new Map(released.map((w) => [w.id, observe(w)]));
  const declined = created.filter((w) => w.status === "canceled");
  const projectName = (w: Initiative) =>
    state.workspace.projects.find((p) => p.id === w.projectId)?.name ?? "";
  const cases = [
    ...[...released]
      .sort((a, b) => (a.releasedAt ?? "").localeCompare(b.releasedAt ?? ""))
      .map((w) => ({
        initiativeId: w.id,
        title: w.title,
        project: projectName(w),
        kind: "released" as const,
        lines: caseStudy(w, state, observed.get(w.id)?.line ?? ""),
      })),
    ...[...declined]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((w) => ({
        initiativeId: w.id,
        title: w.title,
        project: projectName(w),
        kind: "declined" as const,
        lines: caseStudy(w, state),
      })),
  ];
  return reportContentSchema.parse({
    definition: REPORT_DEFINITION,
    fromMonth,
    toMonth,
    timeZone,
    summary: {
      collected: state.sources.filter((s) => inRange(s.collectedAt)).length,
      created: created.length,
      go: created.filter((w) => goStatuses.includes(w.status)).length,
      no: declined.length,
      pending: created.filter((w) => w.status === "draft").length,
      archived: created.filter((w) => w.status === "archived").length,
      released: released.length,
      releasedWithPlan: released.filter(plans).length,
      comparable: [...observed.values()].filter((o) => o.improved !== null)
        .length,
      improvedObserved: [...observed.values()].filter((o) => o.improved).length,
    },
    cases,
  });
}

export const summaryLabels: [keyof ReportContent["summary"], string][] = [
  ["collected", "수집한 요구사항 원문"],
  ["created", "만든 과제"],
  ["go", "하기로 결정"],
  ["no", "안 하기로 결정"],
  ["pending", "검토 중"],
  ["released", "배포"],
  ["releasedWithPlan", "배포 중 측정 계획 승인"],
  ["comparable", "배포 전후 비교 가능"],
  ["improvedObserved", "비교 가능 중 횟수 완료율 상승(관찰)"],
];

export function reportText(r: ReportContent & { version?: number }) {
  const out = [
    `# 성과 보고서 ${r.fromMonth} ~ ${r.toMonth}${r.version ? ` (v${r.version})` : ""}`,
    "",
    `기준 시간대 ${r.timeZone} · 정의 ${r.definition}`,
    "",
    ...summaryLabels.map(([k, label]) => `- ${label}: ${r.summary[k]}`),
    "",
  ];
  for (const c of r.cases) {
    out.push(
      `## ${c.title} (${c.kind === "released" ? "배포" : "안 하기로 결정"} · ${c.project})`,
      "",
    );
    c.lines.forEach((l, i) =>
      out.push(`${i + 1}. ${l.label}: ${l.missing ? "(미작성)" : l.text}`),
    );
    out.push("");
  }
  out.push(
    "관찰값입니다. 지표 변화는 같은 기간의 다른 요인도 영향을 줄 수 있습니다.",
  );
  return out.join("\n");
}

// --- append-only store (this browser) ---
export type ReportSession = { ownerId: string; workspaceId: string };
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
export const reportKey = (s: ReportSession) =>
  `pmzip:impact-report:v1:${s.ownerId}:${s.workspaceId}`;
export type LoadedReports = { state: ReportStore; token: string | null };

export function loadReports(
  storage: Storage,
  session: ReportSession,
): LoadedReports {
  const token = storage.getItem(reportKey(session));
  if (token === null)
    return {
      state: {
        schemaVersion: 1,
        ownerId: session.ownerId,
        workspaceId: session.workspaceId,
        revision: 0,
        reports: [],
      },
      token: null,
    };
  const state = reportStoreSchema.parse(JSON.parse(token));
  if (
    state.ownerId !== session.ownerId ||
    state.workspaceId !== session.workspaceId
  )
    throw new Error("다른 워크스페이스의 보고서 기록입니다.");
  return { state, token };
}

/** Adds a finalized snapshot; earlier reports are never changed. */
export function finalizeReport(
  storage: Storage,
  loaded: LoadedReports,
  content: ReportContent,
  contentHash: string,
  session: ReportSession,
  runtime: { id: () => string; now: () => string },
): LoadedReports {
  if (storage.getItem(reportKey(session)) !== loaded.token)
    throw new Error(
      "다른 탭에서 보고서 기록이 바뀌었습니다. 새로고침 후 다시 확정해 주세요.",
    );
  const same = loaded.state.reports
    .filter(
      (r) => r.fromMonth === content.fromMonth && r.toMonth === content.toMonth,
    )
    .sort((a, b) => b.version - a.version);
  if (same[0]?.contentHash === contentHash)
    throw new Error("같은 내용으로 이미 확정한 보고서가 있습니다.");
  const report = reportSchema.parse({
    ...content,
    id: runtime.id(),
    version: (same[0]?.version ?? 0) + 1,
    supersedesId: same[0]?.id ?? null,
    finalizedAt: runtime.now(),
    contentHash,
  });
  const next = reportStoreSchema.parse({
    ...loaded.state,
    revision: loaded.state.revision + 1,
    reports: [...loaded.state.reports, report],
  });
  const token = JSON.stringify(next);
  if (new TextEncoder().encode(token).byteLength > 4_000_000)
    throw new Error("로컬 저장 한도를 넘었습니다. 먼저 백업해 주세요.");
  storage.setItem(reportKey(session), token);
  return { state: next, token };
}
