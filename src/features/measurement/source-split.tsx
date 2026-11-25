"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  applyCommand,
  authorize,
  recordAudit,
  stateSchema,
  type RecordsState,
  type Runtime,
} from "../records/model";
import { saveRecords, runtime } from "../records/browser-store";
import { Field, Select, errorMessage } from "./forms";

const choices = z
  .array(
    z
      .object({
        title: z
          .string()
          .max(200)
          .refine((v) => !!v.trim()),
        projectId: z.uuid(),
      })
      .strict(),
  )
  .min(1)
  .max(5);
export function splitSource(s: RecordsState, sourceId: string) {
  const source = s.sources.find((x) => x.id === sourceId);
  if (!source || source.status === "archived")
    throw new Error("활성 원문을 선택해 주세요.");
  return source.rawText
    .split(/\n+/)
    .map((line) => line.trim().replace(/^(?:[-*•]|\d+[.)])\s*/, ""))
    .filter(Boolean)
    .slice(0, 5)
    .map((title) => ({ title: title.slice(0, 180), projectId: "" }));
}
export function saveSplit(
  input: RecordsState,
  sourceId: string,
  raw: unknown,
  r: Runtime,
) {
  authorize(input, r.session);
  splitSource(input, sourceId);
  const selected = choices.parse(raw),
    keys = selected.map((x) => JSON.stringify([x.projectId, x.title]));
  if (new Set(keys).size !== keys.length)
    throw new Error("선택한 초안끼리 제목이 중복됩니다.");
  if (
    selected.some((item) =>
      input.initiatives.some(
        (w) =>
          w.projectId === item.projectId &&
          w.title === item.title &&
          w.status !== "archived",
      ),
    )
  )
    throw new Error(
      "같은 제목의 기존 과제가 있습니다. 기존 과제 연결 또는 수동 검토를 사용해 주세요.",
    );
  let s = structuredClone(input);
  for (const item of selected)
    s = applyCommand(
      s,
      {
        type: "initiative.save",
        sourceIds: [sourceId],
        data: {
          ...item,
          problem: "",
          targetSegment: "",
          expectedChange: "",
          category: "improvement",
          priority: "medium",
          assignee: "",
          contribution: "",
          decisionReason: "원문 행 기반 분리 초안 사용자 확인",
          alternative: "",
          plannedAt: null,
          targetMonth: null,
          status: "draft",
        },
      },
      r,
    );
  recordAudit(
    s,
    r,
    "source.split",
    sourceId,
    null,
    `사용자 확인 후 ${selected.length}개 과제 초안`,
  );
  s.revision = input.revision + 1;
  return stateSchema.parse(s);
}
export function SourceSplitReview({
  state,
  sourceId,
}: {
  state: RecordsState;
  sourceId: string;
}) {
  const [show, setShow] = useState(false),
    [drafts, setDrafts] = useState<
      { title: string; projectId: string; selected: boolean }[]
    >([]),
    [revision, setRevision] = useState(0),
    [approved, setApproved] = useState(false),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    function guard(event: Event) {
      if (show && !confirm("분리 초안을 등록하지 않고 이동할까요?"))
        event.preventDefault();
    }
    function accepted() {
      setShow(false);
    }
    window.addEventListener("pmzip:before-view", guard);
    window.addEventListener("pmzip:view-accepted", accepted);
    return () => {
      window.removeEventListener("pmzip:before-view", guard);
      window.removeEventListener("pmzip:view-accepted", accepted);
    };
  }, [show]);
  async function commit() {
    setBusy(true);
    try {
      if (!approved)
        throw new Error("초안·프로젝트·원문 연결을 먼저 확인해 주세요.");
      await saveRecords(
        (s) =>
          saveSplit(
            s,
            sourceId,
            drafts
              .filter((x) => x.selected)
              .map(({ title, projectId }) => ({ title, projectId })),
            runtime,
          ),
        revision,
      );
      setShow(false);
      setNotice("원문을 복사하지 않고 과제 초안을 연결했습니다.");
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="measurement-split">
      {!show ? (
        <button
          type="button"
          onClick={() => {
            try {
              setDrafts(
                splitSource(state, sourceId).map((x) => ({
                  ...x,
                  selected: true,
                })),
              );
              setRevision(state.revision);
              setApproved(false);
              setNotice("");
              setShow(true);
            } catch (e) {
              setNotice(errorMessage(e));
            }
          }}
        >
          분리 초안 검토
        </button>
      ) : (
        <fieldset disabled={busy}>
          <legend>규칙 기반 분리 초안 · 미확정</legend>
          <p className="subtle">
            원문 앞 5개 행을 후보로 보여 줍니다. 실제 AI 분석이 아니며, 명령을
            실행하거나 프로젝트를 자동 확정하지 않습니다. 원문 전체는
            보존됩니다.
          </p>
          {drafts.map((item, i) => (
            <div key={i}>
              <label className="measurement-check">
                <input
                  type="checkbox"
                  checked={item.selected}
                  onChange={(e) =>
                    setDrafts(
                      drafts.map((x, j) =>
                        i === j ? { ...x, selected: e.target.checked } : x,
                      ),
                    )
                  }
                />
                초안 {i + 1} 등록
              </label>
              <Field
                name={`split-${sourceId}-${i}-title`}
                label={`분리 초안 ${i + 1} 제목`}
                value={item.title}
                onChange={(title) =>
                  setDrafts(
                    drafts.map((x, j) => (i === j ? { ...x, title } : x)),
                  )
                }
              />
              <Select
                name={`split-${sourceId}-${i}-project`}
                label={`분리 초안 ${i + 1} 프로젝트`}
                value={item.projectId}
                onChange={(projectId) =>
                  setDrafts(
                    drafts.map((x, j) => (i === j ? { ...x, projectId } : x)),
                  )
                }
              >
                <option value="">직접 선택해 주세요</option>
                {state.workspace.projects
                  .filter((p) => !p.archivedAt)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
            </div>
          ))}
          <label className="measurement-check">
            <input
              type="checkbox"
              checked={approved}
              onChange={(e) => setApproved(e.target.checked)}
            />
            선택한 초안과 프로젝트 연결을 확인했습니다
          </label>
          <div className="measurement-actions">
            <button type="button" onClick={commit}>
              선택 초안 등록
            </button>
            <button type="button" onClick={() => setShow(false)}>
              분리 검토 취소
            </button>
          </div>
        </fieldset>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
