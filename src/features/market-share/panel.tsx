"use client";
import { useEffect, useId, useState } from "react";
import { z } from "zod";
import {
  MARKET_CHUNK_HEADER,
  MARKET_TAB,
  marketFileSchema,
  parseStatCounterCsv,
  shareTable,
  vendors,
  type SharePoint,
} from "../../lib/connectors/market-share";
import {
  joinSheetChunks,
  parseCsv,
  sheetCsvUrl,
  sheetIdFrom,
} from "../../lib/connectors/sheet-source";
import { session } from "../records/browser-store";
import {
  latestSnapshots,
  loadCoach,
  loadCoachSource,
  sha256,
} from "../coach-data/store";
import { cardPeriod } from "../coach-data/summary";
import {
  commitMarket,
  latestPoints,
  loadMarket,
  marketSourceKey,
  marketSourceSchema,
  marketStorageKey,
  type LoadedMarket,
  type MarketSource,
} from "./store";
import "../coach-data/coach-data.css";

type ProjectOption = { id: string; kind: string; archivedAt: string | null };
function readMarket(): { loaded: LoadedMarket | null; error: string } {
  try {
    return { loaded: loadMarket(window.localStorage, session), error: "" };
  } catch {
    return {
      loaded: null,
      error: "점유율 기록을 읽지 못했습니다. 초기화하지 않았습니다.",
    };
  }
}
function readSource(): MarketSource | null {
  try {
    const raw = window.localStorage.getItem(marketSourceKey(session));
    if (raw === null) return null;
    const parsed = marketSourceSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
function writeSource(source: MarketSource | null) {
  try {
    if (source === null)
      window.localStorage.removeItem(marketSourceKey(session));
    else
      window.localStorage.setItem(
        marketSourceKey(session),
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
      .map((i) => `${i.path.join(".") || "입력"}: ${i.message}`)
      .join(" / ");
  return e instanceof Error ? e.message : "처리하지 못했습니다.";
}
const regionNames = (() => {
  try {
    return new Intl.DisplayNames(["ko"], { type: "region" });
  } catch {
    return null;
  }
})();
/** "KR" → "대한민국 (KR)"; unknown codes stay as-is. */
function countryLabel(code: string) {
  try {
    const name = regionNames?.of(code);
    return name && name !== code ? `${name} (${code})` : code;
  } catch {
    return code;
  }
}
const share = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);
const pp = (v: number | null) =>
  v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%p`;

/** Coach per-country entry UU for the latest full month, if imported. */
function coachMonth(projects: ProjectOption[]) {
  try {
    const projectId =
      loadCoachSource(window.localStorage, session)?.projectId ??
      projects.find((p) => p.kind === "coach" && !p.archivedAt)?.id;
    if (!projectId) return null;
    const snap = cardPeriod(
      latestSnapshots(loadCoach(window.localStorage, session).state, projectId),
    );
    if (!snap) return null;
    const { startDate, endDate, byCountry } = snap.period;
    if (
      !startDate.endsWith("-01") ||
      startDate.slice(0, 7) !== endDate.slice(0, 7)
    )
      return null;
    return {
      month: startDate.slice(0, 7),
      users: new Map(byCountry.main.map((r) => [r.key.toUpperCase(), r.users])),
    };
  } catch {
    return null;
  }
}

export function MarketSharePanel({ projects }: { projects: ProjectOption[] }) {
  const ids = useId();
  const [store, setStore] = useState(() => readMarket());
  const [source, setSource] = useState<MarketSource | null>(() => readSource());
  const [sheetInput, setSheetInput] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [country, setCountry] = useState("");
  const [csv, setCsv] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [vendor, setVendor] = useState("");

  async function save(points: SharePoint[], from: "sheet" | "csv") {
    if (!navigator.locks)
      throw new Error(
        "이 브라우저는 탭 간 안전한 저장 잠금을 지원하지 않습니다.",
      );
    let result = { added: 0, unchanged: 0 };
    await navigator.locks.request(marketStorageKey(session), () => {
      const current = readMarket();
      if (!current.loaded) throw new Error(current.error);
      const r = commitMarket(
        window.localStorage,
        current.loaded,
        points,
        from,
        session,
        new Date().toISOString(),
      );
      result = r;
      setStore({ loaded: r.loaded, error: "" });
    });
    return result;
  }
  async function sync(src: MarketSource) {
    setSyncing(true);
    let next: MarketSource;
    try {
      let res: Response;
      try {
        res = await fetch(sheetCsvUrl(src.sheetId, MARKET_TAB), {
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
          `시트를 읽지 못했습니다 (HTTP ${res.status}). ${MARKET_TAB} 탭을 확인해 주세요.`,
        );
      const body = await res.text();
      if (/^\s*</.test(body))
        throw new Error(
          "시트가 공개 링크로 공유되지 않았거나 로그인 페이지가 반환되었습니다.",
        );
      const file = marketFileSchema.parse(
        JSON.parse(
          await joinSheetChunks(
            parseCsv(body),
            sha256,
            MARKET_CHUNK_HEADER,
            MARKET_TAB,
          ),
        ),
      );
      const r = await save(file.series, "sheet");
      next = {
        ...src,
        lastSyncAt: new Date().toISOString(),
        lastOk: true,
        lastResult:
          `새 값 ${r.added}개 · 변경 없음 ${r.unchanged}개 (생성 ${file.generatedAt})${file.notes.length ? ` · 경고 ${file.notes.join(" / ")}` : ""}`.slice(
            0,
            500,
          ),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, []);

  const points = store.loaded ? latestPoints(store.loaded.state) : [];
  const vendorList = vendors(points);
  const selected = vendorList.includes(vendor) ? vendor : (vendorList[0] ?? "");
  const table = selected ? shareTable(points, selected) : [];
  const coach = coachMonth(projects);
  const coachShare = (c: string) =>
    coach
      ? (points.find(
          (p) =>
            p.country === c && p.month === coach.month && p.vendor === selected,
        )?.share ?? null)
      : null;
  const coachSheet = (() => {
    try {
      return loadCoachSource(window.localStorage, session)?.sheetId || "";
    } catch {
      return "";
    }
  })();

  return (
    <section className="panel coach-data" aria-labelledby={`${ids}-h`}>
      <h2 id={`${ids}-h`}>국가별 제조사 점유율 (StatCounter)</h2>
      <p className="notice">
        판매량·출하량이 아니라 웹 이용 기반의 모바일 제조사 점유율입니다. Coach
        이용과 나란히 보더라도 인과관계로 해석하지 않습니다.
      </p>
      <p className="subtle">
        출처:{" "}
        <a
          className="source-link"
          href="https://gs.statcounter.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          StatCounter Global Stats
          <span className="visually-hidden"> (새 창)</span>
        </a>{" "}
        · CC BY-SA 3.0 · 공유·보고서에 출처를 함께 표기해 주세요.
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
                점유율 스프레드시트 링크 또는 ID
              </label>
              <input
                id={`${ids}-sheet`}
                value={sheetInput}
                onChange={(e) => setSheetInput(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={!sheetInput.trim()}
                onClick={() => {
                  try {
                    const src: MarketSource = {
                      sheetId: sheetIdFrom(sheetInput),
                      lastSyncAt: null,
                      lastOk: null,
                      lastResult: null,
                    };
                    writeSource(src);
                    setSource(src);
                    setSheetInput("");
                    void sync(src);
                  } catch (e) {
                    setMessage({ ok: false, text: errorText(e) });
                  }
                }}
              >
                점유율 시트 연결
              </button>
              {coachSheet && (
                <button
                  type="button"
                  onClick={() => setSheetInput(coachSheet)}
                  disabled={!!sheetInput}
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
                ? "점유율 시트를 읽는 중…"
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
                점유율 지금 동기화
              </button>
              <button
                type="button"
                disabled={syncing}
                onClick={() => {
                  if (
                    !window.confirm(
                      "점유율 시트 연결을 해제할까요? 가져온 값은 유지됩니다.",
                    )
                  )
                    return;
                  writeSource(null);
                  setSource(null);
                }}
              >
                점유율 시트 연결 해제
              </button>
            </div>
          </>
        )}
      </section>
      <details className="coach-manual">
        <summary>StatCounter CSV 직접 올리기</summary>
        <p className="subtle">
          gs.statcounter.com에서 Mobile Vendor Market Share · 국가 · Monthly로
          맞춘 뒤 Download Data(CSV)로 받은 파일을 국가별로 올립니다.
        </p>
        <div className="field">
          <label htmlFor={`${ids}-country`}>국가 코드 (예: KR)</label>
          <input
            id={`${ids}-country`}
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor={`${ids}-file`}>StatCounter CSV 파일</label>
          <input
            id={`${ids}-file`}
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setCsv(await f.text());
            }}
          />
        </div>
        <div className="field">
          <label htmlFor={`${ids}-csv`}>또는 CSV 붙여넣기</label>
          <textarea
            id={`${ids}-csv`}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
          />
        </div>
        <div className="actions">
          <button
            type="button"
            disabled={!csv.trim() || !country.trim()}
            onClick={async () => {
              try {
                const parsed = parseStatCounterCsv(csv, country);
                const r = await save(parsed, "csv");
                setMessage({
                  ok: true,
                  text: `${country} 점유율 새 값 ${r.added}개 · 변경 없음 ${r.unchanged}개를 반영했습니다.`,
                });
                setCsv("");
              } catch (e) {
                setMessage({ ok: false, text: errorText(e) });
              }
            }}
          >
            점유율 CSV 가져오기
          </button>
        </div>
      </details>
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={message.ok ? "notice" : "error-box"}
        >
          {message.text}
        </p>
      )}
      {!points.length ? (
        <p className="empty-state">아직 가져온 점유율이 없습니다.</p>
      ) : (
        <>
          <div className="field">
            <label htmlFor={`${ids}-vendor`}>제조사</label>
            <select
              id={`${ids}-vendor`}
              value={selected}
              onChange={(e) => setVendor(e.target.value)}
            >
              {vendorList.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="coach-table-wrap">
            <table className="coach-table">
              <caption>{selected} 국가별 모바일 이용 점유율</caption>
              <thead>
                <tr>
                  <th scope="col">국가</th>
                  <th scope="col">최근 월</th>
                  <th scope="col">점유율</th>
                  <th scope="col">1년 전</th>
                  <th scope="col">변화</th>
                  {coach && <th scope="col">{coach.month} 점유율</th>}
                  {coach && <th scope="col">{coach.month} Coach 진입 UU</th>}
                </tr>
              </thead>
              <tbody>
                {table.map((r) => (
                  <tr key={r.country}>
                    <th scope="row">{countryLabel(r.country)}</th>
                    <td>{r.month}</td>
                    <td>{share(r.share)}</td>
                    <td>{share(r.yearAgo)}</td>
                    <td>{pp(r.changePp)}</td>
                    {coach && <td>{share(coachShare(r.country))}</td>}
                    {coach && (
                      <td>
                        {(() => {
                          const u = coach.users.get(r.country);
                          return u === undefined || u === null
                            ? "—"
                            : u.toLocaleString("ko-KR");
                        })()}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="subtle">
            변화는 같은 달 1년 전 대비 %p 차이입니다. 값이 없으면 —로 두고 0으로
            바꾸지 않습니다.
            {coach
              ? " Coach 진입 UU는 가져온 GA 기간의 국가별 값이며, 국가별 UU는 더하지 않습니다."
              : " GA 한 달 전체 기간을 가져오면 같은 달 Coach 국가별 진입 UU를 함께 보여 줍니다."}
          </p>
        </>
      )}
    </section>
  );
}
