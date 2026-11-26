"use client";
import { useId, useState } from "react";
import { z } from "zod";
import {
  EXTRACT_VERSION,
  extractCandidates,
  typeNames,
  type Candidate,
  type CandidateType,
} from "../../lib/connectors/requirement-extract";
import { parseInboxExport } from "../../lib/connectors/inbox-export";
import { runtime, saveRecords } from "../records/browser-store";
import {
  applyCommand,
  type Command,
  type RecordsState,
} from "../records/model";
import "./intake.css";

/**
 * Requirement intake: paste (KakaoTalk / Teams / Slack / meeting notes / mail)
 * or a private Gmail·Calendar export file → rule-based candidates → the user
 * confirms → original text is saved as 원문, and (optionally) the chosen
 * candidates become 과제 drafts linked to it. Nothing is saved before confirm.
 */
type SourceType = "manual" | "mail" | "slack" | "teams" | "other";
type Message = {
  key: string;
  title: string;
  body: string;
  sourceType: SourceType;
  reference: string;
  collectedAt: string;
  requesterRole: string;
  channelLabel: string;
  duplicate: boolean;
  candidates: Candidate[];
};
type Pick = {
  source: boolean;
  candidates: Record<string, { on: boolean; title: string }>;
};

const channels: { id: string; label: string; type: SourceType }[] = [
  { id: "kakao", label: "카카오톡·메신저", type: "other" },
  { id: "teams", label: "Teams", type: "teams" },
  { id: "slack", label: "Slack", type: "slack" },
  { id: "meeting", label: "회의록", type: "other" },
  { id: "mail", label: "메일", type: "mail" },
  { id: "other", label: "기타", type: "other" },
];
const categoryOf: Record<
  CandidateType,
  "fix" | "improvement" | "new" | "other"
> = {
  bug: "fix",
  request: "improvement",
  change: "improvement",
  decision: "other",
  question: "other",
};
const trim = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;
function errorText(e: unknown) {
  if (e instanceof z.ZodError)
    return e.issues
      .slice(0, 4)
      .map((i) => `${i.path.join(".") || "파일"}: ${i.message}`)
      .join(" / ");
  return e instanceof Error ? e.message : "처리하지 못했습니다.";
}

