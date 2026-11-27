import {
  applyBundle,
  bundleText,
  decide,
  isEmptyBundle,
  readBundle,
  validateBundle,
  type Decision,
  type Session,
  type SyncItem,
} from "./model";
import { pullRemote, pushRemote, type SyncConfig } from "./client";
import type { LocalStorage } from "../records/persistence";

export type SyncDeps = {
  storage: LocalStorage;
  session: Session;
  fetcher: typeof fetch;
  now: () => string;
  sha256: (text: string) => Promise<string>;
};
export type SyncOutcome = {
  config: SyncConfig;
  decision: Decision | "error";
  message: string;
  /** Items replaced from the sheet (callers refresh their views). */
  changed: SyncItem[];
  conflict: { remoteRevision: number } | null;
};

const stamp = (iso: string) => iso.replace(/[^0-9]/g, "").slice(0, 14);

async function take(
  deps: SyncDeps,
  c: SyncConfig,
  remote: { revision: number; bundle: unknown },
) {
  const b = validateBundle(remote.bundle, deps.session);
  const changed = applyBundle(deps.storage, deps.session, b, stamp(deps.now()));
  const hash = await deps.sha256(
    bundleText(readBundle(deps.storage, deps.session)),
  );
  return {
    changed,
    config: { ...c, lastRevision: remote.revision, lastHash: hash },
  };
}

async function give(
  deps: SyncDeps,
  c: SyncConfig,
  baseRevision: number,
): Promise<SyncOutcome> {
  const local = readBundle(deps.storage, deps.session);
  const hash = await deps.sha256(bundleText(local));
  const r = await pushRemote(c, baseRevision, local, hash, deps.fetcher);
  if (!r.ok)
    return {
      config: c,
      decision: "conflict",
      message: "다른 기기에서 먼저 바뀌었습니다. 어느 쪽을 쓸지 골라 주세요.",
      changed: [],
      conflict: { remoteRevision: r.revision },
    };
  return {
    config: { ...c, lastRevision: r.revision, lastHash: hash },
    decision: "push",
    message: "이 기기 기록을 시트에 올렸습니다.",
    changed: [],
    conflict: null,
  };
}

function finish(o: SyncOutcome, deps: SyncDeps): SyncOutcome {
  const ok = o.decision !== "error" && o.decision !== "conflict";
  return {
    ...o,
    config: {
      ...o.config,
      lastSyncAt: deps.now(),
      lastOk: o.decision === "conflict" ? null : ok,
      lastResult: o.message.slice(0, 500),
    },
  };
}

/** One sync round. Never overwrites changes on both sides silently. */
export async function runSync(
  deps: SyncDeps,
  c: SyncConfig,
): Promise<SyncOutcome> {
  try {
    const local = readBundle(deps.storage, deps.session);
    const localHash = await deps.sha256(bundleText(local));
    const remote = await pullRemote(c, deps.fetcher);
    const decision = decide({
      state: c,
      localHash,
      localEmpty: isEmptyBundle(local, deps.session),
      remoteRevision: remote.revision,
      remoteHash: remote.hash,
    });
    const base = { changed: [] as SyncItem[], conflict: null };
    if (decision === "in_sync")
      return finish(
        {
          ...base,
          config: { ...c, lastRevision: remote.revision, lastHash: localHash },
          decision,
          message: "시트와 같습니다.",
        },
        deps,
      );
    if (decision === "push" || decision === "first_push")
      return finish(await give(deps, c, remote.revision), deps);
    if (decision === "pull" || decision === "first_pull") {
      const t = await take(deps, c, remote);
      return finish(
        {
          ...base,
          ...t,
          decision,
          message: t.changed.length
            ? "시트의 최신 기록을 받았습니다."
            : "시트와 같습니다.",
        },
        deps,
      );
    }
    return finish(
      {
        ...base,
        config: c,
        decision: "conflict",
        message:
          "이 기기와 시트 기록이 둘 다 바뀌었습니다. 어느 쪽을 쓸지 골라 주세요.",
        conflict: { remoteRevision: remote.revision },
      },
      deps,
    );
  } catch (e) {
    return finish(
      {
        config: c,
        decision: "error",
        message: e instanceof Error ? e.message : "동기화하지 못했습니다.",
        changed: [],
        conflict: null,
      },
      deps,
    );
  }
}

/** Conflict: keep this device's records (the sheet keeps the old version). */
export async function keepLocal(deps: SyncDeps, c: SyncConfig) {
  try {
    const remote = await pullRemote(c, deps.fetcher);
    return finish(await give(deps, c, remote.revision), deps);
  } catch (e) {
    return finish(
      {
        config: c,
        decision: "error",
        message: e instanceof Error ? e.message : "올리지 못했습니다.",
        changed: [],
        conflict: null,
      },
      deps,
    );
  }
}

/** Conflict: take the sheet's records (this device's are backed up locally). */
export async function takeRemote(deps: SyncDeps, c: SyncConfig) {
  try {
    const remote = await pullRemote(c, deps.fetcher);
    if (remote.revision === 0 || remote.bundle === null)
      throw new Error("시트에 받을 기록이 없습니다.");
    const t = await take(deps, c, remote);
    return finish(
      {
        ...t,
        decision: "pull",
        message:
          "시트 기록으로 바꿨습니다. 이 기기의 이전 기록은 브라우저에 백업해 두었습니다.",
        conflict: null,
      },
      deps,
    );
  } catch (e) {
    return finish(
      {
        config: c,
        decision: "error",
        message: e instanceof Error ? e.message : "받지 못했습니다.",
        changed: [],
        conflict: null,
      },
      deps,
    );
  }
}
