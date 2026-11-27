import type { CoachDbConfig, CoachSession, Issue } from "./normalize";

/**
 * Metrics from unique sessions/users of the rows given. Rates are totals
 * (completed / entries over the whole group), never averages of groups;
 * a zero denominator gives null (N/A), never 0.
 */
export type Metrics = {
  entry_users: number;
  completed_users: number;
  entries: number;
  completions: number;
  incomplete: number;
  session_completion_rate: number | null;
  user_completion_rate: number | null;
  avg_entries_per_user: number | null;
  avg_completions_per_user: number | null;
};
const ratio = (n: number, d: number, scale = 1) =>
  d === 0 ? null : Math.round((n / d) * scale * 100) / 100;

export function metrics(rows: CoachSession[]): Metrics {
  const sessions = new Set<string>();
  const done = new Set<string>();
  const users = new Set<string>();
  const doneUsers = new Set<string>();
  for (const r of rows) {
    const s = `${r.version}|${r.session_id}`;
    sessions.add(s);
    if (r.is_completed) done.add(s);
    if (r.user_id) {
      users.add(r.user_id);
      if (r.is_completed) doneUsers.add(r.user_id);
    }
  }
  const entries = sessions.size;
  const completions = done.size;
  return {
    entry_users: users.size,
    completed_users: doneUsers.size,
    entries,
    completions,
    incomplete: entries - completions,
    session_completion_rate: ratio(completions, entries, 100),
    user_completion_rate: ratio(doneUsers.size, users.size, 100),
    avg_entries_per_user: ratio(entries, users.size),
    avg_completions_per_user: ratio(completions, users.size),
  };
}

function group<K extends string>(
  rows: CoachSession[],
  key: (r: CoachSession) => Record<K, string>,
) {
  const m = new Map<string, { key: Record<K, string>; rows: CoachSession[] }>();
  for (const r of rows) {
    const k = key(r);
    const id = JSON.stringify(k);
    const g = m.get(id) ?? { key: k, rows: [] };
    g.rows.push(r);
    m.set(id, g);
  }
  return [...m.values()]
    .sort((a, b) => JSON.stringify(a.key).localeCompare(JSON.stringify(b.key)))
    .map((g) => ({ ...g.key, ...metrics(g.rows) }));
}

export const globalMonthly = (rows: CoachSession[]) =>
  group(rows, (r) => ({ year_month: r.year_month }));
export const countryMonthly = (rows: CoachSession[]) =>
  group(rows, (r) => ({
    year_month: r.year_month,
    country_code: r.country_code,
  }));
export const versionMonthly = (rows: CoachSession[]) =>
  group(rows, (r) => ({ year_month: r.year_month, version: r.version }));

export type QualityRow = {
  check: string;
  collection: string;
  count: number;
  detail: string;
  samples: string;
};

/** Per-check counts with up to 10 sample record ids, plus coverage facts. */
export function qualityReport(
  sessions: CoachSession[],
  counted: CoachSession[],
  issues: Issue[],
  cfg: CoachDbConfig,
): QualityRow[] {
  const out: QualityRow[] = [];
  const span = (v: "V1" | "V2") => {
    const t = sessions
      .filter((r) => r.version === v)
      .map((r) => r.started_at)
      .sort();
    return t.length ? { first: t[0], last: t.at(-1)!, n: t.length } : null;
  };
  for (const v of ["V1", "V2"] as const) {
    const s = span(v);
    out.push({
      check: `${v} 최초·최종 생성 일시`,
      collection: v === "V1" ? "voice_sessions" : "sales_infos",
      count: s?.n ?? 0,
      detail: s ? `${s.first} ~ ${s.last}` : "데이터 없음",
      samples: "",
    });
  }
  const v1 = span("V1");
  const v2 = span("V2");
  out.push({
    check: "V1·V2 기간 중첩",
    collection: "-",
    count:
      v1 && v2 && v1.last >= v2.first
        ? sessions.filter(
            (r) => r.started_at >= v2.first && r.started_at <= v1.last,
          ).length
        : 0,
    detail:
      v1 && v2
        ? v1.last >= v2.first
          ? `겹침 ${v2.first} ~ ${v1.last} (8월 1일 고정 전환이 아님 — 두 버전 모두 집계)`
          : `겹치지 않음 (V1 마지막 ${v1.last}, V2 처음 ${v2.first})`
        : "한쪽 버전 데이터 없음",
    samples: "",
  });
  const byCheck = new Map<string, Issue[]>();
  for (const i of issues) {
    const k = `${i.check}|${i.collection}`;
    byCheck.set(k, [...(byCheck.get(k) ?? []), i]);
  }
  for (const [, list] of [...byCheck].sort(([a], [b]) => a.localeCompare(b)))
    out.push({
      check: list[0].check,
      collection: list[0].collection,
      count: list.length,
      detail: list[0].detail,
      samples: list
        .map((i) => i.recordId)
        .filter(Boolean)
        .slice(0, 10)
        .join(" "),
    });
  const deleted = sessions.filter((r) => r.deleted_at).length;
  out.push({
    check: "삭제된 데이터",
    collection: "-",
    count: deleted,
    detail: cfg.includeDeleted ? "집계에 포함" : "집계에서 제외",
    samples: "",
  });
  const channels = new Map<string, number>();
  for (const r of sessions)
    channels.set(
      r.channel_id ?? "(없음)",
      (channels.get(r.channel_id ?? "(없음)") ?? 0) + 1,
    );
  out.push({
    check: "채널 분포(운영·테스트 구분)",
    collection: "-",
    count: channels.size,
    detail: [...channels]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(
        ([c, n]) =>
          `${c}${cfg.testChannels.includes(c) ? "(테스트)" : ""} ${n}`,
      )
      .join(", "),
    samples: "",
  });
  out.push({
    check: "집계 대상",
    collection: "-",
    count: counted.length,
    detail: `전체 세션 ${sessions.length} 중 ${counted.length} (설정: 시간대 ${cfg.timeZone}, 포함 채널 ${cfg.includeChannels.join(" ") || "전체"}, 테스트 채널 ${cfg.testChannels.join(" ") || "없음"})`,
    samples: "",
  });
  return out;
}
