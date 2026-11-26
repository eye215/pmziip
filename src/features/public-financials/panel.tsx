"use client";
import { useEffect, useId, useState } from "react";
import { z } from "zod";
import {
  PUBLIC_FIN_CHUNK_HEADER,
  PUBLIC_FIN_TAB,
  publicFinSchema,
  quarterTable,
} from "../../lib/connectors/public-financials";
import { explainQuarters } from "../../lib/connectors/easy-explain";
import {
  joinSheetChunks,
  parseCsv,
  sheetCsvUrl,
  sheetIdFrom,
} from "../../lib/connectors/sheet-source";
import { session } from "../records/browser-store";
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
const eok = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat("ko-KR", {
  style: "percent",
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});
const pctPlain = new Intl.NumberFormat("ko-KR", {
  style: "percent",
  maximumFractionDigits: 1,
});
const eok1 = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });
const money = (v: number | null) =>
  v === null
    ? "미집계"
    : `${(Math.abs(v) < 100e8 ? eok1 : eok).format(v / 1e8)}억`;
const rate = (
  v: { value: number } | { value: null; reason: string },
  signed = false,
) =>
  v.value === null
    ? v.reason === "denominator_zero"
      ? "N/A"
      : "—"
    : (signed ? pct : pctPlain).format(v.value);

export function PublicFinancialsPanel() {
  const ids = useId();
  const [store, setStore] = useState(() => readFin());
  const [source, setSource] = useState<FinSource | null>(() => readSource());
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [fsDiv, setFsDiv] = useState<"CFS" | "OFS">("CFS");
  const [corp, setCorp] = useState("");
  const [view, setView] = useState<"easy" | "table">("easy");

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
  const company =
    latest?.file.companies.find((c) => c.corpCode === corp) ??
    latest?.file.companies[0];
  // Companies without subsidiaries only file 별도(OFS); fall back automatically.
  const available = new Set(
    latest?.file.rows
      .filter((r) => r.corpCode === company?.corpCode)
      .map((r) => r.fsDiv) ?? [],
  );
  const basis: "CFS" | "OFS" = available.has(fsDiv)
    ? fsDiv
    : available.has("CFS")
      ? "CFS"
      : "OFS";
  const table =
    latest && company
      ? quarterTable(latest.file.rows, basis, company.corpCode).slice(0, 12)
      : [];
  const easy = explainQuarters(table);
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
      <p>
        금융감독원 전자공시(DART)의 분기 매출·영업이익·순이익을 공유 시트의{" "}
        {PUBLIC_FIN_TAB} 탭에서 읽습니다. 인증키는 Apps Script에만 있고
        PM.zip에는 없습니다.
      </p>
      <p className="notice">
        공시는 전사(또는 연결) 분기 단위입니다. 국가·제품별 판매는 포함되지
        않으며, Coach 지표와 나란히 보더라도 인과관계로 해석하지 않습니다.
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
      {!latest ? (
        <p className="empty-state">아직 가져온 공시 실적이 없습니다.</p>
      ) : (
        <>
          <div className="field-grid">
            <div className="field">
              <label htmlFor={`${ids}-corp`}>회사</label>
              <select
                id={`${ids}-corp`}
                value={company?.corpCode}
                onChange={(e) => setCorp(e.target.value)}
              >
                {latest.file.companies.map((c) => (
                  <option key={c.corpCode} value={c.corpCode}>
                    {c.corpName}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${ids}-fs`}>재무제표 기준</label>
              <select
                id={`${ids}-fs`}
                value={basis}
                onChange={(e) => setFsDiv(e.target.value as "CFS" | "OFS")}
              >
                <option value="CFS" disabled={!available.has("CFS")}>
                  연결{available.has("CFS") ? "" : " (공시 없음)"}
                </option>
                <option value="OFS" disabled={!available.has("OFS")}>
                  별도{available.has("OFS") ? "" : " (공시 없음)"}
                </option>
              </select>
            </div>
          </div>
          <div className="actions" role="group" aria-label="보기 방식">
            <button
              type="button"
              aria-pressed={view === "easy"}
              className={view === "easy" ? "primary" : undefined}
              onClick={() => setView("easy")}
            >
              쉽게 보기
            </button>
            <button
              type="button"
              aria-pressed={view === "table"}
              className={view === "table" ? "primary" : undefined}
              onClick={() => setView("table")}
            >
              표로 보기
            </button>
          </div>
          {view === "easy" && (
            <section
              className={`easy-fin easy-${easy.mood}`}
              aria-labelledby={`${ids}-easy`}
            >
              <h3 id={`${ids}-easy`}>
                {company?.corpName} 쉽게 보기
                {easy.period ? ` · ${easy.period}` : ""}
              </h3>
              <p className="easy-headline">{easy.headline}</p>
              <ul>
                {easy.sentences.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
              {easy.caution.map((t, i) => (
                <p key={i} className="subtle">
                  {t}
                </p>
              ))}
              <p className="subtle">
                자동 설명(규칙 기반 {easy.version}) · AI 미사용 ·{" "}
                {basis === "CFS" ? "연결" : "별도"} 기준
              </p>
            </section>
          )}
          {!!latest.file.notes.length && (
            <ul className="coach-warnings" aria-label="공시 데이터 경고">
              {latest.file.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          {view === "table" && (
            <div className="coach-table-wrap">
              <table className="coach-table">
                <caption>
                  {company?.corpName} 분기 실적 (
                  {basis === "CFS" ? "연결" : "별도"}, 단위 억 원)
                </caption>
                <thead>
                  <tr>
                    <th scope="col">분기</th>
                    <th scope="col">매출액</th>
                    <th scope="col">영업이익</th>
                    <th scope="col">영업이익률</th>
                    <th scope="col">매출 전년동기比</th>
                    <th scope="col">공시</th>
                  </tr>
                </thead>
                <tbody>
                  {table.map((t) => (
                    <tr key={t.key}>
                      <th scope="row">
                        {t.year} Q{t.quarter}
                        {t.derived ? "*" : ""}
                      </th>
                      <td>{money(t.revenue)}</td>
                      <td>{money(t.operatingIncome)}</td>
                      <td>{rate(t.operatingMargin)}</td>
                      <td>{rate(t.revenueYoY, true)}</td>
                      <td>
                        {t.rceptNos.map((no) => (
                          <a
                            key={no}
                            className="source-link"
                            href={`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${no}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            원문
                            <span className="visually-hidden">
                              {" "}
                              {no} (새 창)
                            </span>
                          </a>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="subtle">
            * 4분기는 사업보고서 연간값에서 3분기 누적값을 뺀 계산값입니다.
            미집계는 공시가 없거나 계산할 수 없는 값이며 0으로 처리하지
            않습니다. 가져온 시각 {latest.importedAt} · 생성{" "}
            {latest.file.generatedAt} · 고유번호 {company?.corpCode}
          </p>
        </>
      )}
    </section>
  );
}
