"use client";

import { useId, useMemo, useState } from "react";
import type { Initiative, RecordsState } from "../records/model";
import { runtime, session } from "../records/browser-store";
import { dayIn } from "../records/case-study";
import { sha256 } from "../coach-data/store";
import { readWindows } from "../coach-data/release-read";
import { compareRows, releaseSummary } from "../coach-data/release-compare";
import {
  buildReport,
  finalizeReport,
  loadReports,
  reportText,
  summaryLabels,
  type Observed,
  type Report,
  type ReportContent,
} from "./model";
import "./report.css";

export function observeFor(state: RecordsState) {
  return (w: Initiative): Observed => {
    const project = state.workspace.projects.find((p) => p.id === w.projectId);
    if (!w.releasedAt || project?.kind !== "coach")
      return { line: "", improved: null };
    const windows = readWindows(
      project.id,
      dayIn(w.releasedAt, project.timezone),
    );
    for (const win of windows) {
      const rows = compareRows(win);
      if (!rows) continue;
      const c = rows.find((r) => r.key === "countCompletionRate")!.change;
      const points = c.kind === "rate" ? c.points : null;
      return {
        line: releaseSummary([win]),
        improved: points === null ? null : points > 0,
      };
    }
    return { line: "", improved: null };
  };
}

function ReportBody({ r }: { r: ReportContent }) {
  if (Object.values(r.summary).every((v) => v === 0))
    return (
      <p className="empty-card">
        이 기간에는 수집·결정·배포 기록이 없습니다. 다른 기간을 고르거나,
        수집함에서 원문을 먼저 모아 주세요.
      </p>
    );
  return (
    <>
      <div className="report-hero">
        <p className="report-hero-k">횟수 완료율 상승이 관찰된 배포</p>
        <p className="report-hero-v">
          {r.summary.comparable
            ? `${r.summary.improvedObserved} / ${r.summary.comparable}`
            : "N/A"}
        </p>
        <p className="report-hero-s">
          {r.summary.comparable
            ? `전후 비교 가능한 배포 ${r.summary.comparable}건 중 · 관찰값`
            : "전후 비교 가능한 배포가 없습니다"}
        </p>
      </div>
      <ol className="report-funnel" aria-label="흐름">
        {(
          [
            ["collected", "수집한 원문", "collect"],
            ["created", "과제로 만듦", "decide"],
            ["go", "하기로 결정", "decide"],
            ["released", "배포", "release"],
            ["comparable", "전후 비교 가능", "impact"],
            ["improvedObserved", "완료율 상승(관찰)", "impact"],
          ] as const
        ).map(([k, label, st]) => {
          const max = Math.max(1, r.summary.collected, r.summary.created);
          const v = r.summary[k];
          return (
            <li key={k}>
              <span className="fn-label">{label}</span>
              <span className="fn-track">
                <span
                  className={`fn-bar st-${st}`}
                  style={{ width: `${v ? Math.max(2, (v / max) * 100) : 0}%` }}
                />
              </span>
              <b>{v}</b>
            </li>
          );
        })}
      </ol>
      <dl className="report-summary">
        {summaryLabels.map(([k, label]) => (
          <div key={k}>
            <dt>{label}</dt>
            <dd>{r.summary[k]}</dd>
          </div>
        ))}
      </dl>
      {r.cases.length === 0 ? (
        <p className="subtle">
          이 기간에 배포했거나 안 하기로 결정한 과제가 없습니다. 과제의 배포
          일시와 상태를 확인해 주세요.
        </p>
      ) : (
        r.cases.map((c) => (
          <details key={c.initiativeId} className="report-case">
            <summary>
              {c.title}{" "}
              <span className="subtle">
                · {c.kind === "released" ? "배포" : "안 하기로 결정"} ·{" "}
                {c.project} · {c.lines.filter((l) => !l.missing).length}/8
              </span>
            </summary>
            <ol>
              {c.lines.map((l) => (
                <li key={l.key}>
                  <strong>{l.label}</strong>{" "}
                  {l.missing ? <span className="subtle">미작성</span> : l.text}
                </li>
              ))}
            </ol>
          </details>
        ))
      )}
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const [msg, setMsg] = useState("");
  const id = useId();
  return (
    <span className="actions">
      <button
        type="button"
        aria-describedby={id}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setMsg("복사했습니다.");
          } catch {
            setMsg("복사하지 못했습니다.");
          }
        }}
      >
        텍스트로 복사
      </button>
      <span id={id} role="status" className="subtle">
        {msg}
      </span>
    </span>
  );
}

const thisMonth = () => new Date().toISOString().slice(0, 7);

