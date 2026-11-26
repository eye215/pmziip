"use client";

import { useState } from "react";
import Link from "next/link";
import { demoWorkspace, listProjects } from "@/lib/demo";
import type { Project } from "@/lib/schema";

const metrics: Record<Project["kind"], string[]> = {
  coach: ["훈련 완료율", "평균 평가점수"],
  survey: ["분석 성공률", "평균 처리 시간"],
  independent: ["태스크 성공률", "응답 시간"],
};

export function WorkspacePreview() {
  const [scope, setScope] = useState("all");
  const [month, setMonth] = useState("2026-11");
  const [kind, id] = scope.split(":");
  const projects = listProjects(demoWorkspace, kind === "project" ? { projectId: id } : kind === "client" ? { clientId: id } : {});

  return <>
    <a className="skip" href="#main">본문으로 이동</a>
    <header className="topbar"><Link className="brand" href="/">PM<span>.zip</span></Link><span className="mode">합성 데이터 · 운영 미연결</span></header>
    <main id="main">
      <div className="intro"><p className="eyebrow">PRODUCT IMPACT WORKSPACE</p><h1>제품의 변화, 근거와 함께</h1><p>요구사항에서 배포, 그리고 성과 검증까지.<br className="mobile-break" /> 프로젝트마다 다른 목표를 이어 봅니다.</p></div>
      <section className="filters" aria-label="조회 조건">
        <div><label htmlFor="scope">조회 범위</label><select id="scope" value={scope} onChange={e => setScope(e.target.value)}>
          <option value="all">전체 프로젝트</option>
          {demoWorkspace.clients.map(c => <option key={c.id} value={`client:${c.id}`}>{c.name}</option>)}
          {demoWorkspace.projects.map(p => <option key={p.id} value={`project:${p.id}`}>{p.name}</option>)}
        </select></div>
        <div><label htmlFor="month">조회 월</label><input id="month" type="month" min="2000-01" max="2100-12" value={month} onChange={e => setMonth(e.target.value)} /></div>
      </section>
      <section className="overview" aria-labelledby="projects-heading">
        <div className="section-heading"><div><h2 id="projects-heading">프로젝트</h2><p>{month || "월 미선택"} · 프로젝트 기준</p></div><span className="count">{projects.length}개</span></div>
        <p className="scope-note">프로젝트별 지표는 따로 표시합니다. 서로 다른 KPI를 합산하지 않습니다.</p>
        <div className="projects">{projects.map(project => <article className="project" key={project.id}>
          <div className="project-head"><span className={`project-symbol ${project.kind}`} aria-hidden="true">{project.kind === "coach" ? "C" : project.kind === "survey" ? "S" : "I"}</span><span className="badge">합성 예시</span></div>
          <h3>{project.name}</h3><p className="project-context">{project.clientId ? "Demo Client" : "독립 프로젝트"} · {project.timezone}</p>
          <dl className="metrics">{metrics[project.kind].map(metric => <div key={metric}><dt>{metric}</dt><dd>미수집</dd></div>)}</dl>
          <p className="empty-note">아직 수집된 데이터가 없어요.<br />지표 등록과 데이터 입력은 후속 단계에서 제공됩니다.</p>
        </article>)}</div>
      </section>
      <div className="bottom-grid"><section className="panel" aria-labelledby="progress-heading"><p className="eyebrow">DEVELOPMENT</p><h2 id="progress-heading">기반부터 차근차근</h2><p>현재는 Phase 0 개발용 화면입니다. 프로젝트 관리, 측정 계획과 보고서는 아직 구현 전입니다.</p><ol><li><strong>지금</strong> 실행 환경 · 합성 데이터 · 자동 검사</li><li><strong>다음</strong> 고객사 · 프로젝트 · 통합 수집함</li><li><strong>이후</strong> 측정 · 배포 · 성과 리포트</li></ol></section>
      <section className="panel" aria-labelledby="connections-heading"><p className="eyebrow">CONNECTIONS</p><h2 id="connections-heading">연결 상태</h2><ul className="connections"><li><span>GA4 · 미연결</span><span className="dot" /></li><li><span>Teams · Slack · 메일</span><span className="subtle">미연결</span></li><li><span>AI 분석</span><span className="subtle">미구현</span></li></ul><p>실제 인증·데이터 수집·자동 발송은 실행되지 않습니다.</p></section></div>
      <footer>개발용 합성 워크스페이스 · 실제 고객사 데이터 및 성과가 아닙니다.</footer>
    </main>
  </>;
}
