import { z } from "zod";
import type { CoachSession, Storage } from "../coach-data/store";

/**
 * Public segment results typed in by hand from Samsung's quarterly earnings
 * release or a DART report (e.g. MX/네트워크). Public figures only, each with
 * its source. Append-only: an edit is a new entry for the same quarter and
 * segment; removing is a tombstone. Missing values stay null (never 0).
 */
const instant = z.iso.datetime({ offset: true });
const krw = z.number().finite().nullable();
export const segmentSource = z
  .string()
  .trim()
  .max(500)
  .refine(
    (v) => /^https:\/\/[^\s]+$/.test(v) || /^\d{14}$/.test(v),
    "출처는 https 링크 또는 DART 접수번호(14자리)로 적어 주세요.",
  );
export const segmentEntrySchema = z
  .object({
    id: z.uuid(),
    year: z.number().int().min(2000).max(2100),
    quarter: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    segment: z.string().trim().min(1).max(40),
    revenue: krw,
    operatingIncome: krw,
    source: segmentSource,
    enteredAt: instant,
    removed: z.boolean(),
  })
  .strict()
  .refine(
    (e) => e.removed || e.revenue !== null || e.operatingIncome !== null,
    {
      message: "매출과 영업이익 중 하나는 적어 주세요.",
    },
  );
export type SegmentEntry = z.infer<typeof segmentEntrySchema>;
export const segmentStoreSchema = z
  .object({
    schemaVersion: z.literal(1),
    ownerId: z.uuid(),
    workspaceId: z.uuid(),
    revision: z.number().int().nonnegative(),
    entries: z.array(segmentEntrySchema).max(2000),
  })
  .strict();
export type SegmentStore = z.infer<typeof segmentStoreSchema>;
export type LoadedSegment = { state: SegmentStore; token: string | null };

export const segmentStorageKey = (s: CoachSession) =>
  `pmzip:segment-fin:v1:${s.ownerId}:${s.workspaceId}`;

export function loadSegments(
  storage: Storage,
  session: CoachSession,
): LoadedSegment {
  const token = storage.getItem(segmentStorageKey(session));
  if (token === null)
    return {
      state: {
        schemaVersion: 1,
        ownerId: session.ownerId,
        workspaceId: session.workspaceId,
        revision: 0,
        entries: [],
      },
      token: null,
    };
  const state = segmentStoreSchema.parse(JSON.parse(token));
  if (
    state.ownerId !== session.ownerId ||
    state.workspaceId !== session.workspaceId
  )
    throw new Error("다른 워크스페이스의 부문 실적 기록입니다.");
  return { state, token };
}

export function appendSegment(
  storage: Storage,
  loaded: LoadedSegment,
  entry: Omit<SegmentEntry, "id" | "enteredAt">,
  session: CoachSession,
  runtime: { id: () => string; now: () => string },
): LoadedSegment {
  if (storage.getItem(segmentStorageKey(session)) !== loaded.token)
    throw new Error(
      "다른 탭에서 부문 실적이 바뀌었습니다. 다시 시도해 주세요.",
    );
  const next = segmentStoreSchema.parse({
    ...loaded.state,
    revision: loaded.state.revision + 1,
    entries: [
      ...loaded.state.entries,
      { ...entry, id: runtime.id(), enteredAt: runtime.now() },
    ],
  });
  const token = JSON.stringify(next);
  storage.setItem(segmentStorageKey(session), token);
  return { state: next, token };
}

export const segmentKey = (e: {
  year: number;
  quarter: number;
  segment: string;
}) => `${e.segment}|${e.year}-Q${e.quarter}`;

/** Current value per (segment, quarter): the latest entry, unless removed. */
export function currentSegments(state: SegmentStore): SegmentEntry[] {
  const latest = new Map<string, SegmentEntry>();
  for (const e of state.entries) {
    const cur = latest.get(segmentKey(e));
    if (!cur || e.enteredAt >= cur.enteredAt) latest.set(segmentKey(e), e);
  }
  return [...latest.values()]
    .filter((e) => !e.removed)
    .sort(
      (a, b) =>
        a.segment.localeCompare(b.segment) ||
        a.year - b.year ||
        a.quarter - b.quarter,
    );
}

/** "34.12" (조원) → KRW; "" → null. Throws on anything else. */
export function parseTrillion(text: string): number | null {
  const t = text.trim().replace(/,/g, "");
  if (!t) return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(t))
    throw new Error(
      "금액은 조원 단위 숫자로, 소수점 둘째 자리까지 적어 주세요.",
    );
  return Math.round(Number(t) * 100) * 1e10;
}
