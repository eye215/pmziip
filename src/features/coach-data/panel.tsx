"use client";
import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import {
  coachMetrics,
  coachWarnings,
  type CoachExport,
  type CoachPeriod,
  type MetricValue,
} from "../../lib/connectors/coach-export";
import {
  coachStorageKey,
  commitCoach,
  latestSnapshots,
  loadCoach,
  parseCoachExport,
  planCoachImport,
  type CoachImportPlan,
  type LoadedCoach,
} from "./store";
import { session } from "../records/browser-store";
import "./coach-data.css";

type ProjectOption = {
  id: string;
  name: string;
  kind: string;
  archivedAt: string | null;
};
type Load = { loaded: LoadedCoach | null; error: string };

function read(): Load {
  try {
    return { loaded: loadCoach(window.localStorage, session), error: "" };
  } catch {
    return {
      loaded: null,
      error:
        "GA 가져오기 기록을 읽지 못했습니다. 초기화하지 않았습니다. 브라우저 저장소를 백업한 뒤 확인해 주세요.",
    };
  }
}
const number = new Intl.NumberFormat("ko-KR");
const percent = new Intl.NumberFormat("ko-KR", {
  style: "percent",
  maximumFractionDigits: 1,
});
const decimal = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });
function showCount(v: number | null) {
  return v === null ? "미집계" : number.format(v);
}
function show(v: MetricValue, kind: "percent" | "decimal") {
  if (v.value === null)
    return v.reason === "denominator_zero" ? "N/A (분모 0)" : "미집계";
  return kind === "percent" ? percent.format(v.value) : decimal.format(v.value);
}
function errorText(e: unknown) {
  if (e instanceof z.ZodError)
    return e.issues
      .slice(0, 6)
      .map((i) => `${i.path.join(".") || "파일"}: ${i.message}`)
      .join(" / ");
  return e instanceof Error ? e.message : "처리하지 못했습니다.";
}