/** Quick periods ending at the current month: month, second half, year. */
export function periodChoices(now: string) {
  const y = now.slice(0, 4);
  const secondHalf = Number(now.slice(5, 7)) >= 7;
  return [
    { key: "month", label: "이번 달", from: now, to: now },
    // In January–June the first half is the same as the year so far.
    ...(secondHalf
      ? [{ key: "half", label: "하반기", from: `${y}-07`, to: now }]
      : []),
    { key: "year", label: "올해", from: `${y}-01`, to: now },
  ];
}

/** "내 성과 보고서": live draft for a period, then an immutable snapshot. */
export function ReportPanel({ state }: { state: RecordsState }) {
  const ids = useId();
  const timeZone = state.workspace.projects[0]?.timezone || "Asia/Seoul";
  const [from, setFrom] = useState(() => `${thisMonth().slice(0, 4)}-01`);
  const [to, setTo] = useState(thisMonth);
  const [custom, setCustom] = useState(false);
  const periods = useMemo(() => periodChoices(thisMonth()), []);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<Report[]>(() => {
    try {
      return loadReports(window.localStorage, session).state.reports;
    } catch {
      return [];
    }
  });
  const draft = useMemo(() => {
    try {
      return buildReport(state, from, to, timeZone, observeFor(state));
    } catch (e) {
      return e instanceof Error ? e.message : "보고서를 만들지 못했습니다.";
    }
  }, [state, from, to, timeZone]);

  async function finalize() {
    if (typeof draft === "string") return;
    setError("");
    setMessage("");
    try {
      const hash = await sha256(JSON.stringify(draft));
      const loaded = loadReports(window.localStorage, session);
      const next = finalizeReport(
        window.localStorage,
        loaded,
        draft,
        hash,
        session,
        runtime,
      );
      setSaved(next.state.reports);
      const v = next.state.reports.at(-1)!.version;
      setMessage(`v${v}로 확정했습니다. 확정한 보고서는 고칠 수 없습니다.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "확정하지 못했습니다.");
    }
  }

  return (
    <section className="panel report-panel" aria-labelledby={`${ids}-h`}>
      <h2 id={`${ids}-h`}>내 성과 보고서</h2>
      <p className="subtle">
        기간 안에 수집·결정·배포한 기록과 과제별 케이스 스터디를 모읍니다. 기준
        시간대 {timeZone}. 지표 변화는 관찰값이며 원인으로 단정하지 않습니다.
      </p>
      <div className="status-chips" role="group" aria-label="기간">
        {periods.map((pr) => (
          <button
            key={pr.key}
            type="button"
            aria-pressed={!custom && from === pr.from && to === pr.to}
            onClick={() => {
              setCustom(false);
              setFrom(pr.from);
              setTo(pr.to);
            }}
          >
            {pr.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={
            custom || !periods.some((pr) => pr.from === from && pr.to === to)
          }
          onClick={() => setCustom(true)}
        >
          직접 고르기
        </button>
      </div>
      {(custom || !periods.some((pr) => pr.from === from && pr.to === to)) && (
        <div className="field-grid">
          <div className="field">
            <label htmlFor={`${ids}-from`}>시작 월</label>
            <input
              id={`${ids}-from`}
              type="month"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${ids}-to`}>끝 월</label>
            <input
              id={`${ids}-to`}
              type="month"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>
      )}
      {typeof draft === "string" ? (
        <p role="alert" className="error-box">
          {draft}
        </p>
      ) : (
        <>
          <h3>미리보기 (확정 전)</h3>
          <ReportBody r={draft} />
          <div className="actions">
            <button
              type="button"
              className="primary commit"
              disabled={Object.values(draft.summary).every((v) => v === 0)}
              onClick={finalize}
            >
              이 내용으로 확정
            </button>
            <CopyButton text={reportText(draft)} />
          </div>
        </>
      )}
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
      <h3>확정한 보고서</h3>
      {saved.length === 0 ? (
        <p className="subtle">아직 확정한 보고서가 없습니다.</p>
      ) : (
        [...saved]
          .sort((a, b) => b.finalizedAt.localeCompare(a.finalizedAt))
          .map((r) => (
            <details key={r.id} className="report-saved">
              <summary>
                {r.fromMonth} ~ {r.toMonth} · v{r.version}{" "}
                <span className="subtle">
                  · 확정 {dayIn(r.finalizedAt, r.timeZone)} · 해시{" "}
                  {r.contentHash.slice(0, 8)}
                </span>
              </summary>
              <ReportBody r={r} />
              <CopyButton text={reportText(r)} />
            </details>
          ))
      )}
    </section>
  );
}
