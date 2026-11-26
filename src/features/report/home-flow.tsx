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
export function HomeFlow({
  state,
  month,
}: {
  state: RecordsState;
  month: string;
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
  const best = report.cases
    .map((c) => c.lines.find((l) => l.key === "result")?.text ?? "")
    .find((t) => t.includes("횟수 완료율"));
  const highlight = best?.match(/횟수 완료율 [^·]+/)?.[0] ?? null;
  return (
    <section className="home-flow" aria-labelledby="home-flow-h">
      <p className="home-flow-k" id="home-flow-h">
        {month} 흐름 · 관찰값
      </p>
      <p className="home-flow-v">
        {highlight ?? (s.released ? `배포 ${s.released}건` : "아직 배포 없음")}
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
  );
}
