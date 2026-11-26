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
import { maskText, parseHidden, type Masking } from "./public-export";
import "./report.css";

const hideKey = `pmzip:public-hide:v1:${session.ownerId}:${session.workspaceId}`;
function readHide() {
  try {
    return window.localStorage.getItem(hideKey) ?? "";
  } catch {
    return "";
  }
}

function observeFor(state: RecordsState) {
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
  return (
    <>
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
            setMsg("복사했습니다. 공개 전에 회사명·수치를 가려 주세요.");
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

/** Portfolio copy: names aliased, listed words hidden, money masked. */
function PublicExport({ text, masking }: { text: string; masking: Masking }) {
  const id = useId();
  const masked = maskText(text, masking);
  return (
    <details className="report-public">
      <summary>공개용 미리보기</summary>
      <label htmlFor={id}>가린 결과 (읽기 전용)</label>
      <textarea id={id} readOnly value={masked} rows={10} />
      <CopyButton text={masked} />
      <p className="subtle">
        프로젝트·고객사 이름은 별칭으로, 링크·이메일·전화번호와 금액·큰 수치는
        가렸습니다. 비율(%, %p)과 날짜는 남깁니다. 공개 전에 회사 규정을
        확인하고 직접 한 번 더 읽어 주세요.
      </p>
    </details>
  );
}

const thisMonth = () => new Date().toISOString().slice(0, 7);

/** "내 성과 보고서": live draft for a period, then an immutable snapshot. */
export function ReportPanel({ state }: { state: RecordsState }) {
  const ids = useId();
  const timeZone = state.workspace.projects[0]?.timezone || "Asia/Seoul";
  const [from, setFrom] = useState(() => `${thisMonth().slice(0, 4)}-01`);
  const [to, setTo] = useState(thisMonth);
  const [hide, setHide] = useState(readHide);
  const masking: Masking = {
    projects: state.workspace.projects.map((p) => p.name),
    clients: state.workspace.clients.map((c) => c.name),
    hidden: parseHidden(hide),
  };
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
      {typeof draft === "string" ? (
        <p role="alert" className="error-box">
          {draft}
        </p>
      ) : (
        <>
          <h3>미리보기 (확정 전)</h3>
          <ReportBody r={draft} />
          <div className="actions">
            <button type="button" className="primary" onClick={finalize}>
              이 내용으로 확정
            </button>
            <CopyButton text={reportText(draft)} />
          </div>
          <div className="field">
            <label htmlFor={`${ids}-hide`}>
              공개할 때 가릴 단어 (쉼표로: 회사명, 제품명, 사람 이름 등)
            </label>
            <input
              id={`${ids}-hide`}
              value={hide}
              onChange={(e) => {
                setHide(e.target.value);
                try {
                  window.localStorage.setItem(hideKey, e.target.value);
                } catch {
                  // Convenience only; masking still works for this view.
                }
              }}
            />
          </div>
          <PublicExport text={reportText(draft)} masking={masking} />
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
              <PublicExport text={reportText(r)} masking={masking} />
            </details>
          ))
      )}
    </section>
  );
}
