/**
 * MongoDB Extended JSON helpers: {$oid}, {$date: string | {$numberLong}},
 * {$numberInt|$numberLong|$numberDouble|$numberDecimal}. Plain strings and
 * numbers pass through. Inputs are never mutated.
 */
type Json = unknown;
const isObj = (v: Json): v is Record<string, Json> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Id as a string ($oid, string, number); null when absent/unusable. */
export function idOf(v: Json): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (isObj(v)) {
    if (typeof v.$oid === "string") return v.$oid;
    if ("$numberLong" in v || "$numberInt" in v) return idOf(numOf(v));
    if ("$uuid" in v && typeof v.$uuid === "string") return v.$uuid;
  }
  return null;
}

/** Number from a plain or Extended JSON number; null otherwise. */
export function numOf(v: Json): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)))
    return Number(v);
  if (isObj(v)) {
    for (const k of [
      "$numberInt",
      "$numberLong",
      "$numberDouble",
      "$numberDecimal",
    ])
      if (k in v) return numOf(v[k]);
  }
  return null;
}

/** ISO 8601 UTC string from {$date}, ISO string or epoch millis; null if invalid. */
export function dateOf(v: Json): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (isObj(v) && "$date" in v) return dateOf(numOf(v.$date) ?? v.$date);
  let d: Date | null = null;
  if (typeof v === "number") d = new Date(v);
  else if (typeof v === "string") d = new Date(v);
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Value at a dotted path ("state.sales_info.session"). */
export function at(doc: Json, path: string): Json {
  let cur: Json = doc;
  for (const k of path.split(".")) {
    if (!isObj(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** First present value among several candidate paths. */
export function first(doc: Json, paths: string[]): Json {
  for (const p of paths) {
    const v = at(doc, p);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

export const strOf = (v: Json): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const id = idOf(v);
  return id;
};

/** Parses a collection file: a JSON array, or one JSON document per line. */
export function parseCollection(text: string): Record<string, Json>[] {
  const t = text.trim();
  if (!t) return [];
  if (t.startsWith("[")) {
    const arr = JSON.parse(t);
    if (!Array.isArray(arr)) throw new Error("배열 형식이 아닙니다.");
    return arr.filter(isObj);
  }
  return t
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch {
        throw new Error(`${i + 1}번째 줄이 JSON이 아닙니다.`);
      }
    })
    .filter(isObj);
}
