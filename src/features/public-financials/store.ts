import { z } from "zod";
import {
  publicFinSchema,
  type PublicFinFile,
} from "../../lib/connectors/public-financials";
import type { CoachSession, Storage } from "../coach-data/store";

/** Append-only history of fetched disclosure files (own key; records untouched). */
const instant = z.iso.datetime({ offset: true });
const snapshotSchema = z
  .object({
    id: z.uuid(),
    importedAt: instant,
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    file: publicFinSchema,
  })
  .strict();
export const finStoreSchema = z
  .object({
    schemaVersion: z.literal(1),
    ownerId: z.uuid(),
    workspaceId: z.uuid(),
    revision: z.number().int().nonnegative(),
    snapshots: z.array(snapshotSchema),
  })
  .strict();
export type FinStore = z.infer<typeof finStoreSchema>;
export type LoadedFin = { state: FinStore; token: string | null };

export const finStorageKey = (s: CoachSession) =>
  `pmzip:public-fin:v1:${s.ownerId}:${s.workspaceId}`;
export const finSourceKey = (s: CoachSession) =>
  `pmzip:public-fin-source:v1:${s.ownerId}:${s.workspaceId}`;

export function loadFin(storage: Storage, session: CoachSession): LoadedFin {
  const token = storage.getItem(finStorageKey(session));
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
  const state = finStoreSchema.parse(JSON.parse(token));
  if (
    state.ownerId !== session.ownerId ||
    state.workspaceId !== session.workspaceId
  )
    throw new Error("다른 워크스페이스의 공시 실적 기록입니다.");
  return { state, token };
}

/** Content hash ignores generatedAt/generator so daily re-runs are not new data. */
export function finContent(file: PublicFinFile) {
  return JSON.stringify({
    corpCode: file.corpCode,
    notes: file.notes,
    rows: [...file.rows].sort((a, b) =>
      `${a.year}${a.quarter}${a.fsDiv}${a.account}`.localeCompare(
        `${b.year}${b.quarter}${b.fsDiv}${b.account}`,
      ),
    ),
  });
}

/** Adds the file unless identical content is already stored. Returns null if unchanged. */
export function commitFin(
  storage: Storage,
  loaded: LoadedFin,
  file: PublicFinFile,
  contentHash: string,
  session: CoachSession,
  runtime: { id: () => string; now: () => string },
): LoadedFin | null {
  if (loaded.state.snapshots.some((s) => s.contentHash === contentHash))
    return null;
  if (storage.getItem(finStorageKey(session)) !== loaded.token)
    throw new Error(
      "다른 탭에서 공시 실적 기록이 바뀌었습니다. 다시 시도해 주세요.",
    );
  const next = finStoreSchema.parse({
    ...loaded.state,
    revision: loaded.state.revision + 1,
    snapshots: [
      ...loaded.state.snapshots,
      { id: runtime.id(), importedAt: runtime.now(), contentHash, file },
    ],
  });
  const token = JSON.stringify(next);
  if (new TextEncoder().encode(token).byteLength > 4_000_000)
    throw new Error("로컬 저장 한도를 넘었습니다.");
  storage.setItem(finStorageKey(session), token);
  return { state: next, token };
}

export function latestFin(state: FinStore) {
  return state.snapshots.reduce<FinStore["snapshots"][number] | null>(
    (a, b) => (a === null || b.importedAt >= a.importedAt ? b : a),
    null,
  );
}

export const finSourceSchema = z
  .object({
    sheetId: z.string().regex(/^[A-Za-z0-9_-]{25,100}$/),
    lastSyncAt: instant.nullable(),
    lastOk: z.boolean().nullable(),
    lastResult: z.string().max(500).nullable(),
  })
  .strict();
export type FinSource = z.infer<typeof finSourceSchema>;
