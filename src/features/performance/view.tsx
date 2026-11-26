"use client";
import { useId, useState } from "react";
import {
  coachMetrics,
  type MetricValue,
} from "../../lib/connectors/coach-export";
import { quarterTable } from "../../lib/connectors/public-financials";
import { explainQuarters } from "../../lib/connectors/easy-explain";
import { shareTable, vendors } from "../../lib/connectors/market-share";
import { changeView, session } from "../records/browser-store";
import {
  latestSnapshots,
  loadCoach,
  loadCoachSource,
  type CoachSnapshot,
} from "../coach-data/store";
import { Breakdown, Metrics, Warnings } from "../coach-data/panel";
import { cardPeriod } from "../coach-data/summary";
import { latestFin, loadFin } from "../public-financials/store";
import { latestPoints, loadMarket } from "../market-share/store";
import { coachMonth, countryLabel } from "../market-share/panel";
import { ColumnChart, InlineBar, LineChart, type ChartPoint } from "./charts";
import "./performance.css";

type ProjectOption = {
  id: string;
  name: string;
  kind: string;
  archivedAt: string | null;
};

const safe = <T,>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};
const int = new Intl.NumberFormat("ko-KR");
const pct = (v: number) =>
  new Intl.NumberFormat("ko-KR", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(v);
const dec = (v: number) =>
  new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(v);
const metricText = (v: MetricValue, f: (n: number) => string) =>
  v.value === null
    ? v.reason === "denominator_zero"
      ? "N/A"
      : "미집계"
    : f(v.value);
const isFullMonth = (s: CoachSnapshot) =>
  s.period.startDate.endsWith("-01") &&
  s.period.startDate.slice(0, 7) === s.period.endDate.slice(0, 7) &&
  (() => {
    const d = new Date(`${s.period.endDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.getUTCDate() === 1;
  })();
const periodLabel = (s: CoachSnapshot) =>
  isFullMonth(s)
    ? `${s.period.startDate.slice(0, 4)}년 ${Number(s.period.startDate.slice(5, 7))}월`
    : `${s.period.startDate} ~ ${s.period.endDate}`;

function GoToData() {
  return (
    <button type="button" onClick={() => changeView({ tab: "data" })}>
      데이터 연결로 이동
    </button>
  );
}

/** label · value · optional delta (text + arrow, never color alone). */
function Tile({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: string | null;
}) {
  return (
    <div className="stat-tile">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {delta && <p className="stat-delta">{delta}</p>}
    </div>
  );
}

type Metric = {
  id: string;
  label: string;
  percent: boolean;
  get: (m: ReturnType<typeof coachMetrics>) => number | null;
  format: (v: number) => string;
};
const coachChartMetrics: Metric[] = [
  {
    id: "uu",
    label: "훈련 완료율 (UU)",
    percent: true,
    get: (m) => m.userCompletionRate.value,
    format: pct,
  },
  {
    id: "count",
    label: "훈련 완료율 (횟수)",
    percent: true,
    get: (m) => m.countCompletionRate.value,
    format: pct,
  },
  {
    id: "score",
    label: "평균 평가점수",
    percent: false,
    get: (m) => m.averageScore.value,
    format: dec,
  },
  {
    id: "start",
    label: "진입 대비 시작률",
    percent: true,
    get: (m) => m.startRate.value,
    format: pct,
  },
  {
    id: "main",
    label: "진입 UU",
    percent: false,
    get: (m) => m.mainUsers,
    format: (v) => int.format(v),
  },
  {
    id: "done",
    label: "완료 UU",
    percent: false,
    get: (m) => m.doneUsers,
    format: (v) => int.format(v),
  },
];

function CoachSection({ projects }: { projects: ProjectOption[] }) {
  const ids = useId();
  const coachProjects = projects.filter(
    (p) => p.kind === "coach" && !p.archivedAt,
  );
  const preferred = safe(
    () => loadCoachSource(window.localStorage, session)?.projectId,
    undefined,
  );
  const [projectId, setProjectId] = useState(
    coachProjects.find((p) => p.id === preferred)?.id ??
      coachProjects[0]?.id ??
      "",
  );
  const list = safe(
    () =>
      latestSnapshots(loadCoach(window.localStorage, session).state, projectId),
    [],
  );
  const [selectedId, setSelectedId] = useState("");
  const [metricId, setMetricId] = useState("uu");
  const selected =
    list.find((x) => x.latest.id === selectedId)?.latest ?? cardPeriod(list);
  const months = list
    .map((x) => x.latest)
    .filter(isFullMonth)
    .sort((a, b) => a.period.startDate.localeCompare(b.period.startDate));
  const metric = coachChartMetrics.find((m) => m.id === metricId)!;

  if (!coachProjects.length) return null;
  const m = selected ? coachMetrics(selected.period) : null;
  const prev =
    selected && isFullMonth(selected)
      ? months
          .filter((s) => s.period.startDate < selected.period.startDate)
          .at(-1)
      : undefined;
  const pm = prev ? coachMetrics(prev.period) : null;
  const deltaPp = (a: number | null, b: number | null | undefined) =>
    a === null || b === null || b === undefined
      ? null
      : Math.abs(a - b) < 0.0005
        ? "전월과 같음"
        : `${a > b ? "▲" : "▼"} ${Math.abs((a - b) * 100).toFixed(1)}%p · 전월 대비`;
  const deltaNum = (
    a: number | null,
    b: number | null | undefined,
    f: (n: number) => string,
  ) =>
    a === null || b === null || b === undefined
      ? null
      : Math.abs(a - b) < 1e-9
        ? "전월과 같음"
        : `${a > b ? "▲" : "▼"} ${f(Math.abs(a - b))} · 전월 대비`;

  return (
    <section className="panel perf-section" aria-labelledby={`${ids}-h`}>
      <div className="perf-head">
        <h2 id={`${ids}-h`}>Galaxy Coach 이용</h2>
        {coachProjects.length > 1 && (
          <select
            aria-label="Coach 프로젝트"
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setSelectedId("");
            }}
          >
            {coachProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {!selected || !m ? (
        <div className="perf-empty">
          <p>아직 가져온 GA 데이터가 없습니다.</p>
          <GoToData />
        </div>
      ) : (
        <>
          <div className="field perf-period">
            <label htmlFor={`${ids}-period`}>기간</label>
            <select
              id={`${ids}-period`}
              value={selected.id}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {list.map(({ latest }) => (
                <option key={latest.id} value={latest.id}>
                  {periodLabel(latest)}
                </option>
              ))}
            </select>
          </div>
          <div className="stat-row">
            <Tile
              label="진입 UU"
              value={m.mainUsers === null ? "미집계" : int.format(m.mainUsers)}
              delta={deltaNum(m.mainUsers, pm?.mainUsers, (n) => int.format(n))}
            />
            <Tile
              label="훈련 완료율 (UU)"
              value={metricText(m.userCompletionRate, pct)}
              delta={deltaPp(
                m.userCompletionRate.value,
                pm?.userCompletionRate.value,
              )}
            />
            <Tile
              label="훈련 완료율 (횟수)"
              value={metricText(m.countCompletionRate, pct)}
              delta={deltaPp(
                m.countCompletionRate.value,
                pm?.countCompletionRate.value,
              )}
            />
            <Tile
              label="평균 평가점수"
              value={metricText(m.averageScore, dec)}
              delta={deltaNum(
                m.averageScore.value,
                pm?.averageScore.value,
                dec,
              )}
            />
          </div>
          <Warnings period={selected.period} />
          <div className="perf-chart">
            <div className="perf-chart-head">
              <h3>월별 추이</h3>
              <select
                aria-label="추이 지표"
                value={metricId}
                onChange={(e) => setMetricId(e.target.value)}
              >
                {coachChartMetrics.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </select>
            </div>
            {months.length >= 2 ? (
              <LineChart
                title={`월별 ${metric.label}`}
                percent={metric.percent}
                format={metric.format}
                short={(l) => l.replace(/^\d{2}(\d{2})년 (\d+)월$/, "$1.$2")}
                points={months.map<ChartPoint>((s) => ({
                  label: periodLabel(s),
                  value: metric.get(coachMetrics(s.period)),
                }))}
              />
            ) : (
              <p className="subtle">
                한 달 전체 기간이 2개 이상 쌓이면 월별 추이가 그려집니다. (현재{" "}
                {months.length}개)
              </p>
            )}
          </div>
          <details>
            <summary>{periodLabel(selected)} 전체 지표</summary>
            <Metrics period={selected.period} />
          </details>
          <Breakdown period={selected.period} />
          <p className="subtle">
            UU 완료율 = 완료 UU ÷ 시작 UU · 횟수 완료율 = REPORT 전체 ÷ 시작
            횟수 · 점수는 유효 1~5 건 평균 · GA 생성 {selected.generatedAt}
          </p>
        </>
      )}
    </section>
  );
}

const eok = (v: number | null) => {
  if (v === null) return "미집계";
  const e = v / 1e8;
  return Math.abs(e) >= 10000
    ? `${(e / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}조`
    : `${e.toLocaleString("ko-KR", { maximumFractionDigits: Math.abs(e) < 100 ? 1 : 0 })}억`;
};

function FinancialsSection() {
  const ids = useId();
  const latest = safe(
    () => latestFin(loadFin(window.localStorage, session).state),
    null,
  );
  const [corp, setCorp] = useState("");
  const [fsDiv, setFsDiv] = useState<"CFS" | "OFS">("CFS");
  if (!latest)
    return (
      <section className="panel perf-section" aria-labelledby={`${ids}-h`}>
        <h2 id={`${ids}-h`}>공시 실적</h2>
        <div className="perf-empty">
          <p>아직 가져온 공시 실적이 없습니다.</p>
          <GoToData />
        </div>
      </section>
    );
  const company =
    latest.file.companies.find((c) => c.corpCode === corp) ??
    latest.file.companies[0];
  const available = new Set(
    latest.file.rows
      .filter((r) => r.corpCode === company.corpCode)
      .map((r) => r.fsDiv),
  );
  const basis: "CFS" | "OFS" = available.has(fsDiv)
    ? fsDiv
    : available.has("CFS")
      ? "CFS"
      : "OFS";
  const table = quarterTable(latest.file.rows, basis, company.corpCode);
  const easy = explainQuarters(table);
  const recent = table.slice(0, 8).reverse();
  return (
    <section className="panel perf-section" aria-labelledby={`${ids}-h`}>
      <div className="perf-head">
        <h2 id={`${ids}-h`}>공시 실적</h2>
        <span className="subtle">DART · 분기</span>
      </div>
      <div className="segmented" role="group" aria-label="회사">
        {latest.file.companies.map((c) => (
          <button
            key={c.corpCode}
            type="button"
            aria-pressed={c.corpCode === company.corpCode}
            onClick={() => setCorp(c.corpCode)}
          >
            {c.corpName}
          </button>
        ))}
      </div>
      <section
        className={`easy-fin easy-${easy.mood}`}
        aria-labelledby={`${ids}-easy`}
      >
        <h3 id={`${ids}-easy`}>
          쉽게 보기{easy.period ? ` · ${easy.period}` : ""}
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
      </section>
      <div className="perf-chart">
        <div className="perf-chart-head">
          <h3>분기 매출</h3>
          <select
            aria-label="재무제표 기준"
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
        {recent.length ? (
          <ColumnChart
            title={`${company.corpName} 분기 매출`}
            format={(v) => eok(v)}
            short={(l) => l.replace(/^\d{2}(\d{2})-Q(\d)$/, "$1Q$2")}
            points={recent.map((r) => ({
              label: `${r.year}-Q${r.quarter}`,
              value: r.revenue === null ? null : r.revenue,
              note: `영업이익 ${eok(r.operatingIncome)}${r.operatingMargin.value === null ? "" : ` · 이익률 ${pct(r.operatingMargin.value)}`}${r.derived ? " · 4분기는 계산값" : ""}`,
            }))}
          />
        ) : (
          <p className="subtle">표시할 분기 매출이 없습니다.</p>
        )}
      </div>
      <details>
        <summary>분기 표 보기</summary>
        <div className="coach-table-wrap">
          <table className="coach-table">
            <caption>
              {company.corpName} ({basis === "CFS" ? "연결" : "별도"})
            </caption>
            <thead>
              <tr>
                <th scope="col">분기</th>
                <th scope="col">매출액</th>
                <th scope="col">영업이익</th>
                <th scope="col">이익률</th>
                <th scope="col">매출 YoY</th>
              </tr>
            </thead>
            <tbody>
              {table.slice(0, 12).map((t) => (
                <tr key={t.key}>
                  <th scope="row">
                    {t.year} Q{t.quarter}
                    {t.derived ? "*" : ""}
                  </th>
                  <td>{eok(t.revenue)}</td>
                  <td>{eok(t.operatingIncome)}</td>
                  <td>{metricText(t.operatingMargin as MetricValue, pct)}</td>
                  <td>
                    {t.revenueYoY.value === null
                      ? "—"
                      : `${t.revenueYoY.value > 0 ? "+" : ""}${pct(t.revenueYoY.value)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="subtle">* 4분기는 연간에서 1~3분기를 뺀 계산값입니다.</p>
      </details>
      <p className="subtle">
        국가·제품별 판매는 공시에 없습니다. Coach 지표와 인과관계로 해석하지
        않습니다.
      </p>
    </section>
  );
}

function MarketSection({ projects }: { projects: ProjectOption[] }) {
  const ids = useId();
  const points = safe(
    () => latestPoints(loadMarket(window.localStorage, session).state),
    [],
  );
  const vendorList = vendors(points);
  const [vendor, setVendor] = useState("");
  const [sort, setSort] = useState<"share" | "change" | "coach" | "name">(
    "share",
  );
  const [all, setAll] = useState(false);
  if (!points.length)
    return (
      <section className="panel perf-section" aria-labelledby={`${ids}-h`}>
        <h2 id={`${ids}-h`}>국가별 제조사 점유율</h2>
        <div className="perf-empty">
          <p>아직 가져온 점유율이 없습니다.</p>
          <GoToData />
        </div>
      </section>
    );
  const selected = vendorList.includes(vendor) ? vendor : vendorList[0];
  const coach = coachMonth(projects);
  const rows = shareTable(points, selected).map((r) => ({
    ...r,
    coachUU: coach?.users.get(r.country) ?? null,
  }));
  const by = {
    share: (a: (typeof rows)[number], b: (typeof rows)[number]) =>
      (b.share ?? -1) - (a.share ?? -1),
    change: (a: (typeof rows)[number], b: (typeof rows)[number]) =>
      Math.abs(b.changePp ?? -1) - Math.abs(a.changePp ?? -1),
    coach: (a: (typeof rows)[number], b: (typeof rows)[number]) =>
      (b.coachUU ?? -1) - (a.coachUU ?? -1),
    name: (a: (typeof rows)[number], b: (typeof rows)[number]) =>
      countryLabel(a.country).localeCompare(countryLabel(b.country), "ko"),
  }[sort];
  const sorted = [...rows].sort(by);
  const latestMonth =
    rows
      .map((r) => r.month)
      .sort()
      .at(-1) ?? "";
  const shown = all ? sorted : sorted.slice(0, 15);
  return (
    <section className="panel perf-section" aria-labelledby={`${ids}-h`}>
      <div className="perf-head">
        <h2 id={`${ids}-h`}>국가별 제조사 점유율</h2>
        <span className="subtle">{rows.length}개국 · 월별</span>
      </div>
      <div className="field-grid">
        <div className="field">
          <label htmlFor={`${ids}-v`}>제조사</label>
          <select
            id={`${ids}-v`}
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
        <div className="field">
          <label htmlFor={`${ids}-s`}>정렬</label>
          <select
            id={`${ids}-s`}
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
          >
            <option value="share">점유율 높은 순</option>
            <option value="change">1년 변화 큰 순</option>
            {coach && <option value="coach">Coach 진입 UU 많은 순</option>}
            <option value="name">국가 이름순</option>
          </select>
        </div>
      </div>
      <div className="coach-table-wrap">
        <table className="coach-table share-table">
          <caption>
            {selected} 점유율 · {latestMonth}
            {coach ? ` · Coach UU ${coach.month}` : ""}
          </caption>
          <thead>
            <tr>
              <th scope="col">국가</th>
              <th scope="col">점유율</th>
              <th scope="col">1년 변화</th>
              {coach && <th scope="col">Coach UU</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.country}>
                <th scope="row">
                  {countryLabel(r.country)}
                  {r.month !== latestMonth && (
                    <span className="subtle"> ({r.month})</span>
                  )}
                </th>
                <td className="share-cell">
                  <InlineBar value={r.share} />
                  {r.share === null ? "—" : `${r.share.toFixed(1)}%`}
                </td>
                <td>
                  {r.changePp === null
                    ? "—"
                    : `${r.changePp > 0 ? "▲" : r.changePp < 0 ? "▼" : ""} ${Math.abs(r.changePp).toFixed(1)}%p`}
                </td>
                {coach && (
                  <td>{r.coachUU === null ? "—" : int.format(r.coachUU)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > 15 && (
        <div className="actions">
          <button
            type="button"
            onClick={() => setAll(!all)}
            aria-expanded={all}
          >
            {all ? "상위 15개국만 보기" : `전체 ${sorted.length}개국 보기`}
          </button>
        </div>
      )}
      <p className="subtle">
        판매량이 아닌 웹 이용 기반 점유율입니다. 출처: StatCounter Global Stats
        (CC BY-SA 3.0). Coach 지표와 인과관계로 해석하지 않습니다.
      </p>
    </section>
  );
}

/** "성과" tab: view only. Connecting and syncing live in 설정 (data tab). */
export function PerformanceView({ projects }: { projects: ProjectOption[] }) {
  return (
    <div className="perf">
      <CoachSection projects={projects} />
      <FinancialsSection />
      <MarketSection projects={projects} />
    </div>
  );
}
