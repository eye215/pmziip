import { z } from "zod";
import {
  authorize,
  applyCommand,
  recordAudit,
  stateSchema,
  monthSchema,
  type RecordsState,
  type Runtime,
  type Session,
} from "./model";

const legacyRow = z
  .object({
    id: z.union([z.string().min(1), z.number().finite()]),
    project: z
      .string()
      .max(120)
      .refine((x) => x.trim().length > 0),
    title: z.string().max(200).optional(),
    raw: z.string().max(100000).optional(),
    month: z.string().optional(),
  })
  .passthrough();
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => JSON.stringify(k) + ":" + stable(v))
      .join(",")}}`;
  return JSON.stringify(value);
}
function rows(text: string) {
  if (
    text.length > 5_000_000 ||
    new TextEncoder().encode(text).byteLength > 5_000_000
  )
    throw new Error("가져오기 파일은 5MB 이하여야 합니다.");
  const parsed = z.array(legacyRow).max(1000).parse(JSON.parse(text));
  return parsed.map((row) => {
    // Validate the original object, including unknown future fields, as inert JSON before keeping it verbatim.
    const original = z.record(z.string(), z.json()).parse(row);
    if (row.month) monthSchema.parse(row.month);
    return {
      row,
      original,
      canonical: stable(original),
      originKey: JSON.stringify([row.project, typeof row.id, row.id]),
    };
  });
}
export function previewLegacy(s: RecordsState, text: string, session: Session) {
  authorize(s, session);
  const parsed = rows(text),
    seen = new Map<string, string>();
  let skippedRows = 0;
  const pending: ReturnType<typeof rows> = [];
  for (const item of parsed) {
    const previous =
      seen.get(item.originKey) ||
      s.legacy.find((x) => x.originKey === item.originKey)?.canonical;
    if (previous) {
      if (previous !== item.canonical)
        throw new Error(
          "같은 이전 ID의 내용이 다릅니다. 기존 기록은 덮어쓰지 않습니다.",
        );
      skippedRows++;
    } else pending.push(item);
    seen.set(item.originKey, item.canonical);
  }
  return {
    newRows: pending.length,
    skippedRows,
    projects: [...new Set(pending.map((x) => x.row.project))],
    rows: pending,
  };
}
export function importLegacy(
  input: RecordsState,
  text: string,
  mapping: Record<string, string>,
  r: Runtime,
): RecordsState {
  const preview = previewLegacy(input, text, r.session);
  if (!preview.newRows) return input;
  for (const name of preview.projects) {
    if (!Object.hasOwn(mapping, name))
      throw new Error("프로젝트 연결을 먼저 선택해 주세요.");
    if (
      mapping[name] !== "new" &&
      !input.workspace.projects.some(
        (p) => p.id === mapping[name] && !p.archivedAt,
      )
    )
      throw new Error("가져올 프로젝트를 찾을 수 없습니다.");
  }
  let s = structuredClone(input);
  const resolved = new Map<string, string>();
  for (const name of preview.projects) {
    if (mapping[name] === "new") {
      s = applyCommand(
        s,
        {
          type: "project.save",
          data: {
            name,
            description: "이전 버전에서 가져온 합성 프로젝트",
            kind: "independent",
            timezone: "Asia/Seoul",
            clientId: null,
          },
        },
        r,
      );
      resolved.set(name, s.workspace.projects.at(-1)!.id);
    } else resolved.set(name, mapping[name]);
  }
  for (const item of preview.rows) {
    let sourceId: string | undefined;
    if (item.row.raw?.trim()) {
      s = applyCommand(
        s,
        {
          type: "source.save",
          data: {
            title: item.row.title?.trim() ? item.row.title : "가져온 원문",
            rawText: item.row.raw,
            sourceType: "other",
            reference: "",
            collectedAt: r.now(),
            requesterRole: "",
            sensitivity: "internal",
          },
        },
        r,
      );
      sourceId = s.sources.at(-1)!.id;
    }
    const get = (key: string) =>
      typeof item.original[key] === "string"
        ? (item.original[key] as string)
        : "";
    s = applyCommand(
      s,
      {
        type: "initiative.save",
        data: {
          projectId: resolved.get(item.row.project)!,
          title: item.row.title?.trim() ? item.row.title : "가져온 과제",
          problem: get("problem"),
          targetSegment: "",
          expectedChange: get("change"),
          category: "other",
          priority: "medium",
          assignee: "",
          contribution: get("contribution"),
          decisionReason: "이전 버전 가져오기 승인",
          alternative: "",
          plannedAt: null,
          targetMonth: item.row.month || null,
          status: "draft",
        },
        sourceIds: sourceId ? [sourceId] : [],
      },
      r,
    );
    const initiativeId = s.initiatives.at(-1)!.id;
    s.legacy.push({
      originKey: item.originKey,
      canonical: item.canonical,
      initiativeId,
      original: item.original,
    });
  }
  recordAudit(
    s,
    r,
    "legacy.import",
    s.workspace.id,
    null,
    `${preview.newRows}개 가져오기 승인`,
  );
  // All intermediate work was in a clone; callers persist this single final transaction exactly once.
  s.revision = input.revision + 1;
  return stateSchema.parse(s);
}
