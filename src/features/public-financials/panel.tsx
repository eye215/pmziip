"use client";
import { useEffect, useId, useState } from "react";
import { z } from "zod";
import {
  PUBLIC_FIN_CHUNK_HEADER,
  PUBLIC_FIN_TAB,
  publicFinSchema,
} from "../../lib/connectors/public-financials";
import {
  joinSheetChunks,
  parseCsv,
  sheetCsvUrl,
  sheetIdFrom,
} from "../../lib/connectors/sheet-source";
import { changeView, session } from "../records/browser-store";
import { loadCoachSource, sha256 } from "../coach-data/store";
import {
  commitFin,
  finContent,
  finSourceKey,
  finSourceSchema,
  finStorageKey,
  latestFin,
  loadFin,
  type FinSource,
  type LoadedFin,
} from "./store";
import "../coach-data/coach-data.css";

function readFin(): { loaded: LoadedFin | null; error: string } {
  try {
    return { loaded: loadFin(window.localStorage, session), error: "" };
  } catch {
    return {
      loaded: null,
      error: "공시 실적 기록을 읽지 못했습니다. 초기화하지 않았습니다.",
    };
  }
}
function readSource(): FinSource | null {
  try {
    const raw = window.localStorage.getItem(finSourceKey(session));
    if (raw === null) return null;
    const parsed = finSourceSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
function writeSource(source: FinSource | null) {
  try {
    if (source === null) window.localStorage.removeItem(finSourceKey(session));
    else
      window.localStorage.setItem(
        finSourceKey(session),
        JSON.stringify(source),
      );
  } catch {
    // Status still shows for this visit.
  }
}
function errorText(e: unknown) {
  if (e instanceof z.ZodError)
    return e.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "파일"}: ${i.message}`)
      .join(" / ");
  return e instanceof Error ? e.message : "처리하지 못했습니다.";
}
export function PublicFinancialsPanel() {
  const ids = useId();
  const [store, setStore] = useState(() => readFin());
  const [source, setSource] = useState<FinSource | null>(() => readSource());
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState("");
  const [syncing, setSyncing] = useState(false);

  async function sync(src: FinSource) {
    setSyncing(true);
    let next: FinSource;
    try {
      let res: Response;
      try {
        res = await fetch(sheetCsvUrl(src.sheetId, PUBLIC_FIN_TAB), {
          credentials: "omit",
          cache: "no-store",
        });
      } catch {
        throw new Error(
          "시트에 연결하지 못했습니다. 네트워크와 링크 공유를 확인해 주세요.",
        );
      }
      if (!res.ok)
        throw new Error(
          `시트를 읽지 못했습니다 (HTTP ${res.status}). ${PUBLIC_FIN_TAB} 탭과 링크 공유를 확인해 주세요.`,
        );
      const body = await res.text();
      if (/^\s*</.test(body))
        throw new Error(
          "시트가 공개 링크로 공유되지 않았거나 로그인 페이지가 반환되었습니다.",
        );
      const text = await joinSheetChunks(
        parseCsv(body),
        sha256,
        PUBLIC_FIN_CHUNK_HEADER,
        PUBLIC_FIN_TAB,
      );
      const file = publicFinSchema.parse(JSON.parse(text));
      const hash = await sha256(finContent(file));
      if (!navigator.locks)
        throw new Error(
          "이 브라우저는 탭 간 안전한 저장 잠금을 지원하지 않습니다.",
        );
      let changed = false;
      await navigator.locks.request(finStorageKey(session), () => {
        const current = readFin();
        if (!current.loaded) throw new Error(current.error);
        const saved = commitFin(
          window.localStorage,
          current.loaded,
          file,
          hash,
          session,
          {
            id: () => crypto.randomUUID(),
            now: () => new Date().toISOString(),
          },
        );
        if (saved) {
          changed = true;
          setStore({ loaded: saved, error: "" });
        }
      });
      next = {
        ...src,
        lastSyncAt: new Date().toISOString(),
        lastOk: true,
        lastResult: `${changed ? "새 공시 반영" : "변경 없음"} · ${file.rows.length}개 항목 (생성 ${file.generatedAt})`,
      };
    } catch (e) {
      next = {
        ...src,
        lastSyncAt: new Date().toISOString(),
        lastOk: false,
        lastResult: errorText(e).slice(0, 500),
      };
    }
    writeSource(next);
    setSource(next);
    setSyncing(false);
  }
  useEffect(() => {
    const initial = readSource();
    if (!initial) return;
    const timer = setTimeout(() => void sync(initial), 0);
    return () => clearTimeout(timer);
  }, []);
  function connect() {
    try {
      const src: FinSource = {
        sheetId: sheetIdFrom(input),
        lastSyncAt: null,
        lastOk: null,
        lastResult: null,
      };
      writeSource(src);
      setSource(src);
      setInput("");
      setInputError("");
      void sync(src);
    } catch (e) {
      setInputError(errorText(e));
    }
  }

  const latest = store.loaded ? latestFin(store.loaded.state) : null;
  const coachSheet = (() => {
    try {
      return loadCoachSource(window.localStorage, session)?.sheetId || "";
    } catch {
      return "";
    }
  })();
  return (
    <section className="panel coach-data" aria-labelledby={`${ids}-h`}>
      <h2 id={`${ids}-h`}>공시 실적 (DART)</h2>
      <p className="subtle">
        DART 분기 매출·영업이익·순이익을 공유 시트의 {PUBLIC_FIN_TAB} 탭에서
        읽습니다. 인증키는 Apps Script에만 있습니다.
      </p>
      {store.error && (
        <p role="alert" className="error-box">
          {store.error}
        </p>
      )}
      <section className="coach-sheet" aria-labelledby={`${ids}-sh`}>
        <h3 id={`${ids}-sh`}>시트 자동 동기화</h3>
        {!source ? (
          <>
            <div className="field">
              <label htmlFor={`${ids}-sheet`}>
                공시 스프레드시트 링크 또는 ID
              </label>
              <input
                id={`${ids}-sheet`}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setInputError("");
                }}
                autoComplete="off"
                aria-invalid={inputError ? true : undefined}
                aria-describedby={inputError ? `${ids}-err` : undefined}
              />
            </div>
            {inputError && (
              <p id={`${ids}-err`} role="alert" className="error-box">
                {inputError}
              </p>
            )}
            <div className="actions">
              <button
                type="button"
                className="primary"
                onClick={connect}
                disabled={!input.trim()}
              >
                공시 시트 연결
              </button>
              {coachSheet && (
                <button
                  type="button"
                  onClick={() => setInput(coachSheet)}
                  disabled={!!input}
                >
                  GA 시트와 같은 시트 사용
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <p
              role={source.lastOk === false ? "alert" : "status"}
              className={source.lastOk === false ? "error-box" : "notice"}
            >
              {syncing
                ? "공시 시트를 읽는 중…"
                : source.lastSyncAt
                  ? `${source.lastOk ? "동기화 완료" : "동기화 실패"} · ${source.lastSyncAt} · ${source.lastResult}`
                  : "아직 동기화하지 않았습니다."}
            </p>
            <div className="actions">
              <button
                type="button"
                onClick={() => void sync(source)}
                disabled={syncing}
              >
                공시 지금 동기화
              </button>
              <button
                type="button"
                onClick={() => {
                  if (
                    !window.confirm(
                      "공시 시트 연결을 해제할까요? 이미 가져온 실적은 유지됩니다.",
                    )
                  )
                    return;
                  writeSource(null);
                  setSource(null);
                }}
                disabled={syncing}
              >
                공시 시트 연결 해제
              </button>
            </div>
          </>
        )}
      </section>
      <div className="connector-summary">
        <span>
          {latest
            ? `회사 ${latest.file.companies.length}곳 · ${latest.file.rows.length}개 항목 · 가져옴 ${latest.importedAt}`
            : "아직 가져온 공시 실적이 없습니다."}
        </span>
        {latest && (
          <button type="button" onClick={() => changeView({ tab: "perf" })}>
            성과 탭에서 보기
          </button>
        )}
      </div>
    </section>
  );
}
