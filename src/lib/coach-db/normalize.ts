import { at, dateOf, first, idOf, numOf, strOf } from "./ejson";

/**
 * Galaxy Coach DB sessions (MongoDB export) → one row per session.
 * V1 (Stage): entry = voice_sessions._id; completed when a stage of
 * stage_infos with that session has step "completed".
 * V2 (Sales): entry = state.sales_info.session; completed when status is
 * "completed" (goal_complete is NOT used). Country is never guessed:
 * unknown → "UNKNOWN". Deterministic for the same input.
 */
export const COACH_DB_VERSION = "coach-db-1.0";
type Doc = Record<string, unknown>;

export type CoachDbConfig = {
  /** IANA zone for year_month; default UTC. */
  timeZone: string;
  /** Channels to count; empty = all. */
  includeChannels: string[];
  /** Test channels, never counted. */
  testChannels: string[];
  /** Count soft-deleted rows (deleted_at set); default false. */
  includeDeleted: boolean;
};
export const defaultCoachDbConfig: CoachDbConfig = {
  timeZone: "UTC",
  includeChannels: [],
  testChannels: [],
  includeDeleted: false,
};

export type CoachSession = {
  session_id: string;
  simulation_id: string | null;
  user_id: string | null;
  splus_uuid: string | null;
  country_code: string;
  version: "V1" | "V2";
  simulation_type: string | null;
  stage_no: number | null;
  sales_case: string | null;
  sales_type: string | null;
  scenario_id: string | null;
  target_product: string | null;
  channel_id: string | null;
  started_at: string;
  updated_at: string | null;
  year_month: string;
  is_completed: boolean;
  completion_status: string;
  score: number | null;
  deleted_at: string | null;
  source_collection: "voice_sessions" | "sales_infos";
};

export type Issue = {
  check: string;
  collection: string;
  recordId: string | null;
  detail: string;
};

export type Inputs = {
  voiceSessions: Doc[];
  stageInfos: Doc[];
  salesInfos: Doc[];
  users: Doc[];
};

export function yearMonth(iso: string, timeZone: string) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(iso));
  return `${p.find((x) => x.type === "year")!.value}-${p.find((x) => x.type === "month")!.value}`;
}

const country = (v: unknown) => {
  const s = strOf(v)?.toUpperCase() ?? null;
  return s && /^[A-Z]{2,3}$/.test(s) ? s : null;
};
const DELETED = ["deletedAt", "deleted_at", "state.deletedAt"];
const CHANNEL = [
  "channelId",
  "channel_id",
  "channel",
  "state.channelId",
  "state.channel",
];
const SPLUS = [
  "splusUuid",
  "splus_uuid",
  "personalData.splusUuid",
  "personalData.splus_uuid",
];

type UserInfo = { country: string | null; splus: string | null };
function userIndex(users: Doc[], issues: Issue[]) {
  const map = new Map<string, UserInfo>();
  for (const u of users) {
    const id = idOf(u._id);
    if (!id) {
      issues.push({
        check: "사용자 ID 누락",
        collection: "users",
        recordId: null,
        detail: "_id 없음",
      });
      continue;
    }
    map.set(id, {
      country: country(at(u, "personalData.countryCode")),
      splus: strOf(first(u, SPLUS)),
    });
  }
  return map;
}

/** Stage entries of one stage_infos doc: stage1..3, object or array. */
function stagesOf(doc: Doc) {
  const out: { stageNo: number; entry: Doc }[] = [];
  for (const n of [1, 2, 3]) {
    const v = at(doc, `state.stage_info.stage${n}`);
    const list = Array.isArray(v) ? v : v && typeof v === "object" ? [v] : [];
    for (const e of list)
      if (e && typeof e === "object") out.push({ stageNo: n, entry: e as Doc });
  }
  return out;
}

