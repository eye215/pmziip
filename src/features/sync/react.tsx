"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { session } from "../records/browser-store";
import { storageKey } from "../records/persistence";
import { sha256 } from "../coach-data/store";
import {
  loadSyncConfig,
  saveSyncConfig,
  syncConfigKey,
  syncConfigSchema,
  type SyncConfig,
} from "./client";
import { keepLocal, runSync, takeRemote, type SyncDeps } from "./engine";
import { bundleText, readBundle, type SyncItem } from "./model";

type Status = {
  running: boolean;
  message: string;
  ok: boolean | null;
  conflict: { remoteRevision: number } | null;
};
let status: Status = { running: false, message: "", ok: null, conflict: null };
const listeners = new Set<() => void>();
const set = (p: Partial<Status>) => {
  status = { ...status, ...p };
  for (const fn of listeners) fn();
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
export const useSyncStatus = () =>
  useSyncExternalStore(
    subscribe,
    () => status,
    () => status,
  );

const deps = (): SyncDeps => ({
  storage: window.localStorage,
  session,
  fetcher: window.fetch.bind(window),
  now: () => new Date().toISOString(),
  sha256,
});
export const readConfig = () => loadSyncConfig(window.localStorage, session);

/** After the sheet replaced local items, let every view re-read them. */
function refresh(changed: SyncItem[]) {
  // Always: settings views (status, device link) re-read after a round.
  window.dispatchEvent(new Event("pmzip:synced"));
  if (!changed.length) return;
  if (changed.includes("records"))
    window.dispatchEvent(
      new StorageEvent("storage", { key: storageKey(session) }),
    );
  window.dispatchEvent(new Event("pmzip:view"));
}

async function act(
  fn: (d: SyncDeps, c: SyncConfig) => ReturnType<typeof runSync>,
) {
  if (status.running) return;
  const cfg = readConfig();
  if (!cfg) return;
  set({ running: true });
  try {
    const o = await fn(deps(), cfg);
    saveSyncConfig(window.localStorage, session, o.config);
    refresh(o.changed);
    set({
      running: false,
      message: o.message,
      ok: o.config.lastOk,
      conflict: o.conflict,
    });
  } catch (e) {
    set({
      running: false,
      ok: false,
      message: e instanceof Error ? e.message : "동기화하지 못했습니다.",
    });
  }
}
export const syncNow = () => act(runSync);
export const keepMine = () => act(keepLocal);
export const takeSheet = () => act(takeRemote);

/** Runs in the background on every tab: on open, on return, after edits. */
export function RecordsSync() {
  const s = useSyncStatus();
  useEffect(() => {
    // Always armed: each tick checks for a config, so connecting starts it.
    let last = 0;
    const tick = async (force: boolean) => {
      const cfg = readConfig();
      if (!cfg || document.visibilityState !== "visible") return;
      const due = force || Date.now() - last > 60_000;
      let changed = false;
      if (!due) {
        const hash = await sha256(
          bundleText(readBundle(window.localStorage, session)),
        );
        changed = hash !== cfg.lastHash;
      }
      if (due || changed) {
        last = Date.now();
        await syncNow();
      }
    };
    const first = setTimeout(() => void tick(true), 600);
    const timer = setInterval(() => void tick(false), 8_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  if (!s.conflict) return null;
  return <ConflictBar />;
}

function ConflictBar() {
  return (
    <div className="sync-conflict" role="alert">
      <p>
        <strong>이 기기와 시트 기록이 둘 다 바뀌었습니다.</strong> 어느 쪽을
        쓸지 골라 주세요. 고르기 전에는 아무것도 덮어쓰지 않습니다.
      </p>
      <div className="actions">
        <button
          type="button"
          className="primary"
          onClick={() => void takeSheet()}
        >
          시트 기록 받기 (이 기기 기록은 백업)
        </button>
        <button type="button" onClick={() => void keepMine()}>
          이 기기 기록 올리기 (시트에 이전 버전 보관)
        </button>
      </div>
    </div>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Settings: connect this browser to the records-sync web app. */
export function SyncPanel() {
  const ids = useId();
  const s = useSyncStatus();
  // Read on every render: status changes and the bump below re-render.
  const [, bump] = useState(0);
  const cfg = readConfig();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const again = () => bump((n) => n + 1);
    window.addEventListener("pmzip:synced", again);
    return () => window.removeEventListener("pmzip:synced", again);
  }, []);

  function connect() {
    setError("");
    const r = syncConfigSchema.safeParse({
      url: url.trim(),
      token: token.trim(),
      lastRevision: null,
      lastHash: null,
      lastSyncAt: null,
      lastOk: null,
      lastResult: null,
    });
    if (!r.success) {
      setError(r.error.issues[0].message);
      return;
    }
    saveSyncConfig(window.localStorage, session, r.data);
    bump((n) => n + 1);
    setUrl("");
    setToken("");
    void syncNow();
  }
  function disconnect() {
    if (
      !window.confirm(
        "이 기기의 동기화를 끕니다. 기록은 이 기기와 시트에 그대로 남습니다.",
      )
    )
      return;
    window.localStorage.removeItem(syncConfigKey(session));
    bump((n) => n + 1);
    set({ message: "", ok: null, conflict: null });
  }

  return (
    <section className="panel coach-data" aria-labelledby={`${ids}-h`}>
      <h2 id={`${ids}-h`}>기기 간 기록 동기화</h2>
      <p className="subtle">
        원문·과제·보고서·부문 실적을 내 구글 드라이브의 비공개 시트(별도 Apps
        Script 웹 앱)에 저장해 PC와 휴대폰이 같은 기록을 봅니다. 주소와 토큰은
        이 브라우저에만 저장됩니다. 설정 방법은 tools/apps-script/records-sync
        안내를 따릅니다.
      </p>
      {!cfg ? (
        <>
          <div className="field">
            <label htmlFor={`${ids}-u`}>웹 앱 주소 (/exec)</label>
            <input
              id={`${ids}-u`}
              value={url}
              placeholder="https://script.google.com/macros/s/…/exec"
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${ids}-t`}>동기화 토큰</label>
            <input
              id={`${ids}-t`}
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
          <div className="actions">
            <button type="button" className="primary" onClick={connect}>
              연결하고 동기화
            </button>
          </div>
          {error && (
            <p role="alert" className="error-box">
              {error}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="sync-state">
            <span
              className={`conn-dot ${cfg.lastOk === false ? "conn-warn" : cfg.lastOk ? "conn-ok" : ""}`}
              aria-hidden="true"
            />
            {s.running
              ? "동기화 중…"
              : cfg.lastSyncAt
                ? `${when(cfg.lastSyncAt)} · ${cfg.lastResult ?? ""}`
                : "아직 동기화하지 않았습니다."}
            {cfg.lastRevision !== null && (
              <span className="subtle"> · 시트 버전 {cfg.lastRevision}</span>
            )}
          </p>
          {s.conflict && <ConflictBar />}
          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={s.running}
              onClick={() => void syncNow()}
            >
              지금 동기화
            </button>
            <button type="button" onClick={disconnect}>
              이 기기 동기화 끄기
            </button>
          </div>
        </>
      )}
      {s.message && !s.running && (
        <p role="status" className="subtle">
          {s.message}
        </p>
      )}
    </section>
  );
}
