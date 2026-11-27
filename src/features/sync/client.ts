import { z } from "zod";
import { bundleSchema, type Bundle, type Session } from "./model";

/** This browser's sync settings (URL + token stay on the device). */
export const syncConfigSchema = z
  .object({
    url: z
      .string()
      .regex(
        /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/,
        "Apps Script 웹 앱 주소(https://script.google.com/macros/s/…/exec)를 넣어 주세요.",
      ),
    token: z
      .string()
      .regex(/^[A-Za-z0-9_-]{24,128}$/, "동기화 토큰 형식이 아닙니다."),
    lastRevision: z.number().int().nonnegative().nullable(),
    lastHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    lastSyncAt: z.iso.datetime({ offset: true }).nullable(),
    lastOk: z.boolean().nullable(),
    lastResult: z.string().max(500).nullable(),
  })
  .strict();
export type SyncConfig = z.infer<typeof syncConfigSchema>;
export const syncConfigKey = (s: Session) =>
  `pmzip:records-sync:v1:${s.ownerId}:${s.workspaceId}`;

export function loadSyncConfig(
  storage: { getItem: (k: string) => string | null },
  s: Session,
): SyncConfig | null {
  try {
    const raw = storage.getItem(syncConfigKey(s));
    if (raw === null) return null;
    const r = syncConfigSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
export function saveSyncConfig(
  storage: { setItem: (k: string, v: string) => void },
  s: Session,
  c: SyncConfig,
) {
  storage.setItem(syncConfigKey(s), JSON.stringify(syncConfigSchema.parse(c)));
}

const pullSchema = z.object({
  ok: z.literal(true),
  revision: z.number().int().nonnegative(),
  hash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  bundle: z.unknown().nullable(),
});
const pushSchema = z.union([
  z.object({ ok: z.literal(true), revision: z.number().int().positive() }),
  z.object({
    ok: z.literal(false),
    conflict: z.literal(true),
    revision: z.number().int().nonnegative(),
  }),
]);
const errorSchema = z.object({
  ok: z.literal(false),
  error: z.string().max(300),
});

/** POST text/plain (no CORS preflight); the token never goes in the URL. */
async function call(url: string, body: unknown, fetcher: typeof fetch) {
  let res: Response;
  try {
    res = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      redirect: "follow",
    });
  } catch {
    throw new Error("시트에 연결하지 못했습니다. 네트워크를 확인해 주세요.");
  }
  if (!res.ok) throw new Error(`시트 응답 오류 (${res.status})`);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error(
      "시트 응답을 읽지 못했습니다. 웹 앱 배포 설정(액세스: 모든 사용자)을 확인해 주세요.",
    );
  }
  const err = errorSchema.safeParse(json);
  if (err.success) throw new Error(err.data.error);
  return json;
}

export async function pullRemote(c: SyncConfig, fetcher: typeof fetch = fetch) {
  const r = pullSchema.parse(
    await call(c.url, { action: "pull", token: c.token }, fetcher),
  );
  return r as { revision: number; hash: string | null; bundle: unknown };
}

export async function pushRemote(
  c: SyncConfig,
  baseRevision: number,
  bundle: Bundle,
  hash: string,
  fetcher: typeof fetch = fetch,
) {
  bundleSchema.parse(bundle);
  return pushSchema.parse(
    await call(
      c.url,
      { action: "push", token: c.token, baseRevision, hash, bundle },
      fetcher,
    ),
  );
}
