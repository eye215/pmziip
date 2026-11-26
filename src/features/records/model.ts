import { z } from "zod";
import {
  measurementStateSchema,
  emptyMeasurement,
  validateMeasurementRelations,
} from "../measurement/schema";
import { demoWorkspace } from "../../lib/demo";
import { workspaceSchema, projectSchema } from "../../lib/schema";
import { projectMonth } from "../../lib/time";

export const idSchema = z.uuid();
const instant = z.iso.datetime({ offset: true });
const text = z.string().max(10000);
const nonempty = (max: number) =>
  z
    .string()
    .max(max)
    .refine((s) => s.trim().length > 0, "내용을 입력해 주세요.");
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const reference = z
  .string()
  .max(2000)
  .refine((s) => {
    if (!s) return true;
    try {
      const u = new URL(s);
      return (
        ["http:", "https:"].includes(u.protocol) && !u.username && !u.password
      );
    } catch {
      return false;
    }
  }, "http 또는 https 링크를 입력해 주세요.");

export const sourceInput = z
  .object({
    title: nonempty(200),
    rawText: nonempty(100000),
    sourceType: z.enum(["manual", "mail", "slack", "teams", "other"]),
    reference,
    collectedAt: instant,
    requesterRole: text,
    sensitivity: z.enum(["public", "internal", "confidential"]),
  })
  .strict();
export const projectInput = projectSchema
  .pick({
    name: true,
    description: true,
    kind: true,
    timezone: true,
    clientId: true,
  })
  .extend({ name: nonempty(120), description: text })
  .strict();
export const clientInput = z
  .object({ name: nonempty(120), description: text })
  .strict();
export const workStatuses = [
  "draft",
  "approved",
  "planned",
  "in_progress",
  "released",
  "archived",
  "canceled",
] as const;
/** A place users are expected to get stuck, checked after release. */
export const frictionOutcomes = [
  "unknown",
  "happened",
  "not_happened",
] as const;
export type FrictionOutcome = (typeof frictionOutcomes)[number];
const frictionSchema = z
  .object({
    point: nonempty(500),
    outcome: z.enum(frictionOutcomes),
    note: z.string().max(2000),
  })
  .strict();
export const initiativeInput = z
  .object({
    projectId: idSchema,
    title: nonempty(200),
    problem: text,
    targetSegment: text,
    expectedChange: text,
    category: z.enum(["fix", "improvement", "new", "other"]),
    priority: z.enum(["low", "medium", "high"]),
    assignee: text,
    contribution: text,
    decisionReason: text,
    alternative: text,
    plannedAt: instant.nullable(),
    targetMonth: monthSchema.nullable(),
    status: z.enum(workStatuses),
    // Case study (portfolio) — added later, so every field has a default and
    // records saved before keep loading unchanged.
    specUrl: reference.default(""),
    siteUrl: reference.default(""),
    beforeRef: reference.default(""),
    afterRef: reference.default(""),
    changeSummary: text.default(""),
    releasedAt: instant.nullable().default(null),
    expectedUsage: text.default(""),
    frictions: z.array(frictionSchema).max(20).default([]),
    retro: text.default(""),
    nextTime: text.default(""),
  })
  .strict();
