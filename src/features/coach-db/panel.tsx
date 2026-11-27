"use client";

import { useId, useState } from "react";
import { session } from "../records/browser-store";
import { sha256 } from "../coach-data/store";
import { parseCollection } from "../../lib/coach-db/ejson";
import {
  COACH_DB_VERSION,
  defaultCoachDbConfig,
  normalizeAll,
  type CoachDbConfig,
  type CoachSession,
  type Inputs,
} from "../../lib/coach-db/normalize";
import {
  countryMonthly,
  globalMonthly,
  qualityReport,
  versionMonthly,
} from "../../lib/coach-db/aggregate";
import {
  metricColumns,
  qualityColumns,
  readme,
  sessionColumns,
  toCsv,
  toXlsx,
} from "../../lib/coach-db/export";
import { loadCoachDb, saveCoachDb, type CoachDbStore } from "./store";

const KINDS = [
  ["voiceSessions", /voice[_-]?sessions?/i, "voice_sessions"],
  ["stageInfos", /stage[_-]?infos?/i, "stage_infos"],
  ["salesInfos", /sales[_-]?infos?/i, "sales_infos"],
  ["users", /users?/i, "users"],
] as const;
type Kind = (typeof KINDS)[number][0];
const kindOf = (name: string): Kind | null =>
  KINDS.find(([, re]) => re.test(name))?.[0] ?? null;

