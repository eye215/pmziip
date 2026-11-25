import { z } from "zod";
import {
  coachExportSchema,
  coachPeriodKey,
  coachPeriodSchema,
  type CoachExport,
} from "../../lib/connectors/coach-export";

/**
 * Imported Galaxy Coach GA snapshots. Kept under its own key so the records
 * state schema is untouched. Append-only: re-collected periods are added as
 * new snapshots, nothing is deleted or rewritten.
 */
const id = z.uuid();
const instant = z.iso.datetime({ offset: true });
export const coachSnapshotSchema = z
  .object({
    id,
    projectId: id,
    importedAt: instant,
    source: z.literal("apps-script-export"),
    generator: z.object({ name: z.string(), version: z.string() }).strict(),
    definitionVersion: z.string(),
    propertyTimeZone: z.string().nullable(),
    generatedAt: instant,
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    period: coachPeriodSchema,
  })
  .strict();
export const coachStoreSchema = z
  .object({
    schemaVersion: z.literal(1),
    ownerId: id,
    workspaceId: id,
    revision: z.number().int().nonnegative(),
    snapshots: z.array(coachSnapshotSchema),
  })
  .strict();
export type CoachSnapshot = z.infer<typeof coachSnapshotSchema>;
export type CoachStore = z.infer<typeof coachStoreSchema>;
export type CoachSession = { ownerId: string; workspaceId: string };
export type Storage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};
export type LoadedCoach = { state: CoachStore; token: string | null };

export const coachStorageKey = (s: CoachSession) =>
  `pmzip:coach-ga:v1:${s.ownerId}:${s.workspaceId}`;
export const MAX_COACH_FILE_BYTES = 2_000_000;

export function loadCoach(
  storage: Storage,
  session: CoachSession,
): LoadedCoach {
  const token = storage.getItem(coachStorageKey(session));
  if (token === null)
    return {
      state: {
        schemaVersion: 1,
        ownerId: session.ownerId,
        workspaceId: session.workspaceId,
        revision: 0,
        snapshots: [],
      },
      token: null,
    };
  const state = coachStoreSchema.parse(JSON.parse(token));
  if (
    state.ownerId !== session.ownerId ||
    state.workspaceId !== session.workspaceId
  )
    throw new Error("다른 워크스페이스의 GA 가져오기 기록입니다.");
  return { state, token };
}

export async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function parseCoachExport(text: string): CoachExport {
  if (new TextEncoder().encode(text).byteLength > MAX_COACH_FILE_BYTES)
    throw new Error("파일은 2MB 이하여야 합니다.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("JSON 형식이 아닙니다.");
  }
  return coachExportSchema.parse(raw);
}

export type CoachImportPlan = {
  add: CoachSnapshot[];
  duplicates: number;
  recollected: number;
};
/** Pure planning step for the preview; ids/time are injected for tests. */
export async function planCoachImport(
  state: CoachStore,
  file: CoachExport,
  projectId: string,
  runtime: { id: () => string; now: () => string },
): Promise<CoachImportPlan> {
  const plan: CoachImportPlan = { add: [], duplicates: 0, recollected: 0 };
  const now = runtime.now();
  for (const period of file.periods) {
    const contentHash = await sha256(
      file.definitionVersion + "\n" + coachPeriodKey(period),
    );
    const same = (s: CoachSnapshot) =>
      s.projectId === projectId &&
      s.period.startDate === period.startDate &&
      s.period.endDate === period.endDate;
    const existing = [...state.snapshots, ...plan.add].filter(same);
    if (existing.some((s) => s.contentHash === contentHash)) {
      plan.duplicates++;
      continue;
    }
    if (existing.length) plan.recollected++;
    plan.add.push({
      id: runtime.id(),
      projectId,
      importedAt: now,
      source: "apps-script-export",
      generator: file.generator,
      definitionVersion: file.definitionVersion,
      propertyTimeZone: file.propertyTimeZone,
      generatedAt: file.generatedAt,
      contentHash,
      period,
    });
  }
  return plan;
}

/** Single write after token + revision check; on failure nothing changes. */
export function commitCoach(
  storage: Storage,
  loaded: LoadedCoach,
  add: CoachSnapshot[],
  session: CoachSession,
): LoadedCoach {
  if (storage.getItem(coachStorageKey(session)) !== loaded.token)
    throw new Error(
      "다른 탭에서 GA 가져오기 기록이 바뀌었습니다. 새로고침 후 다시 미리보기해 주세요.",
    );
  const next = coachStoreSchema.parse({
    ...loaded.state,
    revision: loaded.state.revision + 1,
    snapshots: [...loaded.state.snapshots, ...add],
  });
  const token = JSON.stringify(next);
  if (new TextEncoder().encode(token).byteLength > 4_000_000)
    throw new Error("로컬 저장 한도를 넘었습니다. 먼저 백업해 주세요.");
  storage.setItem(coachStorageKey(session), token);
  return { state: next, token };
}

/** Latest snapshot per (project, period); older ones remain as history. */
export function latestSnapshots(state: CoachStore, projectId: string) {
  const groups = new Map<string, CoachSnapshot[]>();
  for (const s of state.snapshots) {
    if (s.projectId !== projectId) continue;
    const k = `${s.period.startDate}/${s.period.endDate}`;
    groups.set(k, [...(groups.get(k) || []), s]);
  }
  return [...groups.values()]
    .map((list) => ({
      latest: list.reduce((a, b) => (b.importedAt >= a.importedAt ? b : a)),
      history: list.length,
    }))
    .sort((a, b) =>
      a.latest.period.startDate === b.latest.period.startDate
        ? b.latest.period.endDate.localeCompare(a.latest.period.endDate)
        : b.latest.period.startDate.localeCompare(a.latest.period.startDate),
    );
}
