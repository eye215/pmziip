"use client";

import { useEffect, useState } from "react";
import { session } from "./browser-store";
import { coachSourceKey, coachSourceSchema } from "../coach-data/store";
import { finSourceKey, finSourceSchema } from "../public-financials/store";
import { marketSourceKey, marketSourceSchema } from "../market-share/store";
import { currentSegments, loadSegments } from "../segment-fin/store";
import { loadSyncConfig } from "../sync/client";

type Row = {
  name: string;
  state: "ok" | "warn" | "off" | "info";
  text: string;
  href: string;
  icon: string;
};
type Src = { lastSyncAt: string | null; lastOk: boolean | null } | null;

function read<T>(key: string, parse: (v: unknown) => T | null): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : parse(JSON.parse(raw));
  } catch {
    return null;
  }
}
const when = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
function row(name: string, src: Src, href: string, icon: string): Row {
  const base = { name, href, icon };
  if (!src) return { ...base, state: "off", text: "연결 안 됨" };
  if (src.lastOk === false)
    return { ...base, state: "warn", text: "마지막 동기화 실패 · 눌러서 확인" };
  return {
    ...base,
    state: "ok",
    text: src.lastSyncAt ? `연결됨 · ${when(src.lastSyncAt)}` : "연결됨",
  };
}
function syncRow(): Row {
  const base = { name: "기기 간 기록 동기화", href: "#set-sync", icon: "동기" };
  const c = loadSyncConfig(window.localStorage, session);
  if (!c) return { ...base, state: "off", text: "꺼짐 · 이 기기에만 저장" };
  if (c.lastOk === false)
    return { ...base, state: "warn", text: "마지막 동기화 실패 · 눌러서 확인" };
  return {
    ...base,
    state: "ok",
    text: c.lastSyncAt ? `동기화됨 · ${when(c.lastSyncAt)}` : "연결됨",
  };
}
function segmentRow(): Row {
  const base = { name: "공개 부문 실적", href: "#set-seg", icon: "MX" };
  try {
    const rows = currentSegments(
      loadSegments(window.localStorage, session).state,
    );
    if (!rows.length) return { ...base, state: "off", text: "입력 없음" };
    const last = rows.reduce((a, b) =>
      a.year * 10 + a.quarter >= b.year * 10 + b.quarter ? a : b,
    );
    return {
      ...base,
      state: "ok",
      text: `${rows.length}개 분기 · 최근 ${last.year}-Q${last.quarter}`,
    };
  } catch {
    return { ...base, state: "warn", text: "기록을 읽지 못함 · 눌러서 확인" };
  }
}
function readRows(): Row[] {
  const safe =
    <T,>(schema: {
      safeParse: (v: unknown) => { success: boolean; data?: T };
    }) =>
    (v: unknown) => {
      const r = schema.safeParse(v);
      return r.success ? (r.data as T) : null;
    };
  return [
    syncRow(),
    row(
      "Galaxy Coach GA",
      read(coachSourceKey(session), safe<Src>(coachSourceSchema)),
      "#set-coach",
      "GA",
    ),
    row(
      "공시 실적",
      read(finSourceKey(session), safe<Src>(finSourceSchema)),
      "#set-fin",
      "공시",
    ),
    segmentRow(),
    row(
      "국가별 점유율",
      read(marketSourceKey(session), safe<Src>(marketSourceSchema)),
      "#set-market",
      "점유",
    ),
    {
      name: "다른 기기에서 보기",
      state: "info",
      text: "시트 연결만 링크로 옮깁니다",
      href: "#set-device",
      icon: "링크",
    },
    {
      name: "기록 백업",
      state: "info",
      text: "내보내기·가져오기",
      href: "#set-backup",
      icon: "백업",
    },
  ];
}

/** Settings overview: each data connection's state as a colored dot. */
export function ConnectionStatus() {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    const refresh = () => setRows(readRows());
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("pmzip:view", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("pmzip:view", refresh);
    };
  }, []);
  return (
    <section className="panel conn-status" aria-labelledby="conn-status-h">
      <h2 id="conn-status-h">연결 상태</h2>
      <ul className="set-rows">
        {rows.map((r) => (
          <li key={r.name}>
            <a href={r.href} className={`set-row set-${r.state}`}>
              <span className="set-icon" aria-hidden="true">
                {r.icon}
              </span>
              <span className="set-text">
                <strong>{r.name}</strong>
                <span className="set-state">
                  {r.state !== "info" && (
                    <span
                      className={`conn-dot conn-${r.state}`}
                      aria-hidden="true"
                    />
                  )}
                  {r.text}
                </span>
              </span>
              <span className="set-go" aria-hidden="true">
                ›
              </span>
            </a>
          </li>
        ))}
      </ul>
      <p className="subtle">
        연결 정보는 이 브라우저에만 저장됩니다. 다른 기기는 ‘다른 기기에서 보기’
        링크로 연결합니다.
      </p>
    </section>
  );
}