function download(name: string, data: string | Uint8Array, type: string) {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const list = (s: string) =>
  s
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

type Result = {
  store: CoachDbStore;
  sessions: CoachSession[];
};

/** Settings: Galaxy Coach DB export files → sessions and monthly metrics. */
export function CoachDbPanel() {
  const ids = useId();
  const [files, setFiles] = useState<File[]>([]);
  const [cfg, setCfg] = useState<CoachDbConfig>(() => {
    try {
      return (
        loadCoachDb(window.localStorage, session)?.config ??
        defaultCoachDbConfig
      );
    } catch {
      return defaultCoachDbConfig;
    }
  });
  const [include, setInclude] = useState(cfg.includeChannels.join(", "));
  const [tests, setTests] = useState(cfg.testChannels.join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [saved, setSaved] = useState<CoachDbStore | null>(() => {
    try {
      return loadCoachDb(window.localStorage, session);
    } catch {
      return null;
    }
  });

  async function run() {
    setError("");
    setBusy(true);
    try {
      const unknown = files.filter((f) => !kindOf(f.name)).map((f) => f.name);
      if (unknown.length)
        throw new Error(
          `파일 이름으로 종류를 알 수 없습니다: ${unknown.join(", ")} (voice_sessions / stage_infos / sales_infos / users 가 이름에 들어가야 합니다)`,
        );
      const inputs: Inputs = {
        voiceSessions: [],
        stageInfos: [],
        salesInfos: [],
        users: [],
      };
      const meta: { name: string; docs: number }[] = [];
      const hashes: string[] = [];
      for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
        const text = await f.text();
        let docs;
        try {
          docs = parseCollection(text);
        } catch (e) {
          throw new Error(
            `${f.name}: ${e instanceof Error ? e.message : "읽지 못했습니다."}`,
          );
        }
        inputs[kindOf(f.name)!].push(...docs);
        meta.push({ name: f.name.slice(0, 200), docs: docs.length });
        hashes.push(await sha256(text));
      }
      if (!inputs.voiceSessions.length && !inputs.salesInfos.length)
        throw new Error("voice_sessions 또는 sales_infos 파일이 필요합니다.");
      const config: CoachDbConfig = {
        ...cfg,
        includeChannels: list(include),
        testChannels: list(tests),
      };
      const out = normalizeAll(inputs, config);
      const store: CoachDbStore = {
        schemaVersion: 1,
        ownerId: session.ownerId,
        workspaceId: session.workspaceId,
        calcVersion: COACH_DB_VERSION,
        generatedAt: new Date().toISOString(),
        inputHash: await sha256(
          JSON.stringify({ hashes: hashes.sort(), config }),
        ),
        files: meta,
        config,
        global: globalMonthly(out.counted),
        country: countryMonthly(out.counted),
        version: versionMonthly(out.counted) as CoachDbStore["version"],
        quality: qualityReport(
          out.sessions,
          out.counted,
          out.issues,
          config,
        ).map((q) => ({
          ...q,
          detail: q.detail.slice(0, 1000),
          samples: q.samples.slice(0, 1000),
        })),
      };
      saveCoachDb(window.localStorage, session, store);
      window.dispatchEvent(new Event("pmzip:view"));
      setSaved(store);
      setResult({ store, sessions: out.sessions });
    } catch (e) {
      setError(e instanceof Error ? e.message : "집계하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const s = result?.store ?? saved;
  const csv = "text/csv;charset=utf-8";
  return (
    <section className="panel coach-data" aria-labelledby={`${ids}-h`}>
      <h2 id={`${ids}-h`}>Galaxy Coach DB 세션 가져오기</h2>
      <p className="subtle">
        MongoDB에서 내보낸 voice_sessions · stage_infos · sales_infos · users
        JSON을 이 브라우저 안에서만 읽어 V1(Stage)·V2(Sales) 세션을 맞추고
        국가별·월별 이용과 완료율을 계산합니다. 파일은 어디에도 올리지 않으며,
        저장되는 것은 월별 집계와 품질 점검 결과뿐입니다(사용자 ID 없음). 같은
        파일이면 같은 결과입니다.
      </p>
      <div className="field">
        <label htmlFor={`${ids}-f`}>
          JSON 파일 (여러 개 선택, 새 달 파일 추가 가능)
        </label>
        <input
          id={`${ids}-f`}
          type="file"
          multiple
          accept=".json,application/json"
          onChange={(e) => setFiles([...(e.target.files ?? [])])}
        />
      </div>
      {files.length > 0 && (
        <p className="subtle">
          {files
            .map(
              (f) =>
                `${f.name} → ${KINDS.find(([k]) => k === kindOf(f.name))?.[2] ?? "알 수 없음"}`,
            )
            .join(" · ")}
        </p>
      )}
      <div className="seg-form">
        <div className="field">
          <label htmlFor={`${ids}-tz`}>월 기준 시간대</label>
          <select
            id={`${ids}-tz`}
            value={cfg.timeZone}
            onChange={(e) => setCfg({ ...cfg, timeZone: e.target.value })}
          >
            <option value="UTC">UTC (기본)</option>
            <option value="Asia/Seoul">Asia/Seoul</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${ids}-in`}>집계할 채널 (비우면 전체)</label>
          <input
            id={`${ids}-in`}
            value={include}
            onChange={(e) => setInclude(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${ids}-te`}>테스트 채널 (제외)</label>
          <input
            id={`${ids}-te`}
            value={tests}
            onChange={(e) => setTests(e.target.value)}
          />
        </div>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={cfg.includeDeleted}
          onChange={(e) => setCfg({ ...cfg, includeDeleted: e.target.checked })}
        />
        삭제된 데이터도 집계
      </label>
      <div className="actions">
        <button
          type="button"
          className="primary"
          disabled={busy || !files.length}
          onClick={() => void run()}
        >
          {busy ? "계산 중…" : "집계"}
        </button>
      </div>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {s && (
        <>
          <p role="status" className="notice">
            {result ? "집계했습니다. " : "마지막 집계: "}
            {s.generatedAt.slice(0, 16).replace("T", " ")} UTC ·{" "}
            {s.global.length}개월 · 시간대 {s.config.timeZone} · 계산{" "}
            {s.calcVersion} · 입력 {s.inputHash.slice(0, 8)}
          </p>
          <details>
            <summary>데이터 품질 점검 {s.quality.length}항목</summary>
            <div className="table-scroll">
              <table className="seg-table" aria-label="데이터 품질 점검">
                <thead>
                  <tr>
                    <th scope="col">점검</th>
                    <th scope="col">대상</th>
                    <th scope="col">건수</th>
                    <th scope="col">내용</th>
                  </tr>
                </thead>
                <tbody>
                  {s.quality.map((q, i) => (
                    <tr key={i}>
                      <td>{q.check}</td>
                      <td>{q.collection}</td>
                      <td>{q.count.toLocaleString("ko-KR")}</td>
                      <td className="wrap">{q.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <div className="actions">
            {result && (
              <button
                type="button"
                onClick={() =>
                  download(
                    "galaxy_coach_sessions.csv",
                    toCsv(result.sessions, sessionColumns),
                    csv,
                  )
                }
              >
                세션 CSV
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                download(
                  "monthly_global_summary.csv",
                  toCsv(s.global, ["year_month", ...metricColumns]),
                  csv,
                )
              }
            >
              전체 월별 CSV
            </button>
            <button
              type="button"
              onClick={() =>
                download(
                  "monthly_country_summary.csv",
                  toCsv(s.country, [
                    "year_month",
                    "country_code",
                    ...metricColumns,
                  ]),
                  csv,
                )
              }
            >
              국가별 CSV
            </button>
            <button
              type="button"
              onClick={() =>
                download(
                  "monthly_version_summary.csv",
                  toCsv(s.version, ["year_month", "version", ...metricColumns]),
                  csv,
                )
              }
            >
              버전별 CSV
            </button>
            <button
              type="button"
              onClick={() =>
                download(
                  "data_quality_report.csv",
                  toCsv(s.quality, qualityColumns),
                  csv,
                )
              }
            >
              품질 점검 CSV
            </button>
            <button
              type="button"
              onClick={() =>
                download(
                  "galaxy_coach_statistics.xlsx",
                  toXlsx([
                    {
                      name: "monthly_global",
                      rows: s.global,
                      columns: ["year_month", ...metricColumns],
                    },
                    {
                      name: "monthly_country",
                      rows: s.country,
                      columns: ["year_month", "country_code", ...metricColumns],
                    },
                    {
                      name: "monthly_version",
                      rows: s.version,
                      columns: ["year_month", "version", ...metricColumns],
                    },
                    {
                      name: "data_quality",
                      rows: s.quality,
                      columns: qualityColumns,
                    },
                    ...(result
                      ? [
                          {
                            name: "sessions",
                            rows: result.sessions,
                            columns: sessionColumns as string[],
                          },
                        ]
                      : []),
                  ]),
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
              }
            >
              엑셀(xlsx)
            </button>
            <button
              type="button"
              onClick={() =>
                download(
                  "README.md",
                  readme({
                    version: s.calcVersion,
                    generatedAt: s.generatedAt,
                    timeZone: s.config.timeZone,
                    files: s.files.map((f) => `${f.name}(${f.docs})`),
                    includeChannels: s.config.includeChannels,
                    testChannels: s.config.testChannels,
                    includeDeleted: s.config.includeDeleted,
                  }),
                  "text/markdown;charset=utf-8",
                )
              }
            >
              README
            </button>
          </div>
          {!result && (
            <p className="subtle">
              세션 CSV는 사용자 ID가 들어 있어 저장하지 않습니다. 필요하면
              파일을 다시 골라 집계하세요.
            </p>
          )}
        </>
      )}
    </section>
  );
}
