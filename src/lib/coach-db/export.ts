import type { CoachSession } from "./normalize";

/** CSV (RFC 4180, UTF-8 with BOM for Excel), columns in the given order. */
export function toCsv(rows: Record<string, unknown>[], columns: string[]) {
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "boolean" ? (v ? "true" : "false") : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return (
    "﻿" +
    [
      columns.join(","),
      ...rows.map((r) => columns.map((c) => cell(r[c])).join(",")),
    ].join("\r\n") +
    "\r\n"
  );
}

export const sessionColumns: (keyof CoachSession)[] = [
  "session_id",
  "simulation_id",
  "user_id",
  "splus_uuid",
  "country_code",
  "version",
  "simulation_type",
  "stage_no",
  "sales_case",
  "sales_type",
  "scenario_id",
  "target_product",
  "channel_id",
  "started_at",
  "updated_at",
  "year_month",
  "is_completed",
  "completion_status",
  "score",
  "deleted_at",
  "source_collection",
];
export const metricColumns = [
  "entry_users",
  "completed_users",
  "entries",
  "completions",
  "incomplete",
  "session_completion_rate",
  "user_completion_rate",
  "avg_entries_per_user",
  "avg_completions_per_user",
];
export const qualityColumns = [
  "check",
  "collection",
  "count",
  "detail",
  "samples",
];

// ── Minimal XLSX (stored ZIP + SpreadsheetML, inline strings) ─────────
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zip(files: { name: string; data: string }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = enc.encode(f.data);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const a of all) {
    out.set(a, p);
    p += a.length;
  }
  return out;
}
const xml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // XML 1.0 forbids most control characters.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
function colName(i: number) {
  let s = "";
  for (i++; i > 0; i = Math.floor((i - 1) / 26))
    s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}
function sheetXml(rows: Record<string, unknown>[], columns: string[]) {
  const line = (cells: unknown[], r: number) =>
    `<row r="${r}">${cells
      .map((v, c) => {
        const ref = `${colName(c)}${r}`;
        if (v === null || v === undefined || v === "") return "";
        if (typeof v === "number" && Number.isFinite(v))
          return `<c r="${ref}"><v>${v}</v></c>`;
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(String(v)).slice(0, 32000)}</t></is></c>`;
      })
      .join("")}</row>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${[
    line(columns, 1),
    ...rows.map((row, i) =>
      line(
        columns.map((c) => row[c]),
        i + 2,
      ),
    ),
  ].join("")}</sheetData></worksheet>`;
}

/** Workbook with one sheet per table (sheet names ≤31 chars). */
export function toXlsx(
  sheets: {
    name: string;
    rows: Record<string, unknown>[];
    columns: string[];
  }[],
): Uint8Array {
  const ws = sheets.map((s, i) => ({
    name: `xl/worksheets/sheet${i + 1}.xml`,
    data: sheetXml(s.rows, s.columns),
  }));
  return zip([
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${ws
        .map(
          (w) =>
            `<Override PartName="/${w.name}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join("")}</Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
        .map(
          (s, i) =>
            `<sheet name="${xml(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
        )
        .join("")}</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${ws
        .map(
          (w, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join("")}</Relationships>`,
    },
    ...ws,
  ]);
}

/** README.md: how it was run and how numbers are defined (no data). */
export function readme(meta: {
  version: string;
  generatedAt: string;
  timeZone: string;
  files: string[];
  includeChannels: string[];
  testChannels: string[];
  includeDeleted: boolean;
}) {
  return `# Galaxy Coach 국가별·월별 이용 및 완료율 (DB 세션 기준)

생성: ${meta.generatedAt} · 계산 버전 ${meta.version} · PM.zip(브라우저 안에서 계산, 외부 전송 없음)

## 실행 방법
PM.zip → 설정 → "Galaxy Coach DB 세션 가져오기"에서 voice_sessions / stage_infos /
sales_infos / users JSON(배열 또는 줄마다 한 문서, MongoDB Extended JSON 허용)을 고르고
"집계"를 누른다. 같은 파일이면 같은 결과가 나온다. 새 달 파일을 함께 고르면 세션 ID로
중복을 없애고 다시 집계한다. 원본 파일은 수정하지 않는다.

입력 파일: ${meta.files.join(", ") || "-"}

## V1과 V2의 차이
- V1(Stage 기반): voice_sessions._id 1개 = 진입 1건. Stage 1·2·3을 구분하지 않고 각 세션을
  독립 진입으로 센다. stage_infos의 state.stage_info.stage1~3을 세션 단위로 펼쳐
  session으로 연결하고, step이 completed면 완료. 연결되지 않으면 잠정 미완료이며 건수는
  품질 보고서에 따로 남긴다. 국가는 voice_sessions.state.countryCode, 없으면 users에서 보완.
  진입 일시는 voice_sessions.createdAt.
- V2(Sales 기반): state.sales_info.session 1개 = 진입 1건(미완료 포함). status가
  completed면 완료. step과 report 존재를 교차 검증하며 goal_complete는 쓰지 않는다.
  국가는 users.personalData.countryCode. 진입 일시는 sales_infos.createdAt(실제 시작
  시각과 1시간 넘게 다르면 품질 보고서에 기록).
- 국가 코드를 확인할 수 없으면 UNKNOWN. 추정하지 않는다.

## 집계 기준
- 진입 사용자 수 = 고유 user_id 수 / 완료 사용자 수 = 1회 이상 완료한 고유 user_id 수
- 진입 건수 = 고유 session_id 수 / 완료 건수 = 완료된 고유 session_id 수 / 미완료 = 진입 − 완료
- 세션 완료율 = 완료 건수 ÷ 진입 건수 × 100, 사용자 완료율 = 완료 사용자 ÷ 진입 사용자 × 100
- 사용자당 평균 진입 = 진입 건수 ÷ 진입 사용자, 평균 완료 = 완료 건수 ÷ 진입 사용자
- 완료율은 국가·월 완료율의 평균이 아니라 전체 완료 건수 ÷ 전체 진입 건수. 분모 0은 빈칸(N/A).
- 월 = 진입 일시 기준(시간대 ${meta.timeZone}). 진입 월과 완료 월이 달라도 진입 월에 반영.
- 사용자 수는 월·국가를 넘어 더하지 않는다(같은 사람이 여러 번 셈).
- 삭제된 데이터: ${meta.includeDeleted ? "포함" : "제외"} / 포함 채널: ${meta.includeChannels.join(" ") || "전체"} / 테스트 채널(제외): ${meta.testChannels.join(" ") || "없음"}
- 전환일은 고정하지 않는다. 품질 보고서의 V1·V2 최초·최종 일시와 중첩 구간을 먼저 확인한다.

## 산출물
galaxy_coach_sessions.csv, monthly_country_summary.csv, monthly_global_summary.csv,
monthly_version_summary.csv, data_quality_report.csv, galaxy_coach_statistics.xlsx, README.md
`;
}