export function RequirementIntake({ state }: { state: RecordsState }) {
  const ids = useId();
  const [mode, setMode] = useState<"paste" | "file">("paste");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [channel, setChannel] = useState("kakao");
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [makeWork, setMakeWork] = useState(false);
  const projects = state.workspace.projects.filter((p) => !p.archivedAt);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const isDuplicate = (body: string, reference: string) =>
    state.sources.some(
      (s) => (reference && s.reference === reference) || s.rawText === body,
    );
  function review(list: Message[]) {
    setMessages(list);
    setPicks(
      Object.fromEntries(
        list.map((m) => [
          m.key,
          {
            source: !m.duplicate && m.candidates.length > 0,
            candidates: Object.fromEntries(
              m.candidates.map((c) => [c.key, { on: true, title: c.title }]),
            ),
          },
        ]),
      ),
    );
    setError("");
    setNotice("");
  }
  function fromPaste() {
    const body = text.trim();
    if (!body) return;
    const ch = channels.find((c) => c.id === channel)!;
    const candidates = extractCandidates(body);
    const first = body
      .split("\n")
      .find((l) => l.trim())!
      .trim();
    review([
      {
        key: "paste",
        title: trim(title.trim() || candidates[0]?.title || first, 200),
        body,
        sourceType: ch.type,
        reference: "",
        collectedAt: new Date().toISOString(),
        requesterRole: "",
        channelLabel: ch.label,
        duplicate: isDuplicate(body, ""),
        candidates,
      },
    ]);
  }
  async function fromFile(file: File) {
    try {
      const data = parseInboxExport(await file.text());
      review(
        data.items.map((it) => ({
          key: it.externalId,
          title: trim(it.title || "(제목 없음)", 200),
          body: it.body || it.title,
          sourceType: it.channel === "gmail" ? "mail" : "other",
          reference: it.link,
          collectedAt: it.receivedAt,
          requesterRole: it.fromDomain ? `보낸 곳 ${it.fromDomain}` : "",
          channelLabel: it.channel === "gmail" ? "Gmail" : "캘린더",
          duplicate: isDuplicate(it.body || it.title, it.link),
          candidates: extractCandidates(`${it.title}\n\n${it.body}`),
        })),
      );
    } catch (e) {
      setMessages(null);
      setError(errorText(e));
    }
  }

  const chosen = (messages ?? []).filter((m) => picks[m.key]?.source);
  const workCount = makeWork
    ? chosen.reduce(
        (n, m) =>
          n + Object.values(picks[m.key].candidates).filter((c) => c.on).length,
        0,
      )
    : 0;

  async function save() {
    if (busy || !chosen.length) return;
    if (makeWork && !projectId) {
      setError("과제 초안을 만들 프로젝트를 골라 주세요.");
      return;
    }
    setBusy(true);
    try {
      await saveRecords((s) => {
        let next = s;
        for (const m of chosen) {
          const before = new Set(next.sources.map((x) => x.id));
          const sourceCmd: Command = {
            type: "source.save",
            data: {
              title: m.title.trim() || "(제목 없음)",
              rawText: m.body.slice(0, 100000),
              sourceType: m.sourceType,
              reference: m.reference,
              collectedAt: m.collectedAt,
              requesterRole: m.requesterRole,
              sensitivity: "internal",
            },
          };
          next = applyCommand(next, sourceCmd, runtime);
          const sourceId = next.sources.find((x) => !before.has(x.id))!.id;
          if (!makeWork) continue;
          for (const c of m.candidates) {
            const p = picks[m.key].candidates[c.key];
            if (!p?.on) continue;
            next = applyCommand(
              next,
              {
                type: "initiative.save",
                data: {
                  projectId,
                  title: trim(p.title.trim() || c.title, 200),
                  problem: c.evidence,
                  targetSegment: "",
                  expectedChange: "",
                  category: categoryOf[c.type],
                  priority: "medium",
                  assignee: "",
                  contribution: "",
                  decisionReason: c.type === "decision" ? c.evidence : "",
                  alternative: "",
                  plannedAt: null,
                  targetMonth: null,
                  status: "draft",
                },
                sourceIds: [sourceId],
              },
              runtime,
            );
          }
        }
        // Several commands, one commit: the stored revision advances by one.
        return { ...next, revision: s.revision + 1 };
      }, state.revision);
      setNotice(
        `원문 ${chosen.length}건${workCount ? `, 과제 초안 ${workCount}건` : ""}을 등록했습니다.`,
      );
      setMessages(null);
      setText("");
      setTitle("");
    } catch (e) {
      // Keep the review so nothing has to be redone.
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel intake" aria-labelledby={`${ids}-h`}>
      <h2 id={`${ids}-h`}>요구사항 수집</h2>
      <p className="subtle">
        붙여넣거나 Gmail·캘린더 파일을 올리면 규칙({EXTRACT_VERSION})으로
        요구사항 후보를 찾습니다. 확인한 것만 원문으로 등록하고, 원하면 과제
        초안도 만듭니다. AI는 쓰지 않으며 원문은 그대로 보존합니다.
      </p>
      <div className="segmented" role="group" aria-label="수집 방법">
        <button
          type="button"
          aria-pressed={mode === "paste"}
          onClick={() => setMode("paste")}
        >
          붙여넣기
        </button>
        <button
          type="button"
          aria-pressed={mode === "file"}
          onClick={() => setMode("file")}
        >
          Gmail·캘린더 파일
        </button>
      </div>
      {mode === "paste" ? (
        <>
          <div className="field-grid">
            <div className="field">
              <label htmlFor={`${ids}-ch`}>어디서 온 내용인가요</label>
              <select
                id={`${ids}-ch`}
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
              >
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${ids}-title`}>원문 제목 (선택)</label>
              <input
                id={`${ids}-title`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor={`${ids}-text`}>붙여넣을 내용</label>
            <textarea
              id={`${ids}-text`}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setMessages(null);
              }}
            />
          </div>
          <div className="actions">
            <button type="button" onClick={fromPaste} disabled={!text.trim()}>
              요구사항 후보 찾기
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="subtle">
            Apps Script 웹앱(나만 접근) 주소 끝에 <code>?inbox=1</code>을 붙여
            열면 받는 pmzip-inbox-export.json을 올립니다. 메일 본문은 이
            브라우저에만 저장됩니다.
          </p>
          <div className="field">
            <label htmlFor={`${ids}-file`}>Gmail·캘린더 내보내기 파일</label>
            <input
              id={`${ids}-file`}
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void fromFile(f);
                // Allow choosing the same file again (e.g. after new mail).
                e.target.value = "";
              }}
            />
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {messages && (
        <div className="intake-review">
          <p role="status">
            {messages.length}건 · 후보{" "}
            {messages.reduce((n, m) => n + m.candidates.length, 0)}개
            {messages.some((m) => m.duplicate)
              ? ` · 이미 수집함에 있음 ${messages.filter((m) => m.duplicate).length}건`
              : ""}
          </p>
          {messages.map((m) => {
            const pick = picks[m.key];
            return (
              <article
                key={m.key}
                className="record-row"
                aria-label={`${m.title} 수집 후보`}
              >
                <label className="check">
                  <input
                    type="checkbox"
                    checked={pick?.source ?? false}
                    disabled={m.duplicate}
                    onChange={(e) =>
                      setPicks({
                        ...picks,
                        [m.key]: { ...pick, source: e.target.checked },
                      })
                    }
                  />
                  <span>
                    <strong>{m.title}</strong>
                    <span className="subtle">
                      {" "}
                      · {m.channelLabel} · {m.collectedAt.slice(0, 10)}
                      {m.requesterRole ? ` · ${m.requesterRole}` : ""}
                      {m.duplicate ? " · 이미 등록됨" : ""}
                    </span>
                  </span>
                </label>
                {m.candidates.length ? (
                  <ul className="intake-candidates">
                    {m.candidates.map((c) => {
                      const cp = pick?.candidates[c.key];
                      return (
                        <li key={c.key}>
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={cp?.on ?? false}
                              disabled={!pick?.source || !makeWork}
                              aria-label={`${c.title} 과제 초안`}
                              onChange={(e) =>
                                setPicks({
                                  ...picks,
                                  [m.key]: {
                                    ...pick,
                                    candidates: {
                                      ...pick.candidates,
                                      [c.key]: { ...cp, on: e.target.checked },
                                    },
                                  },
                                })
                              }
                            />
                            <span className={`intake-type intake-${c.type}`}>
                              {typeNames[c.type]}
                            </span>
                          </label>
                          <input
                            className="intake-title"
                            aria-label="후보 제목"
                            value={cp?.title ?? c.title}
                            disabled={!pick?.source || !makeWork}
                            onChange={(e) =>
                              setPicks({
                                ...picks,
                                [m.key]: {
                                  ...pick,
                                  candidates: {
                                    ...pick.candidates,
                                    [c.key]: { ...cp, title: e.target.value },
                                  },
                                },
                              })
                            }
                          />
                          <span className="subtle">
                            {c.due ? `기한: ${c.due} · ` : ""}근거:{" "}
                            {c.matched.join(", ")}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="subtle">
                    요구사항 후보를 찾지 못했습니다. 필요하면 원문만 등록하세요.
                  </p>
                )}
                <details>
                  <summary>원문 보기</summary>
                  <pre>{trim(m.body, 4000)}</pre>
                </details>
              </article>
            );
          })}
          <label className="check">
            <input
              type="checkbox"
              checked={makeWork}
              onChange={(e) => setMakeWork(e.target.checked)}
            />
            선택한 후보로 과제 초안도 만들기
          </label>
          {makeWork && (
            <div className="field">
              <label htmlFor={`${ids}-proj`}>과제 프로젝트</label>
              <select
                id={`${ids}-proj`}
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="actions">
            <button
              type="button"
              className="primary"
              onClick={save}
              disabled={busy || !chosen.length}
            >
              {busy
                ? "등록 중…"
                : `수집함에 등록 (원문 ${chosen.length}건${makeWork ? ` · 과제 초안 ${workCount}건` : ""})`}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
