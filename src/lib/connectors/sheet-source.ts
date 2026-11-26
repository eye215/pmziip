/**
 * Read-only source: a link-shared Google Sheet tab written by
 * tools/apps-script/coach-ga-export (exportToSheet). Column A holds the
 * export JSON split into text chunks; the header cell carries count + SHA-256.
 * No credential is involved; the sheet ID stays in the user's browser only.
 */
export const SHEET_TAB = "pmzip_export";
export const CHUNK_HEADER = "pmzip.coach-ga-export.chunks";

/** Accepts a full Google Sheets URL or a bare ID. */
export function sheetIdFrom(input: string): string {
  const value = input.trim();
  const fromUrl = value.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)?.[1];
  const id = fromUrl || value;
  if (!/^[A-Za-z0-9_-]{25,100}$/.test(id))
    throw new Error("Google 스프레드시트 링크 또는 ID를 확인해 주세요.");
  return id;
}

export function sheetCsvUrl(id: string, tab = SHEET_TAB): string {
  return (
    `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}` +
    `/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(tab)}`
  );
}

/** Minimal RFC 4180 parser (quoted fields, "" escapes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw new Error("시트 응답(CSV)이 잘렸습니다.");
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Rebuilds the export text from column A. Rejects anything that is not the
 * exact chunk set (wrong header, missing/extra chunk, hash mismatch).
 */
export async function joinSheetChunks(
  rows: string[][],
  sha256: (text: string) => Promise<string>,
  expectedHeader = CHUNK_HEADER,
  tab = SHEET_TAB,
): Promise<string> {
  const cells = rows.map((r) => r[0] ?? "").filter((c) => c !== "");
  const header = cells[0]?.split("|") ?? [];
  if (header[0] !== expectedHeader || header[1] !== "v1")
    throw new Error(
      `시트의 ${tab} 탭이 PM.zip 내보내기 형식이 아닙니다. 공유 설정과 탭 이름을 확인해 주세요.`,
    );
  const expected = Number(header[2]);
  const chunks = cells.slice(1);
  if (!Number.isInteger(expected) || chunks.length !== expected)
    throw new Error(
      `시트 데이터가 불완전합니다 (조각 ${chunks.length}/${header[2]}).`,
    );
  const text = chunks
    .map((c) => {
      if (c.length < 2 || !c.startsWith("|") || !c.endsWith("|"))
        throw new Error("시트 데이터 조각 형식이 올바르지 않습니다.");
      return c.slice(1, -1);
    })
    .join("");
  if ((await sha256(text)) !== header[3])
    throw new Error(
      "시트 데이터 검증값이 맞지 않습니다. Apps Script를 다시 실행해 주세요.",
    );
  return text;
}