export function normalizeV1(inp: Inputs, cfg: CoachDbConfig, issues: Issue[]) {
  const users = userIndex(inp.users, issues);
  // session id → stage entries (sorted for determinism)
  const stageBySession = new Map<
    string,
    { stageNo: number; entry: Doc; doc: Doc }[]
  >();
  for (const doc of inp.stageInfos)
    for (const s of stagesOf(doc)) {
      const sid = idOf(s.entry.session);
      if (!sid) continue;
      const list = stageBySession.get(sid) ?? [];
      list.push({ ...s, doc });
      stageBySession.set(sid, list);
    }
  const rows: CoachSession[] = [];
  for (const v of inp.voiceSessions) {
    const sid = idOf(v._id);
    const started = dateOf(v.createdAt);
    if (!sid || !started) {
      issues.push({
        check: "V1 레코드 오류",
        collection: "voice_sessions",
        recordId: sid,
        detail: !sid ? "_id 없음" : "createdAt 없음/잘못됨",
      });
      continue;
    }
    const userId = idOf(first(v, ["user", "userId", "user_id", "state.user"]));
    const stages = stageBySession.get(sid) ?? [];
    if (!stages.length)
      issues.push({
        check: "Stage Info 매핑 실패",
        collection: "voice_sessions",
        recordId: sid,
        detail: "stage_infos의 stage1~3 session에 없음 → 잠정 미완료",
      });
    const done = stages.find((s) => strOf(s.entry.step) === "completed");
    const st = done ?? stages[0];
    let cc = country(at(v, "state.countryCode"));
    if (!cc && userId) cc = users.get(userId)?.country ?? null;
    if (!cc)
      issues.push({
        check: "국가 코드 누락",
        collection: "voice_sessions",
        recordId: sid,
        detail: "UNKNOWN으로 분류",
      });
    if (userId && !users.has(userId))
      issues.push({
        check: "사용자 ID 매핑 실패",
        collection: "voice_sessions",
        recordId: sid,
        detail: `user ${userId}`,
      });
    rows.push({
      session_id: sid,
      simulation_id: strOf(
        first(v, ["simulationId", "simulation_id", "state.simulationId"]),
      ),
      user_id: userId,
      splus_uuid: userId ? (users.get(userId)?.splus ?? null) : null,
      country_code: cc ?? "UNKNOWN",
      version: "V1",
      simulation_type: strOf(
        first(v, [
          "simulationType",
          "simulation_type",
          "state.simulationType",
          "type",
        ]),
      ),
      stage_no: st ? st.stageNo : numOf(first(v, ["stage", "state.stage"])),
      sales_case: null,
      sales_type: null,
      scenario_id: strOf(
        first(v, ["scenarioId", "scenario_id", "state.scenarioId"]),
      ),
      target_product: strOf(
        first(v, ["targetProduct", "target_product", "state.targetProduct"]),
      ),
      channel_id: strOf(first(v, CHANNEL)),
      started_at: started,
      updated_at: dateOf(v.updatedAt),
      year_month: yearMonth(started, cfg.timeZone),
      is_completed: !!done,
      completion_status: done
        ? "completed"
        : stages.length
          ? (strOf(st!.entry.step) ?? "incomplete")
          : "unmapped",
      score: st
        ? numOf(first(st.entry, ["score", "totalScore", "result.score"]))
        : null,
      deleted_at: dateOf(first(v, DELETED)),
      source_collection: "voice_sessions",
    });
  }
  return rows;
}

/** sales_info: object or array of session objects. */
function salesEntries(doc: Doc): Doc[] {
  const v = at(doc, "state.sales_info");
  if (Array.isArray(v))
    return v.filter((x) => x && typeof x === "object") as Doc[];
  return v && typeof v === "object" ? [v as Doc] : [];
}

