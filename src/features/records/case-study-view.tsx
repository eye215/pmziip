"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { Initiative, RecordsState } from "./model";
import {
  caseStudy,
  caseStudyText,
  dayIn,
  flowStages,
  missingHint,
} from "./case-study";
import { readWindows } from "../coach-data/release-read";
import {
  compareRows,
  formatChange,
  releaseSummary,
  type CompareWindow,
} from "../coach-data/release-compare";

function ReleaseCompare({ windows }: { windows: CompareWindow[] }) {
  const shown = windows
    .map((w) => ({ w, rows: compareRows(w) }))
    .filter((x) => x.rows);
  if (!shown.length)
    return (
      <p className="subtle">
        배포 전·후로 비교할 GA 기간이 아직 없습니다. 매일 자동 수집되면 배포 후
        7일·다음 달이 지나서 채워집니다.
      </p>
    );
  return (
    <>
      {shown.map(({ w, rows }) => (
        <div className="table-scroll" key={w.kind}>
          <table className="release-compare">
            <caption>
              {w.kind === "week" ? "배포 전후 7일" : "배포 전후 월"} · 전{" "}
              {w.before!.period.startDate}~{w.before!.period.endDate} / 후{" "}
              {w.after!.period.startDate}~{w.after!.period.endDate}
            </caption>
            <thead>
              <tr>
                <th scope="col">지표</th>
                <th scope="col">배포 전</th>
                <th scope="col">배포 후</th>
                <th scope="col">변화</th>
              </tr>
            </thead>
            <tbody>
              {rows!.map((r) => {
                const f = formatChange(r.key, r.change);
                return (
                  <tr key={r.key}>
                    <th scope="row">{r.label}</th>
                    <td>{f.before}</td>
                    <td>{f.after}</td>
                    <td>{f.delta}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      <p className="subtle">
        관찰값입니다. 같은 기간의 다른 변화(캠페인·계절·다른 배포)도 영향을
        줍니다. 기간마다 UU를 따로 세며 합산하지 않습니다.
      </p>
    </>
  );
}

/** Read-only case study of one initiative, with a plain-text copy. */
export function CaseStudyView({
  work,
  state,
}: {
  work: Initiative;
  state: RecordsState;
}) {
  const project = state.workspace.projects.find((p) => p.id === work.projectId);
  const releaseDay =
    work.releasedAt && project
      ? dayIn(work.releasedAt, project.timezone)
      : null;
  // Re-read GA data when it changes (other tab, or a sync on another view).
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener("storage", bump);
    window.addEventListener("pmzip:view", bump);
    return () => {
      window.removeEventListener("storage", bump);
      window.removeEventListener("pmzip:view", bump);
    };
  }, []);
  const projectId = project?.id;
  const isCoach = project?.kind === "coach";
  const windows = useMemo(
    () =>
      releaseDay && isCoach && projectId
        ? readWindows(projectId, releaseDay)
        : [],
    // version: re-read on storage / view events
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [releaseDay, isCoach, projectId, version],
  );
  const summary = releaseSummary(windows);
  const lines = caseStudy(work, state, summary);
  const done = lines.filter((l) => !l.missing).length;
  const flow = flowStages(work, state, !!summary);
  const linkedCount = state.links.filter(
    (l) => l.initiativeId === work.id,
  ).length;
  const stageNote = (key: string) =>
    key === "collect"
      ? `원문 ${linkedCount}건`
      : key === "decide"
        ? work.status === "canceled"
          ? "안 하기로"
          : "결정됨"
        : key === "change"
          ? work.changeSummary
            ? work.changeSummary.slice(0, 24)
            : "기록 있음"
          : key === "release"
            ? (releaseDay ?? "배포됨")
            : "변화 관찰";
  const reached = flow.stages.filter((x) => x.done);
  const current = flow.declined
    ? "안 하기로 결정"
    : (reached.at(-1)?.label ?? "시작 전");
  const [copied, setCopied] = useState("");
  const statusId = useId();
  return (
    <>
      <div className="flow-row">
        <ol
          className={flow.declined ? "flow-bar declined" : "flow-bar"}
          aria-label={`진행 단계: ${current}`}
        >
          {flow.stages.map((x) => (
            <li
              key={x.key}
              className={x.done ? `on st-${x.key}` : undefined}
              title={`${x.label}${x.done ? " 완료" : ""}`}
            >
              <span className="visually-hidden">
                {x.label} {x.done ? "완료" : "전"}
              </span>
            </li>
          ))}
        </ol>
        <span className="flow-label">{current}</span>
        <span
          className="case-ring"
          style={{
            ["--p" as string]: String(Math.round((done / lines.length) * 100)),
          }}
          aria-hidden="true"
        >
          {done}/{lines.length}
        </span>
      </div>
      <details className="case-study">
        <summary>
          케이스 스터디 · {done}/{lines.length} 작성
        </summary>
        <ol className="flow-steps" aria-label="단계별 기록">
          {flow.stages.map((x) => (
            <li key={x.key} className={x.done ? `done st-${x.key}` : undefined}>
              <b>{x.label}</b>
              <span>{x.done ? stageNote(x.key) : "아직"}</span>
            </li>
          ))}
        </ol>
        <ol className="case-lines">
          {lines.map((l) => (
            <li key={l.key} className={l.missing ? "case-missing" : undefined}>
              <strong>{l.label}</strong>{" "}
              <span>
                {l.missing ? `미작성 — ${missingHint(l.key)}` : l.text}
              </span>
            </li>
          ))}
        </ol>
        {releaseDay && project?.kind === "coach" && (
          <section aria-label="배포 전후 비교">
            <h4>배포 전·후 (Coach GA)</h4>
            <ReleaseCompare windows={windows} />
          </section>
        )}
        <div className="actions">
          <button
            type="button"
            aria-describedby={statusId}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(caseStudyText(work, lines));
                setCopied("복사했습니다.");
              } catch {
                setCopied(
                  "복사하지 못했습니다. 브라우저 권한을 확인해 주세요.",
                );
              }
            }}
          >
            텍스트로 복사
          </button>
          <span id={statusId} role="status" className="subtle">
            {copied}
          </span>
        </div>
      </details>
    </>
  );
}