function Metrics({ period }: { period: CoachPeriod }) {
  const m = coachMetrics(period);
  const rows: [string, string][] = [
    ["진입 UU / 횟수", `${showCount(m.mainUsers)} / ${showCount(m.mainCount)}`],
    [
      "시작 UU / 횟수",
      `${showCount(m.startUsers)} / ${showCount(m.startCount)}`,
    ],
    [
      "완료 UU / REPORT 전체",
      `${showCount(m.doneUsers)} / ${showCount(m.doneCount)}`,
    ],
    ["유효 점수(1~5) 건수", showCount(m.validScoreCount)],
    ["점수 없는 REPORT", showCount(m.reportWithoutValidScore)],
    ["진입 대비 시작률", show(m.startRate, "percent")],
    ["UU 완료율", show(m.userCompletionRate, "percent")],
    ["Count 완료율", show(m.countCompletionRate, "percent")],
    ["인당 훈련 횟수", show(m.startsPerUser, "decimal")],
    ["인당 완료 횟수", show(m.completionsPerUser, "decimal")],
    ["평균 평가점수", show(m.averageScore, "decimal")],
    ["고득점(S4+S5) 비율", show(m.highScoreRate, "percent")],
    ["저득점(S1+S2) 비율", show(m.lowScoreRate, "percent")],
    [
      "점수 분포 S1~S5",
      m.distribution
        .map((d, i) => `S${i + 1} ${show(d, "percent")}`)
        .join(" · "),
    ],
  ];
  return (
    <dl className="detail-fields coach-metrics">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
function Warnings({ period }: { period: CoachPeriod }) {
  const list = coachWarnings(period);
  if (!list.length) return null;
  return (
    <ul className="coach-warnings" aria-label="데이터 품질 경고">
      {list.map((w, i) => (
        <li key={i}>{w}</li>
      ))}
    </ul>
  );
}
function Breakdown({ period }: { period: CoachPeriod }) {
  const tables: [string, CoachPeriod["byCountry"]][] = [
    ["국가별", period.byCountry],
    ["Sales Case별", period.bySalesCase],
  ];
  return (
    <details>
      <summary>국가·Sales Case별 이용 현황</summary>
      <p className="subtle">
        분류별 UU는 같은 사용자가 여러 분류에 포함될 수 있어 합산하지 않습니다.
        전체 UU는 기간 전체 조회 값만 사용합니다.
      </p>
      {tables.map(([title, data]) => (
        <div key={title} className="coach-table-wrap">
          <table className="coach-table">
            <caption>{title}</caption>
            <thead>
              <tr>
                <th scope="col">분류</th>
                <th scope="col">진입 UU</th>
                <th scope="col">시작 UU</th>
                <th scope="col">완료 UU</th>
                <th scope="col">REPORT</th>
              </tr>
            </thead>
            <tbody>
              {[
                ...new Set(
                  [...data.main, ...data.start, ...data.done].map((r) => r.key),
                ),
              ].map((key) => {
                const f = (rows: typeof data.main) =>
                  rows.find((r) => r.key === key);
                return (
                  <tr key={key}>
                    <th scope="row">{key}</th>
                    <td>{showCount(f(data.main)?.users ?? null)}</td>
                    <td>{showCount(f(data.start)?.users ?? null)}</td>
                    <td>{showCount(f(data.done)?.users ?? null)}</td>
                    <td>{showCount(f(data.done)?.count ?? null)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </details>
  );
}

export function CoachDataPanel({ projects }: { projects: ProjectOption[] }) {
  const coachProjects = projects.filter(
    (p) => p.kind === "coach" && !p.archivedAt,
  );
  const [store, setStore] = useState<Load>(() => read());
  const [projectId, setProjectId] = useState(coachProjects[0]?.id || "");
  const [text, setText] = useState("");
  const [file, setFile] = useState<CoachExport | null>(null);
  const [plan, setPlan] = useState<CoachImportPlan | null>(null);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const errorBox = useRef<HTMLParagraphElement>(null);
  const ids = useId();
  const errorId = `${ids}-error`;

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === coachStorageKey(session))
        setStore(read());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  useEffect(() => {
    if (error) errorBox.current?.focus();
  }, [error]);

  function reset(value: string) {
    setText(value);
    setFile(null);
    setPlan(null);
    setApproved(false);
    setError("");
    setNotice("");
  }
  async function preview() {
    setNotice("");
    try {
      if (!store.loaded) throw new Error(store.error);
      if (!projectId) throw new Error("연결할 Coach 프로젝트를 선택해 주세요.");
      const parsed = parseCoachExport(text);
      const next = await planCoachImport(
        store.loaded.state,
        parsed,
        projectId,
        {
          id: () => crypto.randomUUID(),
          now: () => new Date().toISOString(),
        },
      );
      setFile(parsed);
      setPlan(next);
      setApproved(false);
      setError("");
    } catch (e) {
      setFile(null);
      setPlan(null);
      setError(errorText(e));
    }
  }
  async function save() {
    if (busy || !plan || !store.loaded) return;
    if (!approved) {
      setError("미리보기 내용과 품질 경고를 확인해 주세요.");
      return;
    }
    setBusy(true);
    try {
      if (!navigator.locks)
        throw new Error(
          "이 브라우저는 탭 간 안전한 저장 잠금을 지원하지 않습니다.",
        );
      await navigator.locks.request(coachStorageKey(session), async () => {
        const current = read();
        if (!current.loaded || current.loaded.token !== store.loaded!.token)
          throw new Error(
            "다른 탭에서 GA 가져오기 기록이 바뀌었습니다. 다시 미리보기해 주세요.",
          );
        const saved = commitCoach(
          window.localStorage,
          current.loaded,
          plan.add,
          session,
        );
        setStore({ loaded: saved, error: "" });
      });
      setNotice(
        `GA 기간 ${plan.add.length}개를 저장했습니다. 중복 ${plan.duplicates}개는 제외했습니다.`,
      );
      setText("");
      setFile(null);
      setPlan(null);
      setApproved(false);
      setError("");
    } catch (e) {
      // Keep the pasted file and preview so nothing has to be re-entered.
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const saved =
    store.loaded && projectId
      ? latestSnapshots(store.loaded.state, projectId)
      : [];
  return (
    <section className="panel coach-data" aria-labelledby={`${ids}-heading`}>
      <h2 id={`${ids}-heading`}>Galaxy Coach GA 가져오기</h2>
      <p>
        본인 계정에서 실행한 내보내기용 Apps Script의 JSON 파일을 올립니다.
        PM.zip은 GA나 Apps Script에 직접 접속하지 않으며, 조회 정의가
        coach-ga4-1.2와 다르면 거부합니다.
      </p>
      <p className="notice">
        실제 회사 수치는 조직 승인 후에만 가져오세요. 이 브라우저에만 저장되며
        다른 기기와 공유되지 않습니다.
      </p>
      {store.error && (
        <p role="alert" className="error-box">
          {store.error}
        </p>
      )}
      {!coachProjects.length ? (
        <p className="empty-state">
          Coach 유형 프로젝트가 없습니다. 프로젝트 탭에서 유형을 Coach로 지정해
          주세요.
        </p>
      ) : (
        <>
          <div className="field">
            <label htmlFor={`${ids}-project`}>연결 프로젝트</label>
            <select
              id={`${ids}-project`}
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setPlan(null);
                setApproved(false);
              }}
            >
              {coachProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${ids}-file`}>내보내기 JSON 파일</label>
            <input
              id={`${ids}-file`}
              type="file"
              accept=".json,application/json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  reset(await f.text());
                } catch {
                  setError("파일을 읽지 못했습니다.");
                }
              }}
            />
          </div>
          <div className="field">
            <label htmlFor={`${ids}-json`}>내보내기 JSON 붙여넣기</label>
            <textarea
              id={`${ids}-json`}
              value={text}
              onChange={(e) => reset(e.target.value)}
              aria-invalid={error && !plan ? true : undefined}
              aria-describedby={error ? errorId : undefined}
            />
          </div>
          <div className="actions">
            <button
              type="button"
              onClick={preview}
              disabled={!text.trim() || busy}
            >
              GA 파일 미리보기
            </button>
          </div>
          {error && (
            <p
              id={errorId}
              ref={errorBox}
              role="alert"
              className="error-box"
              tabIndex={-1}
            >
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="notice">
              {notice}
            </p>
          )}
          {plan && file && (
            <div className="import-preview">
              <p role="status">
                기간 {file.periods.length}개 · 새로 저장 {plan.add.length}개 ·
                중복 제외 {plan.duplicates}개 · 재수집 {plan.recollected}개
              </p>
              <p className="subtle">
                생성 {file.generatedAt} · {file.generator.name}{" "}
                {file.generator.version} · GA 시간대{" "}
                {file.propertyTimeZone || "미기록"}
              </p>
              {plan.add.map((s) => (
                <article
                  key={s.id}
                  className="record-row"
                  aria-label={`${s.period.startDate}~${s.period.endDate} 미리보기`}
                >
                  <h3>
                    {s.period.startDate} ~ {s.period.endDate}
                  </h3>
                  <Warnings period={s.period} />
                  <Metrics period={s.period} />
                </article>
              ))}
              <label className="check">
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={(e) => setApproved(e.target.checked)}
                />
                기간·조회 정의·품질 경고를 확인했습니다
              </label>
              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  onClick={save}
                  disabled={busy || !plan.add.length}
                >
                  {busy ? "저장 중…" : "GA 기간 저장"}
                </button>
              </div>
            </div>
          )}
          <h3 className="coach-saved-heading">저장된 기간</h3>
          {!saved.length ? (
            <p className="empty-state">
              이 프로젝트에 가져온 GA 기간이 없습니다.
            </p>
          ) : (
            saved.map(({ latest, history }) => (
              <article
                key={latest.id}
                className="record-row"
                aria-label={`${latest.period.startDate}~${latest.period.endDate} GA 기간`}
              >
                <span className="badge">
                  Apps Script 내보내기 · {latest.definitionVersion}
                  {history > 1 ? ` · 재수집 ${history - 1}회` : ""}
                </span>
                <h3>
                  {latest.period.startDate} ~ {latest.period.endDate}
                </h3>
                <p className="subtle">
                  GA 생성 {latest.generatedAt} · 가져옴 {latest.importedAt} · GA
                  시간대 {latest.propertyTimeZone || "미기록"}
                </p>
                <Warnings period={latest.period} />
                <Metrics period={latest.period} />
                <Breakdown period={latest.period} />
              </article>
            ))
          )}
        </>
      )}
    </section>
  );
}