export function normalizeV2(inp: Inputs, cfg: CoachDbConfig, issues: Issue[]) {
  const users = userIndex(inp.users, issues);
  const rows: CoachSession[] = [];
  for (const doc of inp.salesInfos) {
    const docId = idOf(doc._id);
    const userId = idOf(first(doc, ["user", "userId", "user_id"]));
    const created = dateOf(doc.createdAt);
    const entries = salesEntries(doc);
    if (!entries.length) {
      issues.push({
        check: "Sales Info session ID 누락",
        collection: "sales_infos",
        recordId: docId,
        detail: "state.sales_info 없음",
      });
      continue;
    }
    for (const e of entries) {
      const sid = idOf(e.session);
      if (!sid) {
        issues.push({
          check: "Sales Info session ID 누락",
          collection: "sales_infos",
          recordId: docId,
          detail: "state.sales_info.session 없음 → 집계 제외",
        });
        continue;
      }
      const started = dateOf(first(e, ["createdAt", "startedAt"])) ?? created;
      if (!started) {
        issues.push({
          check: "V2 레코드 오류",
          collection: "sales_infos",
          recordId: sid,
          detail: "createdAt 없음/잘못됨",
        });
        continue;
      }
      const realStart = dateOf(
        first(e, ["startedAt", "startTime", "start_at"]),
      );
      if (
        realStart &&
        created &&
        Math.abs(Date.parse(realStart) - Date.parse(created)) > 3_600_000
      )
        issues.push({
          check: "진입 일시 차이(1시간 초과)",
          collection: "sales_infos",
          recordId: sid,
          detail: `createdAt ${created} / 시작 ${realStart}`,
        });
      const status =
        strOf(first(e, ["status"])) ??
        strOf(first(doc, ["status", "state.status"]));
      const completed = status === "completed";
      const hasReport = (() => {
        const r =
          first(e, ["report", "reportId"]) ??
          first(doc, ["state.report", "report"]);
        return (
          r !== undefined && r !== null && !(Array.isArray(r) && r.length === 0)
        );
      })();
      if (completed !== hasReport)
        issues.push({
          check: "완료 상태와 리포트 불일치",
          collection: "sales_infos",
          recordId: sid,
          detail: completed
            ? "completed인데 리포트 없음"
            : `리포트 있는데 status ${status ?? "없음"}`,
        });
      const step = strOf(e.step);
      if (completed && step && step !== "completed" && step !== "report")
        issues.push({
          check: "완료 상태와 step 불일치",
          collection: "sales_infos",
          recordId: sid,
          detail: `step ${step}`,
        });
      const u = userId ? users.get(userId) : undefined;
      if (userId && !u)
        issues.push({
          check: "사용자 ID 매핑 실패",
          collection: "sales_infos",
          recordId: sid,
          detail: `user ${userId}`,
        });
      const cc = u?.country ?? null;
      if (!cc)
        issues.push({
          check: "국가 코드 누락",
          collection: "sales_infos",
          recordId: sid,
          detail: "UNKNOWN으로 분류",
        });
      rows.push({
        session_id: sid,
        simulation_id:
          strOf(first(e, ["simulationId", "simulation_id"])) ?? docId,
        user_id: userId,
        splus_uuid: u?.splus ?? null,
        country_code: cc ?? "UNKNOWN",
        version: "V2",
        simulation_type: strOf(
          first(e, ["simulationType", "simulation_type", "type"]),
        ),
        stage_no: null,
        sales_case: strOf(first(e, ["sales_case", "salesCase"])),
        sales_type: strOf(first(e, ["sales_type", "salesType"])),
        scenario_id: strOf(first(e, ["scenario_id", "scenarioId"])),
        target_product: strOf(first(e, ["target_product", "targetProduct"])),
        channel_id: strOf(first(e, CHANNEL)) ?? strOf(first(doc, CHANNEL)),
        started_at: started,
        updated_at: dateOf(first(e, ["updatedAt"])) ?? dateOf(doc.updatedAt),
        year_month: yearMonth(started, cfg.timeZone),
        is_completed: completed,
        completion_status: status ?? "unknown",
        score: numOf(first(e, ["score", "totalScore", "report.score"])),
        deleted_at: dateOf(first(e, DELETED)) ?? dateOf(first(doc, DELETED)),
        source_collection: "sales_infos",
      });
    }
  }
  return rows;
}

/**
 * Both versions, deduplicated by (version, session_id) — first by sorted
 * order wins, so repeated or overlapping files give the same result.
 * Rows outside the channel/deleted settings are kept in the session file
 * but flagged by `counted`.
 */
export function normalizeAll(inp: Inputs, cfg: CoachDbConfig) {
  const issues: Issue[] = [];
  const all = [
    ...normalizeV1(inp, cfg, issues),
    ...normalizeV2(inp, cfg, issues),
  ].sort(
    (a, b) =>
      a.version.localeCompare(b.version) ||
      a.session_id.localeCompare(b.session_id) ||
      a.started_at.localeCompare(b.started_at) ||
      Number(b.is_completed) - Number(a.is_completed),
  );
  const seen = new Set<string>();
  const sessions: CoachSession[] = [];
  for (const r of all) {
    const k = `${r.version}|${r.session_id}`;
    if (seen.has(k)) {
      issues.push({
        check: "세션 ID 중복",
        collection: r.source_collection,
        recordId: r.session_id,
        detail: "같은 세션이 여러 번 → 1건만 집계",
      });
      continue;
    }
    seen.add(k);
    sessions.push(r);
  }
  const counted = (r: CoachSession) =>
    (cfg.includeDeleted || !r.deleted_at) &&
    !(r.channel_id && cfg.testChannels.includes(r.channel_id)) &&
    (!cfg.includeChannels.length ||
      (!!r.channel_id && cfg.includeChannels.includes(r.channel_id)));
  return { sessions, counted: sessions.filter(counted), issues };
}