const sourceSchema = sourceInput.extend({
  id: idSchema,
  workspaceId: idSchema,
  status: z.enum(["inbox", "reviewed", "linked", "archived"]),
  createdAt: instant,
  updatedAt: instant,
  revisions: z.array(sourceInput.extend({ editedAt: instant })),
});
const initiativeSchema = initiativeInput.extend({
  id: idSchema,
  measurementStatus: z.literal("not_ready"),
  mergedInto: idSchema.nullable(),
  createdAt: instant,
  updatedAt: instant,
});
export const stateSchemaV1 = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    ownerId: idSchema,
    workspace: workspaceSchema,
    sources: z.array(sourceSchema),
    initiatives: z.array(initiativeSchema),
    links: z.array(
      z.object({ sourceId: idSchema, initiativeId: idSchema }).strict(),
    ),
    audit: z.array(
      z
        .object({
          id: idSchema,
          at: instant,
          actorId: idSchema,
          action: z.string(),
          entityId: idSchema,
          before: z.json().nullable(),
          detail: z.string(),
        })
        .strict(),
    ),
    legacy: z.array(
      z
        .object({
          originKey: z.string(),
          canonical: z.string(),
          initiativeId: idSchema,
          original: z.record(z.string(), z.json()),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((s, ctx) => {
    const ids = [
      s.workspace.id,
      ...s.workspace.clients.map((x) => x.id),
      ...s.workspace.projects.map((x) => x.id),
      ...s.sources.map((x) => x.id),
      ...s.initiatives.map((x) => x.id),
      ...s.audit.map((x) => x.id),
    ];
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (new Set(ids).size !== ids.length) fail("기록 ID가 중복됩니다.");
    for (const source of s.sources)
      if (source.workspaceId !== s.workspace.id)
        fail("원문의 소속이 일치하지 않습니다.");
    for (const work of s.initiatives) {
      if (!s.workspace.projects.some((p) => p.id === work.projectId))
        fail("과제의 프로젝트가 없습니다.");
      if (work.mergedInto) {
        const target = s.initiatives.find((x) => x.id === work.mergedInto);
        if (
          !target ||
          target.id === work.id ||
          target.projectId !== work.projectId ||
          target.mergedInto
        )
          fail("잘못된 병합 관계입니다.");
      }
    }
    const keys = s.links.map((x) =>
      JSON.stringify([x.sourceId, x.initiativeId]),
    );
    if (new Set(keys).size !== keys.length) fail("중복 원문 연결입니다.");
    for (const l of s.links)
      if (
        !s.sources.some((x) => x.id === l.sourceId) ||
        !s.initiatives.some((x) => x.id === l.initiativeId)
      )
        fail("원문 연결 대상이 없습니다.");
    for (const source of s.sources)
      if (
        source.status !== "archived" &&
        (source.status === "linked") !==
          s.links.some((l) => l.sourceId === source.id)
      )
        fail("원문 연결 상태가 일치하지 않습니다.");
    if (new Set(s.legacy.map((x) => x.originKey)).size !== s.legacy.length)
      fail("중복 레거시 ID입니다.");
    for (const row of s.legacy)
      if (!s.initiatives.some((x) => x.id === row.initiativeId))
        fail("레거시 매핑 대상이 없습니다.");
  });
export const stateSchema = z
  .object({
    ...stateSchemaV1.shape,
    schemaVersion: z.literal(2),
    measurement: measurementStateSchema,
  })
  .strict()
  .superRefine((s, ctx) => {
    const { measurement, ...base } = s;
    const old = stateSchemaV1.safeParse({ ...base, schemaVersion: 1 });
    if (!old.success)
      for (const issue of old.error.issues)
        ctx.addIssue({
          code: "custom",
          path: issue.path,
          message: issue.message,
        });
    const allIds = [
      s.workspace.id,
      ...s.workspace.clients.map((x) => x.id),
      ...s.workspace.projects.map((x) => x.id),
      ...s.sources.map((x) => x.id),
      ...s.initiatives.map((x) => x.id),
      ...s.audit.map((x) => x.id),
      ...measurement.metrics.map((x) => x.id),
      ...measurement.metricVersions.map((x) => x.id),
      ...measurement.plans.map((x) => x.id),
      ...measurement.strategies.map((x) => x.id),
    ];
    if (new Set(allIds).size !== allIds.length)
      ctx.addIssue({ code: "custom", message: "기록 ID가 중복됩니다." });
    validateMeasurementRelations(s, ctx);
  });
export function decodeState(value: unknown) {
  if (
    typeof value === "object" &&
    value !== null &&
    "schemaVersion" in value &&
    value.schemaVersion === 1
  ) {
    return stateSchema.parse({
      ...stateSchemaV1.parse(value),
      schemaVersion: 2,
      measurement: emptyMeasurement(),
    });
  }
  return stateSchema.parse(value);
}
export type RecordsState = z.infer<typeof stateSchema>;
export type Source = RecordsState["sources"][number];
export type Initiative = RecordsState["initiatives"][number];
export type Session = {
  mode: "synthetic";
  ownerId: string;
  workspaceId: string;
};
export type Runtime = { session: Session; now: () => string; id: () => string };

export function authorize(s: RecordsState, session: Session) {
  if (
    session.mode !== "synthetic" ||
    s.ownerId !== session.ownerId ||
    s.workspace.id !== session.workspaceId
  )
    throw new Error("이 합성 워크스페이스에 접근할 수 없습니다.");
}
export function createState(session: Session): RecordsState {
  if (session.mode !== "synthetic" || session.workspaceId !== demoWorkspace.id)
    throw new Error("지원되지 않는 합성 워크스페이스입니다.");
  return stateSchema.parse({
    schemaVersion: 2,
    measurement: emptyMeasurement(),
    revision: 0,
    ownerId: idSchema.parse(session.ownerId),
    workspace: structuredClone(demoWorkspace),
    sources: [],
    initiatives: [],
    links: [],
    audit: [],
    legacy: [],
  });
}
const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("client.save"),
    id: idSchema.optional(),
    data: clientInput,
  }),
  z.object({
    type: z.literal("client.archive"),
    id: idSchema,
    archived: z.boolean(),
  }),
  z.object({
    type: z.literal("project.save"),
    id: idSchema.optional(),
    data: projectInput,
  }),
  z.object({
    type: z.literal("project.archive"),
    id: idSchema,
    archived: z.boolean(),
  }),
  z.object({
    type: z.literal("source.save"),
    id: idSchema.optional(),
    data: sourceInput,
  }),
  z.object({
    type: z.literal("source.status"),
    id: idSchema,
    status: z.enum(["inbox", "reviewed", "archived"]),
  }),
  z.object({
    type: z.literal("source.link"),
    id: idSchema,
    initiativeIds: z.array(idSchema).min(1),
  }),
  z.object({
    type: z.literal("initiative.save"),
    id: idSchema.optional(),
    data: initiativeInput,
    sourceIds: z.array(idSchema),
  }),
  z.object({
    type: z.literal("initiative.merge"),
    fromId: idSchema,
    intoId: idSchema,
    reason: nonempty(2000),
  }),
]);
export type Command = z.input<typeof commandSchema>;
function need<T>(item: T | undefined): T {
  if (!item) throw new Error("기록을 찾을 수 없습니다.");
  return item;
}
export function refreshSourceStatuses(s: RecordsState) {
  for (const source of s.sources)
    if (source.status !== "archived")
      source.status = s.links.some((l) => l.sourceId === source.id)
        ? "linked"
        : source.status === "linked"
          ? "reviewed"
          : source.status;
}
export function recordAudit(
  s: RecordsState,
  r: Runtime,
  action: string,
  entityId: string,
  before: unknown,
  detail = "",
) {
  s.audit.push({
    id: r.id(),
    at: r.now(),
    actorId: r.session.ownerId,
    action,
    entityId,
    before:
      before === null
        ? null
        : z.json().parse(JSON.parse(JSON.stringify(before))),
    detail,
  });
}
export function applyCommand(
  input: RecordsState,
  raw: Command,
  r: Runtime,
): RecordsState {
  authorize(input, r.session);
  const c = commandSchema.parse(raw);
  const s = structuredClone(stateSchema.parse(input));
  const now = instant.parse(r.now());
  let entityId = "",
    before: unknown = null;
  if (c.type === "initiative.merge") {
    const from = need(s.initiatives.find((x) => x.id === c.fromId)),
      into = need(s.initiatives.find((x) => x.id === c.intoId));
    if (from.mergedInto === into.id) return input;
    if (
      from.id === into.id ||
      from.projectId !== into.projectId ||
      from.mergedInto ||
      into.mergedInto ||
      into.status === "archived"
    )
      throw new Error("같은 프로젝트의 활성 과제끼리만 병합할 수 있습니다.");
    before = structuredClone(from);
    entityId = from.id;
    from.status = "archived";
    from.mergedInto = into.id;
    from.updatedAt = now;
    for (const link of [...s.links])
      if (
        link.initiativeId === from.id &&
        !s.links.some(
          (x) => x.sourceId === link.sourceId && x.initiativeId === into.id,
        )
      )
        s.links.push({ sourceId: link.sourceId, initiativeId: into.id });
    recordAudit(s, r, c.type, entityId, before, c.reason);
  } else {
    if (c.type === "client.save") {
      const old = c.id
        ? need(s.workspace.clients.find((x) => x.id === c.id))
        : null;
      before = old ? structuredClone(old) : null;
      entityId = old?.id || r.id();
      if (old) Object.assign(old, c.data);
      else
        s.workspace.clients.push({
          id: entityId,
          workspaceId: s.workspace.id,
          ...c.data,
          archivedAt: null,
        });
    } else if (c.type === "client.archive") {
      const old = need(s.workspace.clients.find((x) => x.id === c.id));
      before = structuredClone(old);
      entityId = old.id;
      old.archivedAt = c.archived ? now : null;
    } else if (c.type === "project.save") {
      if (c.data.clientId) {
        const client = need(
          s.workspace.clients.find((x) => x.id === c.data.clientId),
        );
        if (client.archivedAt)
          throw new Error("보관한 고객사를 복원한 후 선택해 주세요.");
      }
      const old = c.id
        ? need(s.workspace.projects.find((x) => x.id === c.id))
        : null;
      before = old ? structuredClone(old) : null;
      entityId = old?.id || r.id();
      if (old) Object.assign(old, c.data);
      else
        s.workspace.projects.push({
          id: entityId,
          workspaceId: s.workspace.id,
          ...c.data,
          archivedAt: null,
        });
    } else if (c.type === "project.archive") {
      const old = need(s.workspace.projects.find((x) => x.id === c.id));
      before = structuredClone(old);
      entityId = old.id;
      old.archivedAt = c.archived ? now : null;
    } else if (c.type === "source.save") {
      const old = c.id ? need(s.sources.find((x) => x.id === c.id)) : null;
      before = old ? structuredClone(old) : null;
      entityId = old?.id || r.id();
      if (old) {
        const previous = sourceInput.parse({
          title: old.title,
          rawText: old.rawText,
          sourceType: old.sourceType,
          reference: old.reference,
          collectedAt: old.collectedAt,
          requesterRole: old.requesterRole,
          sensitivity: old.sensitivity,
        });
        old.revisions.push({ ...previous, editedAt: now });
        Object.assign(old, c.data, { updatedAt: now });
      } else
        s.sources.push({
          ...c.data,
          id: entityId,
          workspaceId: s.workspace.id,
          status: "inbox",
          revisions: [],
          createdAt: now,
          updatedAt: now,
        });
    } else if (c.type === "source.status") {
      const old = need(s.sources.find((x) => x.id === c.id));
      before = structuredClone(old);
      entityId = old.id;
      old.status = c.status;
      old.updatedAt = now;
    } else if (c.type === "source.link") {
      const source = need(s.sources.find((x) => x.id === c.id));
      if (source.status === "archived")
        throw new Error("원문을 복원한 후 연결해 주세요.");
      entityId = source.id;
      before = s.links.filter((x) => x.sourceId === source.id);
      for (const id of new Set(c.initiativeIds)) {
        const work = need(s.initiatives.find((x) => x.id === id));
        if (work.status === "archived")
          throw new Error("보관된 과제에는 연결할 수 없습니다.");
        if (
          !s.links.some(
            (x) => x.sourceId === source.id && x.initiativeId === id,
          )
        )
          s.links.push({ sourceId: source.id, initiativeId: id });
      }
    } else if (c.type === "initiative.save") {
      const project = need(
        s.workspace.projects.find((x) => x.id === c.data.projectId),
      );
      if (project.archivedAt)
        throw new Error("프로젝트를 복원한 후 저장해 주세요.");
      const old = c.id ? need(s.initiatives.find((x) => x.id === c.id)) : null;
      if (old && (old.projectId !== c.data.projectId || old.mergedInto))
        throw new Error("과제의 프로젝트 또는 병합 기록은 변경할 수 없습니다.");
      const ids = [...new Set(c.sourceIds)];
      for (const id of ids) need(s.sources.find((x) => x.id === id));
      before = old ? structuredClone(old) : null;
      entityId = old?.id || r.id();
      if (old) Object.assign(old, c.data, { updatedAt: now });
      else
        s.initiatives.push({
          ...c.data,
          id: entityId,
          measurementStatus: "not_ready",
          mergedInto: null,
          createdAt: now,
          updatedAt: now,
        });
      s.links = s.links.filter((x) => x.initiativeId !== entityId);
      s.links.push(
        ...ids.map((sourceId) => ({ sourceId, initiativeId: entityId })),
      );
    }
    recordAudit(s, r, c.type, entityId, before);
  }
  refreshSourceStatuses(s);
  s.revision++;
  return stateSchema.parse(s);
}

