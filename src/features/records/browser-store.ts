"use client";
import { useSyncExternalStore } from "react";
import {
  applyCommand,
  type Command,
  type RecordsState,
  type Runtime,
} from "./model";
import { commitLocal, loadLocal, storageKey, type Loaded } from "./persistence";

export const session = {
  mode: "synthetic" as const,
  ownerId: "00000000-0000-4000-8000-000000000010",
  workspaceId: "00000000-0000-4000-8000-000000000001",
};
export const runtime: Runtime = {
  session,
  id: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
};
type Snapshot = { loaded: Loaded | null; error: string | null };
const loading: Snapshot = { loaded: null, error: null };
let snapshot: Snapshot | undefined;
const listeners = new Set<() => void>();
function read(): Snapshot {
  try {
    return { loaded: loadLocal(window.localStorage, session), error: null };
  } catch {
    return {
      loaded: null,
      error:
        "저장된 기록을 읽지 못했습니다. 초기화하지 않았습니다. 원본을 백업한 뒤 다시 확인해 주세요.",
    };
  }
}
function emit() {
  for (const fn of listeners) fn();
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  const storage = (event: StorageEvent) => {
    if (event.key === storageKey(session) || event.key === null) {
      snapshot = read();
      emit();
    }
  };
  window.addEventListener("storage", storage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", storage);
  };
}
export function useRecords() {
  return useSyncExternalStore(
    subscribe,
    () => snapshot ?? (snapshot = read()),
    () => loading,
  );
}
export async function saveRecords(
  command: Command | ((s: RecordsState) => RecordsState),
  expectedRevision: number,
) {
  if (!navigator.locks)
    throw new Error(
      "이 브라우저는 탭 간 안전한 저장 잠금을 지원하지 않습니다. 기존 기록을 백업한 뒤 지원 브라우저에서 열어 주세요.",
    );
  await navigator.locks.request(storageKey(session), () => {
    const loaded = snapshot?.loaded;
    if (!loaded) throw new Error("기록을 먼저 불러와 주세요.");
    if (loaded.state.revision !== expectedRevision)
      throw new Error(
        "작성 중 기록이 변경됐습니다. 입력값을 복사한 뒤 편집창을 다시 열어 주세요.",
      );
    const next =
      typeof command === "function"
        ? command(loaded.state)
        : applyCommand(loaded.state, command, runtime);
    if (next === loaded.state) return;
    const saved = commitLocal(window.localStorage, loaded, next, session);
    snapshot = { loaded: saved, error: null };
    emit();
  });
}
export function retryRecords() {
  snapshot = read();
  emit();
}
export function rawBackup() {
  return window.localStorage.getItem(storageKey(session)) || "";
}

function subscribeView(fn: () => void) {
  window.addEventListener("popstate", fn);
  window.addEventListener("pmzip:view", fn);
  return () => {
    window.removeEventListener("popstate", fn);
    window.removeEventListener("pmzip:view", fn);
  };
}
export function useView() {
  return useSyncExternalStore(
    subscribeView,
    () => location.search,
    () => "",
  );
}
export function changeView(values: Record<string, string>) {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  history.replaceState(null, "", url);
  window.dispatchEvent(new Event("pmzip:view"));
}
