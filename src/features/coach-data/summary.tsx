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

function useCoachSnapshots(projectId: string) {
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
  return list;
}

/**
 * Coach project card metrics from imported GA periods: completion rate by
 * users and by count side by side, plus the average valid score. Without
 * imported data the card keeps the original "미수집" values.
 */
export function CoachProjectMetrics({
  projectId,
  labels,
}: {
  projectId: string;
  labels: readonly string[];
}) {
  const snap = cardPeriod(useCoachSnapshots(projectId));
  const m = snap ? coachMetrics(snap.period) : null;
  const entries: [string, string][] = m
    ? [
        [`${labels[0]} (UU)`, text(m.userCompletionRate, "percent")],
        [`${labels[0]} (횟수)`, text(m.countCompletionRate, "percent")],
        [labels[1], text(m.averageScore, "decimal")],
      ]
    : labels.map((label) => [label, "미수집"]);
  return (
    <>
      <dl className={m ? "metrics coach-card-metrics" : "metrics"}>
        {entries.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={m ? "coach-card-value" : undefined}>{value}</dd>
          </div>
        ))}
      </dl>
      {snap && (
        <p className="coach-card-source">
          GA {snap.period.startDate}~{snap.period.endDate} · UU 완료율 = 완료
          UU/시작 UU · 횟수 완료율 = REPORT 전체/시작 횟수 · 점수는 유효 1~5 건
          평균
        </p>
      )}
    </>
  );
}

/** Replaces the "not connected" note once GA periods were imported. */
export function CoachCollectionNote({ projectId }: { projectId: string }) {
  const list = useCoachSnapshots(projectId);
  if (!list.length) return <>데이터 수집은 아직 연결되지 않았습니다.</>;
  const last = list.reduce((a, b) =>
    b.latest.importedAt > a.latest.importedAt ? b : a,
  ).latest;
  return (
    <>
      GA 기간 {list.length}개 가져옴 · 마지막 {last.importedAt} · Apps Script
      내보내기 (GA API 직접 연결 아님)
    </>
  );
}
