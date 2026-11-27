"use client";

import { useMemo } from "react";
import type { RecordsState } from "../records/model";
import { buildReport } from "./model";
import { observeFor } from "./panel";

/**
 * Home card: this month's flow (collected → decided → released) and the best
 * observed GA change of a release. Observations only; same rules as the
 * impact report.
 */
const DAY = 86_400_000;

/** Today's to-dos, from records only (no guesses). */
export function todayItems(state: RecordsState, now = Date.now()) {
  const fresh = state.sources.filter((s) => s.status === "inbox").length;
  const live = state.initiatives.filter((w) => !w.mergedInto);
  const drafts = live.filter((w) => w.status === "draft");
  const oldest = drafts.length
    ? Math.floor(
        (now - Math.min(...drafts.map((w) => Date.parse(w.createdAt)))) / DAY,
      )
    : 0;
  const due = live.filter((w) => {
    if (!w.releasedAt) return false;
    const days = (now - Date.parse(w.releasedAt)) / DAY;
    return days >= 7 && days <= 60;
  }).length;
  return { fresh, drafts: drafts.length, oldest, due };
}

export function HomeFlow({
  state,
  month,
  go,
}: {
  state: RecordsState;
  month: string;
  go: (values: Record<string, string>) => void;
}) {
  const timeZone = state.workspace.projects[0]?.timezone || "Asia/Seoul";
  const report = useMemo(() => {
    try {
      return buildReport(state, month, month, timeZone, observeFor(state));
    } catch {
      return null;
    }
  }, [state, month, timeZone]);
  if (!report) return null;
  const s = report.summary;
  const changing = state.initiatives.filter(
    (w) => !w.mergedInto && ["planned", "in_progress"].includes(w.status),
  ).length;
  const t = todayItems(state);
  type Todo = {
    key: string;
    title: string;
    sub: string;
    to: Record<string, string>;
  };
  const todo = (
    [
      t.fresh > 0 && {
        key: "collect",
        title: `새 원문 ${t.fresh}건 확인`,
        sub: "수집함에서 과제로 묶거나 보관",
        to: { tab: "inbox" },
      },
      t.drafts > 0 && {
        key: "decide",
        title: `결정 대기 ${t.drafts}건`,
        sub:
          t.oldest > 0 ? `가장 오래된 것 ${t.oldest}일 전` : "오늘 만든 과제",
        to: { tab: "work", status: "draft" },
      },
      t.due > 0 && {
        key: "release",
        title: `배포 후 7일 지난 과제 ${t.due}건`,
        sub: "전후 비교 결과 확인",
        to: { tab: "perf" },
      },
    ] as (Todo | false)[]
  ).filter((x): x is Todo => !!x);
  const best = report.cases
    .map((c) => c.lines.find((l) => l.key === "result")?.text ?? "")
    .find((t) => t.includes("횟수 완료율"));
  const highlight = best?.match(/횟수 완료율 [^·]+/)?.[0] ?? null;
  if (
    state.sources.length === 0 &&
    state.initiatives.filter((w) => !w.mergedInto).length === 0
  )
    return (
      <section className="onboard" aria-labelledby="onboard-h">
        <p className="onboard-k">아직 기록이 없습니다</p>
        <h2 id="onboard-h">요구사항 하나로 시작해 보세요</h2>
        <ol className="onboard-steps">
          <li className="st-collect">
            <b>수집</b>메일·메신저 내용을 붙여넣어 원문으로 보관
          </li>
          <li className="st-decide">
            <b>결정</b>할지 말지, 언제 할지 사유와 함께 기록
          </li>
          <li className="st-release">
            <b>배포</b>바뀐 점과 배포일을 적으면 전후 비교
          </li>
          <li className="st-impact">
            <b>성과</b>기간을 골라 성과 보고서로 확정
          </li>
        </ol>
        <button
          type="button"
          className="primary"
          onClick={() => go({ tab: "inbox" })}
        >
          첫 원문 붙여넣기
        </button>
      </section>
    );
  return (
    <>
      <section className="home-flow" aria-labelledby="home-flow-h">
        <p className="home-flow-k" id="home-flow-h">
          {month} 흐름 · 관찰값
        </p>
        <p className="home-flow-v">
          {highlight ??
            (s.released ? `배포 ${s.released}건` : "아직 배포 없음")}
        </p>
        <dl className="home-flow-stats">
          <div>
            <dt>수집</dt>
            <dd>{s.collected}</dd>
          </div>
          <div>
            <dt>하기로 결정</dt>
            <dd>{s.go}</dd>
          </div>
          <div>
            <dt>안 하기로</dt>
            <dd>{s.no}</dd>
          </div>
          <div>
            <dt>배포</dt>
            <dd>{s.released}</dd>
          </div>
        </dl>
      </section>
      <dl className="stage-tiles" aria-label="단계별 개수">
        {(
          [
            ["collect", "수집", s.collected],
            ["decide", "결정", s.go + s.no],
            ["change", "변경 중", changing],
            ["release", "배포", s.released],
            ["impact", "상승 관찰", s.improvedObserved],
          ] as const
        ).map(([k, label, v]) => (
          <div key={k} className={`st-${k}`}>
            <dd>{v}</dd>
            <dt>{label}</dt>
          </div>
        ))}
      </dl>
      <section className="today" aria-labelledby="today-h">
        <h2 id="today-h">
          오늘 할 일 <span>{todo.length}</span>
        </h2>
        {todo.length === 0 ? (
          <p className="subtle">확인할 일이 없습니다.</p>
        ) : (
          <ul>
            {todo.map((x) => (
              <li key={x.key}>
                <button
                  type="button"
                  className={`today-item st-${x.key}`}
                  onClick={() => go(x.to)}
                >
                  <span className="today-dot" aria-hidden="true" />
                  <span className="today-text">
                    <b>{x.title}</b>
                    <span>{x.sub}</span>
                  </span>
                  <span className="today-go" aria-hidden="true">
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
