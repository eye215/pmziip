import { z } from "zod";
import {
  countryCode,
  type SharePoint,
} from "../../lib/connectors/market-share";
import type { CoachSession, Storage } from "../coach-data/store";

/** Append-only share history (own key). A value is added only when it changes. */
const stored = z
  .object({
    country: countryCode,
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    vendor: z.string().min(1).max(80),
    share: z.number().min(0).max(100).nullable(),
    importedAt: z.iso.datetime({ offset: true }),
    source: z.enum(["sheet", "csv"]),
  })
  .strict();
export const marketStoreSchema = z
  .object({
    schemaVersion: z.literal(1),
    ownerId: z.uuid(),
    workspaceId: z.uuid(),
    revision: z.number().int().nonnegative(),
    points: z.array(stored).max(200000),
  })
  .strict();
export type MarketStore = z.infer<typeof marketStoreSchema>;
export type LoadedMarket = { state: MarketStore; token: string | null };

export const marketStorageKey = (s: CoachSession) =>
  `pmzip:market-share:v1:${s.ownerId}:${s.workspaceId}`;
export const marketSourceKey = (s: CoachSession) =>
  `pmzip:market-share-source:v1:${s.ownerId}:${s.workspaceId}`;

export function loadMarket(
  storage: Storage,
  session: CoachSession,
): LoadedMarket {
  const token = storage.getItem(marketStorageKey(session));
  if (token === null)
    return {
      state: {
        schemaVersion: 1,
        ownerId: session.ownerId,
        workspaceId: session.workspaceId,
        revision: 0,
        points: [],
      },
      token: null,
    };
  const state = marketStoreSchema.parse(JSON.parse(token));
  if (
    state.ownerId !== session.ownerId ||
    state.workspaceId !== session.workspaceId
  )
    throw new Error("다른 워크스페이스의 점유율 기록입니다.");
  return { state, token };
}

const key = (p: { country: string; month: string; vendor: string }) =>
  `${p.country}|${p.month}|${p.vendor}`;

/** Latest value per (country, month, vendor). */
export function latestPoints(state: MarketStore): SharePoint[] {
  const latest = new Map<string, MarketStore["points"][number]>();
  for (const p of state.points) {
    const k = key(p);
    const cur = latest.get(k);
    if (!cur || p.importedAt >= cur.importedAt) latest.set(k, p);
  }
  return [...latest.values()].map(({ country, month, vendor, share }) => ({
    country,
    month,
    vendor,
    share,
  }));
}

export function commitMarket(
  storage: Storage,
  loaded: LoadedMarket,
  incoming: SharePoint[],
  source: "sheet" | "csv",
  session: CoachSession,
  now: string,
): { loaded: LoadedMarket; added: number; unchanged: number } {
  const current = new Map(
    latestPoints(loaded.state).map((p) => [key(p), p.share]),
  );
  const add = incoming
    .filter((p) => !current.has(key(p)) || current.get(key(p)) !== p.share)
    .map((p) => ({ ...p, importedAt: now, source }));
  if (!add.length) return { loaded, added: 0, unchanged: incoming.length };
  if (storage.getItem(marketStorageKey(session)) !== loaded.token)
    throw new Error(
      "다른 탭에서 점유율 기록이 바뀌었습니다. 다시 시도해 주세요.",
    );
  const next = marketStoreSchema.parse({
    ...loaded.state,
    revision: loaded.state.revision + 1,
    points: [...loaded.state.points, ...add],
  });
  const token = JSON.stringify(next);
  if (new TextEncoder().encode(token).byteLength > 4_000_000)
    throw new Error("로컬 저장 한도를 넘었습니다.");
  storage.setItem(marketStorageKey(session), token);
  return {
    loaded: { state: next, token },
    added: add.length,
    unchanged: incoming.length - add.length,
  };
}

export const marketSourceSchema = z
  .object({
    sheetId: z.string().regex(/^[A-Za-z0-9_-]{25,100}$/),
    lastSyncAt: z.iso.datetime({ offset: true }).nullable(),
    lastOk: z.boolean().nullable(),
    lastResult: z.string().max(500).nullable(),
  })
  .strict();
export type MarketSource = z.infer<typeof marketSourceSchema>;
