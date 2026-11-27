"use client";

import { useEffect, useId, useState } from "react";
import { runtime, session } from "../records/browser-store";
import {
  appendSegment,
  currentSegments,
  loadSegments,
  parseTrillion,
  segmentKey,
  segmentSource,
  type LoadedSegment,
  type SegmentEntry,
} from "./store";

const trillion = (v: number | null) =>
  v === null ? "—" : `${(v / 1e12).toFixed(2)}조원`;
const sourceHref = (s: string) =>
  /^\d{14}$/.test(s) ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${s}` : s;

function read(): { loaded: LoadedSegment | null; error: string } {
  try {
    return { loaded: loadSegments(window.localStorage, session), error: "" };
  } catch (e) {
    return {
      loaded: null,
      error: e instanceof Error ? e.message : "부문 실적을 읽지 못했습니다.",
    };
  }
}

/** Settings: hand-entered public segment results (e.g. MX/네트워크). */
export function SegmentFinPanel() {
  const ids = useId();
  const [store, setStore] = useState(read);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [quarter, setQuarter] = useState<1 | 2 | 3 | 4>(1);
  const [segment, setSegment] = useState("MX/네트워크");
  const [revenue, setRevenue] = useState("");
  const [op, setOp] = useState("");
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const again = () => setStore(read());
    window.addEventListener("pmzip:synced", again);
    return () => window.removeEventListener("pmzip:synced", again);
  }, []);
  const rows = store.loaded ? currentSegments(store.loaded.state) : [];
  const exists = rows.some(
    (r) => segmentKey(r) === segmentKey({ year, quarter, segment }),
  );
  const prevYear = (r: SegmentEntry) =>
    rows.find(
      (x) =>
        x.segment === r.segment &&
        x.year === r.year - 1 &&
        x.quarter === r.quarter,
    )?.revenue ?? null;

  function commit(entry: Omit<SegmentEntry, "id" | "enteredAt">, done: string) {
    const fresh = read();
    if (!fresh.loaded) throw new Error(fresh.error);
    const next = appendSegment(
      window.localStorage,
      fresh.loaded,
      entry,
      session,
      runtime,
    );
    setStore({ loaded: next, error: "" });
    window.dispatchEvent(new Event("pmzip:view"));
    setMessage(done);
  }

  function save() {
    setError("");
    setMessage("");
    try {
      const src = segmentSource.safeParse(source);
      if (!src.success) throw new Error(src.error.issues[0].message);
      const entry = {
        year,
        quarter,
        segment: segment.trim(),
        revenue: parseTrillion(revenue),
        operatingIncome: parseTrillion(op),
        source: src.data,
        removed: false,
      };
      if (entry.revenue === null && entry.operatingIncome === null)
        throw new Error("매출과 영업이익 중 하나는 적어 주세요.");
      commit(
        entry,
        `${entry.segment} ${year}-Q${quarter} 값을 저장했습니다.${exists ? " 이전 값은 기록으로 남습니다." : ""}`,
      );
      setRevenue("");
      setOp("");
      setSource("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했습니다.");
    }
  }

  function remove(r: SegmentEntry) {
    if (
      !window.confirm(
        `${r.segment} ${r.year}-Q${r.quarter} 값을 지울까요? 기록은 남습니다.`,
      )
    )
      return;
    try {
      commit(
        {
          year: r.year,
          quarter: r.quarter,
          segment: r.segment,
          revenue: r.revenue,
          operatingIncome: r.operatingIncome,
          source: r.source,
          removed: true,
        },
        `${r.segment} ${r.year}-Q${r.quarter} 값을 지웠습니다.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "지우지 못했습니다.");
    }
  }

  return (
    <section className="panel coach-data" aria-labelledby={`${ids}-h`}>
      <h2 id={`${ids}-h`}>공개 부문 실적 (직접 입력)</h2>
      <p className="subtle">
        삼성전자 분기 실적발표나 DART 보고서에 공개된 부문 숫자만 적습니다(예:
        MX/네트워크). 출처 링크가 있어야 저장되며, 내부 자료는 넣지 마세요.
        입력한 값은 이 브라우저에만 저장되고, 과제 케이스 스터디의 비즈니스 줄에
        쓰입니다.
      </p>
      {store.error && (
        <p role="alert" className="error-box">
          {store.error}
        </p>
      )}
      <div className="seg-form">
        <div className="field">
          <label htmlFor={`${ids}-y`}>연도</label>
          <input
            id={`${ids}-y`}
            type="number"
            inputMode="numeric"
            min={2000}
            max={2100}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label htmlFor={`${ids}-q`}>분기</label>
          <select
            id={`${ids}-q`}
            value={quarter}
            onChange={(e) =>
              setQuarter(Number(e.target.value) as 1 | 2 | 3 | 4)
            }
          >
            {[1, 2, 3, 4].map((q) => (
              <option key={q} value={q}>
                {q}분기
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${ids}-s`}>부문</label>
          <input
            id={`${ids}-s`}
            value={segment}
            maxLength={40}
            onChange={(e) => setSegment(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${ids}-r`}>매출 (조원)</label>
          <input
            id={`${ids}-r`}
            inputMode="decimal"
            placeholder="예: 33.50"
            value={revenue}
            onChange={(e) => setRevenue(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${ids}-o`}>영업이익 (조원)</label>
          <input
            id={`${ids}-o`}
            inputMode="decimal"
            placeholder="비우면 미공개"
            value={op}
            onChange={(e) => setOp(e.target.value)}
          />
        </div>
        <div className="field seg-source">
          <label htmlFor={`${ids}-src`}>
            출처 (https 링크 또는 DART 접수번호)
          </label>
          <input
            id={`${ids}-src`}
            value={source}
            placeholder="실적발표 자료 링크"
            onChange={(e) => setSource(e.target.value)}
          />
        </div>
      </div>
      <div className="actions">
        <button type="button" className="primary" onClick={save}>
          {exists ? "새 값으로 저장 (이전 값 보존)" : "저장"}
        </button>
      </div>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="subtle">아직 입력한 부문 실적이 없습니다.</p>
      ) : (
        <div className="table-scroll">
          <table className="seg-table">
            <caption className="visually-hidden">입력한 부문 실적</caption>
            <thead>
              <tr>
                <th scope="col">분기</th>
                <th scope="col">부문</th>
                <th scope="col">매출</th>
                <th scope="col">전년 동기</th>
                <th scope="col">영업이익</th>
                <th scope="col">출처</th>
                <th scope="col">
                  <span className="visually-hidden">지우기</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const prev = prevYear(r);
                return (
                  <tr key={segmentKey(r)}>
                    <td>
                      {r.year}-Q{r.quarter}
                    </td>
                    <td>{r.segment}</td>
                    <td>{trillion(r.revenue)}</td>
                    <td>
                      {r.revenue === null || prev === null || prev === 0
                        ? "N/A"
                        : `${(((r.revenue - prev) / Math.abs(prev)) * 100).toFixed(1)}%`}
                    </td>
                    <td>{trillion(r.operatingIncome)}</td>
                    <td>
                      <a
                        href={sourceHref(r.source)}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        출처
                      </a>
                    </td>
                    <td>
                      <button
                        type="button"
                        aria-label={`${r.segment} ${r.year}-Q${r.quarter} 지우기`}
                        onClick={() => remove(r)}
                      >
                        지우기
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
