"use client";
import { useEffect, useState } from "react";
import {
  coachMetrics,
  type MetricValue,
} from "../../lib/connectors/coach-export";
import { session } from "../records/browser-store";
import {
  coachStorageKey,
  latestSnapshots,
  loadCoach,
  type CoachSnapshot,
} from "./store";
import "./coach-data.css";

function readSnapshots(projectId: string) {
  try {
    return latestSnapshots(
      loadCoach(window.localStorage, session).state,
      projectId,
    );
  } catch {
    return [];
  }
}
const isMonthEnd = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.getUTCDate() === 1;
};
/** Most recent full calendar month; otherwise the most recent period. */
export function cardPeriod(list: { latest: CoachSnapshot }[]) {
  const full = list.find(
    ({ latest: { period } }) =>
      period.startDate.endsWith("-01") &&
      isMonthEnd(period.endDate) &&
      period.startDate.slice(0, 7) === period.endDate.slice(0, 7),
  );
  return (full || list[0])?.latest ?? null;
}
const percent = new Intl.NumberFormat("ko-KR", {
  style: "percent",
  maximumFractionDigits: 1,
});
const decimal = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });
function text(v: MetricValue, kind: "percent" | "decimal") {
  if (v.value === null)
    return v.reason === "denominator_zero" ? "N/A" : "미집계";
  return kind === "percent" ? percent.format(v.value) : decimal.format(v.value);
}

/**
 * Coach project card metrics from imported GA periods. Without imported data
 * the card keeps the original "미수집" values.
 */
export function CoachProjectMetrics({
  projectId,
  labels,
}: {
  projectId: string;
  labels: readonly string[];
}) {
  const [list, setList] = useState(() => readSnapshots(projectId));
  useEffect(() => {
    const refresh = (e: StorageEvent) => {
      if (e.key === null || e.key === coachStorageKey(session))
        setList(readSnapshots(projectId));
    };
    // Same-tab saves (panel) do not fire "storage"; re-read on tab changes.
    const onView = () => setList(readSnapshots(projectId));
    window.addEventListener("storage", refresh);
    window.addEventListener("pmzip:view", onView);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("pmzip:view", onView);
    };
  }, [projectId]);
  const snap = cardPeriod(list);
  const m = snap ? coachMetrics(snap.period) : null;
  const values = m
    ? [text(m.userCompletionRate, "percent"), text(m.averageScore, "decimal")]
    : ["미수집", "미수집"];
  return (
    <>
      <dl className="metrics">
        {labels.map((label, i) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={m ? "coach-card-value" : undefined}>
              {values[i] ?? "미수집"}
            </dd>
          </div>
        ))}
      </dl>
      {snap && (
        <p className="coach-card-source">
          GA {snap.period.startDate}~{snap.period.endDate} · 완료율은 UU
          기준(완료 UU/시작 UU) · 점수는 유효 1~5 건 평균
        </p>
      )}
    </>
  );
}
