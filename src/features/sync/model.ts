import { z } from "zod";
import {
  loadLocal,
  storageKey,
  type LocalStorage,
} from "../records/persistence";
import { loadReports, reportKey } from "../report/model";
import { loadSegments, segmentStorageKey } from "../segment-fin/store";

/**
 * Records sync through the user's own PMZIP spreadsheet (Apps Script web app,
 * company Google account). What travels: the records written in this app —
 * sources/initiatives/measurement, finalized reports, hand-entered segment
 * results. Sheet-backed data (GA, DART, share) is not included: every device
 * reads it from its sheet already. Each item is the exact stored text, so a
 * device ends up byte-identical; remote text is validated before it is used.
 */
export type Session = { ownerId: string; workspaceId: string };
export const SYNC_FORMAT = "pmzip.records-sync";
export const syncItems = ["records", "reports", "segments"] as const;
export type SyncItem = (typeof syncItems)[number];

const keyOf = (item: SyncItem, s: Session) =>
  item === "records"
    ? storageKey({ ...s, mode: "synthetic" })
    : item === "reports"
      ? reportKey(s)
      : segmentStorageKey(s);

export const bundleSchema = z
  .object({
    format: z.literal(SYNC_FORMAT),
    formatVersion: z.literal(1),
    items: z
      .object({
        records: z.string().max(8_000_000).nullable(),
        reports: z.string().max(4_000_000).nullable(),
        segments: z.string().max(1_000_000).nullable(),
      })
      .strict(),
  })
  .strict();
export type Bundle = z.infer<typeof bundleSchema>;

export function readBundle(storage: LocalStorage, s: Session): Bundle {
  const items = Object.fromEntries(
    syncItems.map((i) => [i, storage.getItem(keyOf(i, s))]),
  ) as Bundle["items"];
  return { format: SYNC_FORMAT, formatVersion: 1, items };
}

/** Stable text for hashing / comparing two bundles. */
export const bundleText = (b: Bundle) =>
  JSON.stringify(syncItems.map((i) => b.items[i]));

/** True when nothing worth keeping is stored (fresh device). */
export function isEmptyBundle(b: Bundle, s: Session) {
  if (b.items.reports || b.items.segments) return false;
  if (!b.items.records) return true;
  try {
    const st = loadLocal(memory({ [keyOf("records", s)]: b.items.records }), {
      ...s,
      mode: "synthetic",
    }).state;
    return st.sources.length === 0 && st.initiatives.length === 0;
  } catch {
    return false;
  }
}

function memory(init: Record<string, string>): LocalStorage {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
  };
}

/** Throws unless every present item parses as this workspace's data. */
export function validateBundle(raw: unknown, s: Session): Bundle {
  const b = bundleSchema.parse(raw);
  const store = memory(
    Object.fromEntries(
      syncItems
        .filter((i) => b.items[i] !== null)
        .map((i) => [keyOf(i, s), b.items[i] as string]),
    ),
  );
  if (b.items.records !== null) loadLocal(store, { ...s, mode: "synthetic" });
  if (b.items.reports !== null) loadReports(store, s);
  if (b.items.segments !== null) loadSegments(store, s);
  return b;
}

/**
 * Writes a validated remote bundle. The previous local text of each changed
 * item is kept under a backup key first, so nothing is lost. Returns the
 * items that changed.
 */
export function applyBundle(
  storage: LocalStorage & { removeItem?: (k: string) => void },
  s: Session,
  b: Bundle,
  stamp: string,
): SyncItem[] {
  const changed: SyncItem[] = [];
  for (const i of syncItems) {
    const key = keyOf(i, s);
    const before = storage.getItem(key);
    const after = b.items[i];
    if (before === after || after === null) continue;
    if (before !== null) storage.setItem(`${key}:before-sync:${stamp}`, before);
    storage.setItem(key, after);
    changed.push(i);
  }
  return changed;
}

export type SyncState = {
  /** Sheet revision this device last matched; null = never synced. */
  lastRevision: number | null;
  /** Hash of the local bundle at that moment. */
  lastHash: string | null;
};
export type Decision =
  "in_sync" | "push" | "pull" | "conflict" | "first_push" | "first_pull";

/** What to do, from revisions and hashes only (deterministic). */
export function decide(input: {
  state: SyncState;
  localHash: string;
  localEmpty: boolean;
  remoteRevision: number;
  remoteHash: string | null;
}): Decision {
  const { state, localHash, localEmpty, remoteRevision, remoteHash } = input;
  if (state.lastRevision === null) {
    if (remoteRevision === 0 || remoteHash === null) return "first_push";
    if (remoteHash === localHash) return "in_sync";
    return localEmpty ? "first_pull" : "conflict";
  }
  const localChanged = localHash !== state.lastHash;
  const remoteChanged = remoteRevision !== state.lastRevision;
  if (!localChanged && !remoteChanged) return "in_sync";
  if (localChanged && !remoteChanged) return "push";
  if (!localChanged && remoteChanged) return "pull";
  return remoteHash === localHash ? "in_sync" : "conflict";
}
