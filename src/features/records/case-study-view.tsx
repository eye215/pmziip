"use client";

import { useId, useState } from "react";
import type { Initiative, RecordsState } from "./model";
import { caseStudy, caseStudyText, missingHint } from "./case-study";

/** Read-only case study of one initiative, with a plain-text copy. */
export function CaseStudyView({
  work,
  state,
}: {
  work: Initiative;
  state: RecordsState;
}) {
  const lines = caseStudy(work, state);
  const done = lines.filter((l) => !l.missing).length;
  const [copied, setCopied] = useState("");
  const statusId = useId();
  return (
    <details className="case-study">
      <summary>
        케이스 스터디 · {done}/{lines.length} 작성
      </summary>
      <ol className="case-lines">
        {lines.map((l) => (
          <li key={l.key} className={l.missing ? "case-missing" : undefined}>
            <strong>{l.label}</strong>{" "}
            <span>{l.missing ? `미작성 — ${missingHint(l.key)}` : l.text}</span>
          </li>
        ))}
      </ol>
      <div className="actions">
        <button
          type="button"
          aria-describedby={statusId}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(caseStudyText(work, lines));
              setCopied(
                "복사했습니다. 회사명·수치는 공개 전에 직접 가려 주세요.",
              );
            } catch {
              setCopied("복사하지 못했습니다. 브라우저 권한을 확인해 주세요.");
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
  );
}
