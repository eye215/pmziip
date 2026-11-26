"use client";

import { useEffect, useState } from "react";
import { session } from "./browser-store";
import { coachSourceKey, coachSourceSchema } from "../coach-data/store";
import { finSourceKey, finSourceSchema } from "../public-financials/store";
import { marketSourceKey, marketSourceSchema } from "../market-share/store";

type Row = { name: string; state: "ok" | "warn" | "off"; text: string };
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
function row(name: string, src: Src): Row {
  if (!src) return { name, state: "off", text: "연결 안 됨" };
  if (src.lastOk === false)
    return { name, state: "warn", text: "마지막 동기화 실패 · 아래에서 확인" };
  return {
    name,
    state: "ok",
    text: src.lastSyncAt ? `연결됨 · ${when(src.lastSyncAt)}` : "연결됨",
  };
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
    row(
      "Galaxy Coach GA",
      read(coachSourceKey(session), safe<Src>(coachSourceSchema)),
    ),
    row("공시 실적", read(finSourceKey(session), safe<Src>(finSourceSchema))),
    row(
      "국가별 점유율",
      read(marketSourceKey(session), safe<Src>(marketSourceSchema)),
    ),
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
      <ul>
        {rows.map((r) => (
          <li key={r.name}>
            <span className={`conn-dot conn-${r.state}`} aria-hidden="true" />
            <strong>{r.name}</strong>
            <span className="subtle">{r.text}</span>
          </li>
        ))}
      </ul>
      <p className="subtle">
        연결 정보는 이 브라우저에만 저장됩니다. 다른 기기는 아래 ‘다른 기기에서
        보기’ 링크로 연결합니다.
      </p>
    </section>
  );
}
