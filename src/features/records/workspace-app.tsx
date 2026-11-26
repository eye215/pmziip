"use client";
import Link from "next/link";
import { useState } from "react";
import { projectMonth } from "../../lib/time";
import { MeasurementWorkspace } from "../measurement/workspace";
import { readiness } from "../measurement/model";
import { SourceSplitReview } from "../measurement/source-split";
import { CoachDataPanel } from "../coach-data/panel";
import { DeviceLinkHandler, DeviceLinkPanel } from "../coach-data/device-link";
import { PublicFinancialsPanel } from "../public-financials/panel";
import { MarketSharePanel } from "../market-share/panel";
import { PerformanceView } from "../performance/view";
import { RequirementIntake } from "../intake/panel";
import { CaseStudyView } from "./case-study-view";
import { ReportPanel } from "../report/panel";
import {
  CoachCollectionNote,
  CoachProjectMetrics,
} from "../coach-data/summary";
import {
  useRecords,
  useView,
  changeView,
  saveRecords,
  retryRecords,
  rawBackup,
} from "./browser-store";
import { queryInitiatives, type Command, type WorkQuery } from "./model";
import {
  RecordEditor,
  SourceDetails,
  InitiativeDetails,
  statusNames,
  type Editor,
} from "./editors";

const metrics = {
  coach: ["훈련 완료율", "평균 평가점수"],
  survey: ["분석 성공률", "평균 처리 시간"],
  independent: ["태스크 성공률", "응답 시간"],
};
function download(text: string, name: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function WorkspaceApp() {
  const snapshot = useRecords(),
    search = useView(),
    view = new URLSearchParams(search);
  const [editor, setEditor] = useState<Editor | null>(null),
    [notice, setNotice] = useState("");
  const tab = view.get("tab") || "projects",
    scope = view.get("scope") || "all",
    month = view.get("month") || "2026-11",
    archived = view.get("archived") === "1",
    q = view.get("q") || "";
  const [scopeKind, scopeId] = scope.split(":"),
    role = (view.get("role") || "collected") as WorkQuery["role"];
  const state = snapshot.loaded?.state;
  function navigate(values: Record<string, string>) {
    if (editor && !window.confirm("작성 중인 내용을 저장하지 않고 이동할까요?"))
      return;
    if (
      !window.dispatchEvent(
        new Event("pmzip:before-view", { cancelable: true }),
      )
    )
      return;
    window.dispatchEvent(new Event("pmzip:view-accepted"));
    setEditor(null);
    setNotice("");
    changeView(values);
  }
  function open(kind: Editor["kind"], id?: string, sourceId?: string) {
    if (!state) return;
    if (
      editor &&
      !window.confirm("작성 중인 내용을 저장하지 않고 다른 창을 열까요?")
    )
      return;
    setNotice("");
    setEditor({
      kind,
      id,
      sourceId,
      projectId: scopeKind === "project" ? scopeId : undefined,
      revision: state.revision,
    });
  }
  async function act(command: Command, confirmation?: string) {
    if (!state) return;
    if (confirmation && !window.confirm(confirmation)) return;
    try {
      await saveRecords(command, state.revision);
      setNotice("기록을 저장했습니다.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "저장하지 못했습니다.");
    }
  }
  const inScope = (projectId: string) =>
    scopeKind === "project"
      ? projectId === scopeId
      : scopeKind === "client"
        ? state?.workspace.projects.find((p) => p.id === projectId)
            ?.clientId === scopeId
        : true;
  const projects =
    state?.workspace.projects.filter(
      (p) => inScope(p.id) && (archived || !p.archivedAt),
    ) || [];
  let queryError = "";
  let works: ReturnType<typeof queryInitiatives> = [];
  if (state)
    try {
      works = queryInitiatives(state, {
        projectId: scopeKind === "project" ? scopeId : undefined,
        clientId: scopeKind === "client" ? scopeId : undefined,
        role,
        month: view.get("range") === "1" ? undefined : month,
        fromMonth:
          view.get("range") === "1" ? view.get("from") || undefined : undefined,
        toMonth:
          view.get("range") === "1" ? view.get("to") || undefined : undefined,
        undated: view.get("undated") === "1",
        search: q,
        status: view.get("status") || undefined,
        showArchived: archived,
      });
    } catch (e) {
      queryError =
        e instanceof Error ? e.message : "조회 조건을 확인해 주세요.";
    }
  const sources =
    state?.sources.filter((s) => {
      if (!archived && s.status === "archived") return false;
      if (
        q &&
        !`${s.title}\n${s.rawText}`
          .toLocaleLowerCase()
          .includes(q.toLocaleLowerCase())
      )
        return false;
      if (
        view.get("unclassified") === "1" &&
        state.links.some((l) => l.sourceId === s.id)
      )
        return false;
      if (
        scopeKind !== "all" &&
        !state.links.some(
          (l) =>
            l.sourceId === s.id &&
            inScope(
              state.initiatives.find((w) => w.id === l.initiativeId)!.projectId,
            ),
        )
      )
        return false;
      return projectMonth(s.collectedAt, "Asia/Seoul") === month;
    }) || [];

  return (
    <>
      <a className="skip" href="#main">
        본문으로 이동
      </a>
      <header className="topbar">
        <Link className="brand" href="/">
          PM<span>.zip</span>
        </Link>
        <span className="mode">합성 데이터 · 운영 미연결</span>
      </header>
      <main id="main">
        <div className="intro">
          <p className="eyebrow">PRODUCT IMPACT WORKSPACE</p>
          <h1>제품의 변화, 근거와 함께</h1>
          <p>
            요구사항에서 배포, 그리고 성과 검증까지.
            <br className="mobile-break" /> 프로젝트마다 다른 목표를 이어
            봅니다.
          </p>
        </div>
        {!state ? (
          <section className="panel" aria-live="polite">
            {snapshot.error ? (
              <>
                <p role="alert">{snapshot.error}</p>
                <div className="actions">
                  <button
                    onClick={() => {
                      try {
                        download(rawBackup(), "pmzip-local-recovery.json");
                      } catch {
                        setNotice(
                          "로컬 원본에도 접근할 수 없습니다. 브라우저 저장 권한을 확인해 주세요.",
                        );
                      }
                    }}
                  >
                    로컬 원본 백업
                  </button>
                  <button onClick={retryRecords}>다시 읽기</button>
                </div>
              </>
            ) : (
              <p>이 브라우저의 기록을 불러오는 중…</p>
            )}
            {notice && <p role="status">{notice}</p>}
          </section>
        ) : (
          <>
            <p className="local-note">
              이 브라우저에만 저장하는 합성 모드입니다. 실제 로그인·서버 저장은
              지원하지 않습니다.
            </p>
            {tab !== "perf" && (
              <section className="filters" aria-label="조회 조건">
                <div>
                  <label htmlFor="scope">조회 범위</label>
                  <select
                    id="scope"
                    value={scope}
                    onChange={(e) => navigate({ scope: e.target.value })}
                  >
                    <option value="all">전체 프로젝트</option>
                    {state.workspace.clients.map((c) => (
                      <option key={c.id} value={`client:${c.id}`}>
                        {c.name}
                        {c.archivedAt ? " (보관)" : ""}
                      </option>
                    ))}
                    {state.workspace.projects.map((p) => (
                      <option key={p.id} value={`project:${p.id}`}>
                        {p.name}
                        {p.archivedAt ? " (보관)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="month">조회 월</label>
                  <input
                    id="month"
                    type="month"
                    min="2000-01"
                    max="2100-12"
                    value={month}
                    onChange={(e) => navigate({ month: e.target.value })}
                  />
                </div>
              </section>
            )}
            <nav className="workspace-nav" aria-label="워크스페이스 메뉴">
              {[
                ["projects", "프로젝트"],
                ["perf", "성과"],
                ["inbox", "통합 수집함"],
                ["work", "개선 과제"],
                ["data", "백업·가져오기"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  aria-current={
                    tab === id || (id === "work" && tab === "measurement")
                      ? "page"
                      : undefined
                  }
                  onClick={() => navigate({ tab: id })}
                >
                  {label.includes("·") ? (
                    <>
                      {label.split("·")[0]}·<wbr />
                      {label.split("·")[1]}
                    </>
                  ) : (
                    label
                  )}
                </button>
              ))}
            </nav>
            {tab !== "perf" && (
              <div className="toolbar">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={archived}
                    onChange={(e) =>
                      navigate({ archived: e.target.checked ? "1" : "" })
                    }
                  />
                  보관 기록 포함
                </label>
                {(tab === "inbox" || tab === "work") && (
                  <label className="search-label" htmlFor="record-search">
                    검색
                    <input
                      id="record-search"
                      type="search"
                      value={q}
                      onChange={(e) => navigate({ q: e.target.value })}
                    />
                  </label>
                )}
              </div>
            )}
            {notice && (
              <p className="notice" role="status">
                {notice}
              </p>
            )}
            {editor && (
              <RecordEditor
                key={`${editor.kind}:${editor.id || "new"}:${editor.revision}`}
                state={state}
                editor={editor}
                close={() => {
                  setEditor(null);
                  setNotice("편집창을 닫았습니다. 저장한 기록은 유지됩니다.");
                }}
              />
            )}
            {tab === "projects" && (
              <>
                <section
                  className="overview"
                  aria-labelledby="projects-heading"
                >
                  <div className="section-heading">
                    <div>
                      <h2 id="projects-heading">프로젝트</h2>
                      <p>{month} · 프로젝트 기준</p>
                    </div>
                    <button className="primary" onClick={() => open("project")}>
                      프로젝트 추가
                    </button>
                  </div>
                  <p className="scope-note">
                    프로젝트별 지표는 따로 표시합니다. 서로 다른 KPI를 합산하지
                    않습니다.
                  </p>
                  <div className="projects">
                    {projects.map((project) => (
                      <article
                        className="project"
                        key={project.id}
                        aria-label={`${project.name} 프로젝트`}
                      >
                        <div className="project-head">
                          <span
                            className={`project-symbol ${project.kind}`}
                            aria-hidden="true"
                          >
                            {project.kind === "coach"
                              ? "C"
                              : project.kind === "survey"
                                ? "S"
                                : "I"}
                          </span>
                          <span className="badge">
                            {project.archivedAt ? "보관됨" : "합성 모드"}
                          </span>
                        </div>
                        <h3>{project.name}</h3>
                        <p className="project-context">
                          {state.workspace.clients.find(
                            (c) => c.id === project.clientId,
                          )?.name || "독립 프로젝트"}{" "}
                          · {project.timezone}
                        </p>
                        {project.description && <p>{project.description}</p>}
                        {project.kind === "coach" ? (
                          <CoachProjectMetrics
                            projectId={project.id}
                            labels={metrics.coach}
                          />
                        ) : (
                          <dl className="metrics">
                            {metrics[project.kind].map((metric) => (
                              <div key={metric}>
                                <dt>{metric}</dt>
                                <dd>미수집</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                        <p className="empty-note">
                          과제{" "}
                          {
                            state.initiatives.filter(
                              (w) =>
                                w.projectId === project.id &&
                                w.status !== "archived",
                            ).length
                          }
                          개 ·{" "}
                          {project.kind === "coach" ? (
                            <CoachCollectionNote projectId={project.id} />
                          ) : (
                            "데이터 수집은 아직 연결되지 않았습니다."
                          )}
                        </p>
                        <div className="actions">
                          <button onClick={() => open("project", project.id)}>
                            수정
                          </button>
                          <button
                            onClick={() =>
                              act(
                                {
                                  type: "project.archive",
                                  id: project.id,
                                  archived: !project.archivedAt,
                                },
                                project.archivedAt
                                  ? undefined
                                  : "프로젝트를 보관할까요? 과제와 원문은 삭제하지 않습니다.",
                              )
                            }
                          >
                            {project.archivedAt ? "복원" : "보관"}
                          </button>
                          <button
                            onClick={() =>
                              navigate({
                                tab: "work",
                                scope: `project:${project.id}`,
                              })
                            }
                          >
                            과제 보기
                          </button>
                          <button
                            onClick={() =>
                              navigate({
                                tab: "measurement",
                                scope: `project:${project.id}`,
                                panel: "plans",
                                work: "",
                              })
                            }
                          >
                            지표·전략
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                  {!projects.length && (
                    <p className="empty-state">
                      표시할 프로젝트가 없습니다. 새 프로젝트를 만들거나 보관
                      기록을 확인해 주세요.
                    </p>
                  )}
                </section>
                <section className="panel clients">
                  <div className="section-heading">
                    <h2>고객사</h2>
                    <button onClick={() => open("client")}>고객사 추가</button>
                  </div>
                  {state.workspace.clients
                    .filter((c) => archived || !c.archivedAt)
                    .map((c) => (
                      <article
                        className="record-row"
                        key={c.id}
                        aria-label={`${c.name} 고객사`}
                      >
                        <h3>{c.name}</h3>
                        <p>
                          {c.description || "설명 없음"} · 프로젝트{" "}
                          {
                            state.workspace.projects.filter(
                              (p) => p.clientId === c.id,
                            ).length
                          }
                          개
                        </p>
                        <div className="actions">
                          <button onClick={() => open("client", c.id)}>
                            수정
                          </button>
                          <button
                            onClick={() =>
                              act(
                                {
                                  type: "client.archive",
                                  id: c.id,
                                  archived: !c.archivedAt,
                                },
                                c.archivedAt
                                  ? undefined
                                  : "고객사를 보관할까요? 프로젝트와 기록은 유지됩니다.",
                              )
                            }
                          >
                            {c.archivedAt ? "복원" : "보관"}
                          </button>
                        </div>
                      </article>
                    ))}
                </section>
                <div className="bottom-grid">
                  <section className="panel">
                    <h2>연결 상태</h2>
                    <ul className="connections">
                      <li>GA4 · 미연결</li>
                      <li>Teams · Slack · 메일 · 미연결</li>
                      <li>AI 분석 · 미구현</li>
                    </ul>
                    <p>측정 계획과 배포·리포트는 다음 단계에서 제공됩니다.</p>
                  </section>
                  <section className="panel">
                    <h2>기록을 시작해 보세요</h2>
                    <p>
                      통합 수집함의 원문 하나를 여러 프로젝트의 과제로 나눠
                      연결할 수 있습니다.
                    </p>
                    <button
                      onClick={() => navigate({ tab: "inbox", scope: "all" })}
                    >
                      통합 수집함 열기
                    </button>
                  </section>
                </div>
              </>
            )}
            {tab === "inbox" && <RequirementIntake state={state} />}
            {tab === "inbox" && (
              <section className="panel">
                <div className="section-heading">
                  <h2>통합 수집함</h2>
                  <button className="primary" onClick={() => open("source")}>
                    원문 등록
                  </button>
                </div>
                <p className="scope-note">
                  원문은 워크스페이스에서 한 번만 보관합니다. 현재 조회 월의
                  수집 기록입니다. 미분류 원문은 전체 범위에서 확인해 주세요.
                </p>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={view.get("unclassified") === "1"}
                    onChange={(e) =>
                      navigate({ unclassified: e.target.checked ? "1" : "" })
                    }
                  />
                  연결되지 않은 원문만
                </label>
                {!sources.length && (
                  <p className="empty-state">
                    아직 이 조건에 맞는 원문이 없습니다. 원문을 등록하거나 조회
                    범위·월을 바꿔 주세요.
                  </p>
                )}
                {sources.map((source) => (
                  <article
                    key={source.id}
                    className="record-row"
                    aria-label={`${source.title} 원문`}
                  >
                    <span className="badge">{statusNames[source.status]}</span>
                    <h3>{source.title}</h3>
                    <p>{source.rawText.slice(0, 160)}</p>
                    <SourceDetails source={source} state={state} />
                    {source.status !== "archived" && (
                      <SourceSplitReview state={state} sourceId={source.id} />
                    )}
                    <div className="actions">
                      <button onClick={() => open("source", source.id)}>
                        수정
                      </button>
                      {source.status !== "archived" && (
                        <>
                          <button
                            onClick={() =>
                              open("initiative", undefined, source.id)
                            }
                          >
                            과제로 만들기
                          </button>
                          <button onClick={() => open("link", source.id)}>
                            기존 과제 연결
                          </button>
                          {source.status !== "linked" && (
                            <button
                              onClick={() =>
                                act({
                                  type: "source.status",
                                  id: source.id,
                                  status: "reviewed",
                                })
                              }
                            >
                              검토함으로
                            </button>
                          )}
                        </>
                      )}
                      <button
                        onClick={() =>
                          act(
                            {
                              type: "source.status",
                              id: source.id,
                              status:
                                source.status === "archived"
                                  ? "reviewed"
                                  : "archived",
                            },
                            source.status === "archived"
                              ? undefined
                              : "원문을 보관할까요? 과제 연결과 수정 이력은 유지됩니다.",
                          )
                        }
                      >
                        {source.status === "archived" ? "복원" : "보관"}
                      </button>
                    </div>
                  </article>
                ))}
              </section>
            )}
            {tab === "work" && (
              <section className="panel">
                <div className="section-heading">
                  <h2>개선 과제</h2>
                  <button
                    className="primary"
                    onClick={() => open("initiative")}
                  >
                    과제 추가
                  </button>
                </div>
                <div className="work-filters">
                  <div className="field">
                    <label htmlFor="month-role">월 기준</label>
                    <select
                      id="month-role"
                      value={role}
                      onChange={(e) => navigate({ role: e.target.value })}
                    >
                      <option value="collected">수집월</option>
                      <option value="planned">기획월</option>
                      <option value="target">목표월</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="work-filter-status">상태</label>
                    <select
                      id="work-filter-status"
                      value={view.get("status") || ""}
                      onChange={(e) => navigate({ status: e.target.value })}
                    >
                      <option value="">전체 상태</option>
                      {Object.entries(statusNames)
                        .filter(([id]) =>
                          [
                            "draft",
                            "approved",
                            "planned",
                            "in_progress",
                            "released",
                            "archived",
                            "canceled",
                          ].includes(id),
                        )
                        .map(([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
                <div className="actions">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={view.get("undated") === "1"}
                      onChange={(e) =>
                        navigate({ undated: e.target.checked ? "1" : "" })
                      }
                    />
                    선택한 기준의 날짜 미정만
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={view.get("range") === "1"}
                      onChange={(e) =>
                        navigate({
                          range: e.target.checked ? "1" : "",
                          from: month,
                          to: month,
                        })
                      }
                    />
                    월 범위로 조회
                  </label>
                </div>
                {view.get("range") === "1" && (
                  <div className="field-grid">
                    <label className="field" htmlFor="month-from">
                      시작 월
                      <input
                        id="month-from"
                        type="month"
                        value={view.get("from") || ""}
                        onChange={(e) => navigate({ from: e.target.value })}
                      />
                    </label>
                    <label className="field" htmlFor="month-to">
                      종료 월
                      <input
                        id="month-to"
                        type="month"
                        value={view.get("to") || ""}
                        onChange={(e) => navigate({ to: e.target.value })}
                      />
                    </label>
                  </div>
                )}
                <p className="scope-note">
                  배포월·관측월 기준은 실제 배포와 관측 기능 구현 후 제공됩니다.
                  과제는 ID별 한 번만 셉니다.
                </p>
                {queryError && (
                  <p role="alert" className="error-box">
                    {queryError}
                  </p>
                )}
                <p className="count" role="status">
                  과제 {works.length}개
                </p>
                {!works.length && !queryError && (
                  <p className="empty-state">
                    조건에 맞는 과제가 없습니다. 날짜 미정 또는 다른 월 기준도
                    확인해 주세요.
                  </p>
                )}
                {works.map((work) => (
                  <article
                    className="record-row"
                    key={work.id}
                    aria-label={`${work.title} 과제`}
                  >
                    <span className="badge">
                      {statusNames[work.status]} ·{" "}
                      {
                        state.workspace.projects.find(
                          (p) => p.id === work.projectId,
                        )?.name
                      }
                    </span>
                    <h3>{work.title}</h3>
                    <p>{work.problem || "문제 미정"}</p>
                    <CaseStudyView work={work} state={state} />
                    <InitiativeDetails work={work} state={state} />
                    {!work.mergedInto && (
                      <div className="actions">
                        <button onClick={() => open("initiative", work.id)}>
                          수정
                        </button>
                        {work.status !== "archived" && (
                          <button onClick={() => open("merge", work.id)}>
                            중복 검토·병합
                          </button>
                        )}
                        <button
                          onClick={() =>
                            navigate({
                              tab: "measurement",
                              scope: `project:${work.projectId}`,
                              panel: "plans",
                              work: work.id,
                            })
                          }
                        >
                          측정 계획
                        </button>
                        <span className="subtle">
                          측정 준비:{" "}
                          {
                            {
                              not_ready: "미준비",
                              partial: "일부 누락",
                              ready: "확인됨",
                              waived: "예외 사유 있음",
                            }[readiness(state, work.id).status]
                          }
                        </span>
                        {work.status === "archived" && (
                          <p className="subtle">
                            수정에서 업무 상태를 바꾸면 복원됩니다.
                          </p>
                        )}
                      </div>
                    )}
                  </article>
                ))}
              </section>
            )}
            {tab === "measurement" && (
              <MeasurementWorkspace
                state={state}
                projectId={scopeKind === "project" ? scopeId : undefined}
                month={month}
                panel={view.get("panel") || "plans"}
                workId={view.get("work") || undefined}
                navigate={navigate}
              />
            )}
            {tab === "data" && (
              <section className="panel">
                <h2>백업·가져오기</h2>
                <p>
                  현재 브라우저 기록 전체를 JSON으로 백업합니다. 새 버전 백업의
                  복원 기능은 후속 단계이며, 현재는 이전 로컬 프로토타입의 배열
                  JSON을 미리 보고 추가로 가져올 수 있습니다.
                </p>
                <div className="actions">
                  <button
                    className="primary"
                    onClick={() => {
                      try {
                        download(
                          JSON.stringify(state, null, 2),
                          "pmzip-synthetic-backup.json",
                        );
                      } catch {
                        setNotice("백업 파일을 만들지 못했습니다.");
                      }
                    }}
                  >
                    현재 기록 백업
                  </button>
                  <button onClick={() => open("import")}>
                    이전 버전 가져오기
                  </button>
                </div>
                <details>
                  <summary>이전 ID → 새 과제 ID</summary>
                  <ul>
                    {state.legacy.map((row) => (
                      <li key={row.originKey}>
                        {String(row.original.project)} ·{" "}
                        {String(row.original.id)} → {row.initiativeId}
                      </li>
                    ))}
                  </ul>
                </details>
                <details>
                  <summary>전체 변경 이력</summary>
                  {state.audit.map((a) => (
                    <p key={a.id}>
                      {a.at} · {a.action} · {a.entityId} · {a.detail}
                    </p>
                  ))}
                </details>
              </section>
            )}
            <DeviceLinkHandler projects={state.workspace.projects} />
            {tab === "data" && <DeviceLinkPanel />}
            {tab === "data" && (
              <CoachDataPanel projects={state.workspace.projects} />
            )}
            {tab === "data" && <PublicFinancialsPanel />}
            {tab === "perf" && <ReportPanel state={state} />}
            {tab === "perf" && (
              <PerformanceView projects={state.workspace.projects} />
            )}
            {tab === "data" && <MarketSharePanel />}
            <footer>
              합성 로컬 워크스페이스 · 실제 로그인·운영 DB·외부 수집 미연결 ·
              중요한 입력 전후로 백업해 주세요.
            </footer>
          </>
        )}
      </main>
    </>
  );
}