export type WorkQuery = {
  projectId?: string;
  clientId?: string;
  role?: "collected" | "planned" | "target";
  month?: string;
  fromMonth?: string;
  toMonth?: string;
  undated?: boolean;
  search?: string;
  status?: string;
  showArchived?: boolean;
};
export function queryInitiatives(s: RecordsState, q: WorkQuery): Initiative[] {
  for (const value of [q.month, q.fromMonth, q.toMonth])
    if (value) monthSchema.parse(value);
  if (q.fromMonth && q.toMonth && q.fromMonth > q.toMonth)
    throw new Error("시작 월은 종료 월보다 늦을 수 없습니다.");
  return s.initiatives.filter((work) => {
    const project = s.workspace.projects.find((p) => p.id === work.projectId)!;
    if (
      (q.projectId && project.id !== q.projectId) ||
      (q.clientId && project.clientId !== q.clientId) ||
      (!q.showArchived && work.status === "archived") ||
      (q.status && q.status !== work.status)
    )
      return false;
    if (
      q.search &&
      !`${work.title}\n${work.problem}\n${work.assignee}`
        .toLocaleLowerCase()
        .includes(q.search.toLocaleLowerCase())
    )
      return false;
    const role = q.role || "collected";
    const months =
      role === "target"
        ? work.targetMonth
          ? [work.targetMonth]
          : []
        : role === "planned"
          ? work.plannedAt
            ? [projectMonth(work.plannedAt, project.timezone)]
            : []
          : s.links
              .filter((l) => l.initiativeId === work.id)
              .map((l) =>
                projectMonth(
                  s.sources.find((x) => x.id === l.sourceId)!.collectedAt,
                  project.timezone,
                ),
              );
    if (q.undated) return months.length === 0;
    return (
      (!q.month && !q.fromMonth && !q.toMonth) ||
      months.some(
        (m) =>
          (!q.month || m === q.month) &&
          (!q.fromMonth || m >= q.fromMonth) &&
          (!q.toMonth || m <= q.toMonth),
      )
    );
  });
}
