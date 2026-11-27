"use client";

import { useEffect, useId, useState } from "react";
import { session } from "../records/browser-store";
import { LineChart } from "../performance/charts";
import { loadCoachDb, type CoachDbStore } from "./store";

const int = (n: number) => n.toLocaleString("ko-KR");
const pct = (v: number | null) => (v === null ? "N/A" : `${v.toFixed(1)}%`);
const read = () => {
  try {
    return loadCoachDb(window.localStorage, session);
  } catch {
    return null;
  }
};

/** Perf tab: DB-session metrics by month (separate from GA; never mixed). */
export function CoachDbView() {
  const ids = useId();
  const [s, setS] = useState<CoachDbStore | null>(read);
  const [month, setMonth] = useState("");
  useEffect(() => {
    const again = () => setS(read());
    window.addEventListener("pmzip:view", again);
    window.addEventListener("storage", again);
    window.addEventListener("pmzip:synced", again);
    return () => {
      window.removeEventListener("pmzip:synced", again);
      window.removeEventListener("pmzip:view", again);
      window.removeEventListener("storage", again);
    };
  }, []);
  if (!s) return null;
  const months = s.global.map((g) => g.year_month);
  const pick = months.includes(month) ? month : (months.at(-1) ?? "");
  const countries = s.country
    .filter((c) => c.year_month === pick)
    .sort(
      (a, b) =>
        b.entries - a.entries || a.country_code.localeCompare(b.country_code),
    );
  return (
    <section className="panel" aria-labelledby={`${ids}-h`}>
      <h2 id={`${ids}-h`}>Galaxy Coach 이용 · DB 세션 기준</h2>
      <p className="subtle">
        V1(Stage)·V2(Sales) 세션을 맞춘 값입니다. GA 이벤트 기준 숫자와 정의가
        달라 합치지 않습니다. 월은 진입 일시 기준({s.config.timeZone}), 완료율 =
        전체 완료 건수 ÷ 전체 진입 건수. 마지막 집계{" "}
        {s.generatedAt.slice(0, 10)}.
      </p>
      <LineChart
        title="월별 세션 완료율"
        points={s.global.map((g) => ({
          label: g.year_month,
          value: g.session_completion_rate,
        }))}
        format={(v) => `${v.toFixed(1)}%`}
        percent
        short={(l) => `${l.slice(2, 4)}.${Number(l.slice(5))}`}
      />
      <div className="table-scroll">
        <table className="seg-table" aria-label="월별 전체">
          <thead>
            <tr>
              <th scope="col">월</th>
              <th scope="col">진입 건수</th>
              <th scope="col">완료 건수</th>
              <th scope="col">세션 완료율</th>
              <th scope="col">진입 사용자</th>
              <th scope="col">사용자 완료율</th>
              <th scope="col">V1 / V2 진입</th>
            </tr>
          </thead>
          <tbody>
            {s.global.map((g) => {
              const v = (k: "V1" | "V2") =>
                s.version.find(
                  (x) => x.year_month === g.year_month && x.version === k,
                )?.entries ?? 0;
              return (
                <tr key={g.year_month}>
                  <td>{g.year_month}</td>
                  <td>{int(g.entries)}</td>
                  <td>{int(g.completions)}</td>
                  <td>{pct(g.session_completion_rate)}</td>
                  <td>{int(g.entry_users)}</td>
                  <td>{pct(g.user_completion_rate)}</td>
                  <td>
                    {int(v("V1"))} / {int(v("V2"))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="field">
        <label htmlFor={`${ids}-m`}>국가별 보기 월</label>
        <select
          id={`${ids}-m`}
          value={pick}
          onChange={(e) => setMonth(e.target.value)}
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <div className="table-scroll">
        <table className="seg-table" aria-label={`${pick} 국가별`}>
          <thead>
            <tr>
              <th scope="col">국가</th>
              <th scope="col">진입 건수</th>
              <th scope="col">완료 건수</th>
              <th scope="col">세션 완료율</th>
              <th scope="col">진입 사용자</th>
              <th scope="col">사용자 완료율</th>
            </tr>
          </thead>
          <tbody>
            {countries.map((c) => (
              <tr key={c.country_code}>
                <td>
                  {c.country_code === "UNKNOWN" ? "미확인" : c.country_code}
                </td>
                <td>{int(c.entries)}</td>
                <td>{int(c.completions)}</td>
                <td>{pct(c.session_completion_rate)}</td>
                <td>{int(c.entry_users)}</td>
                <td>{pct(c.user_completion_rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
