import { z } from "zod";

/**
 * Aggregates of the last Coach DB run (no session rows, no user ids):
 * monthly global / country / version metrics and the quality report.
 * Re-running with the same files gives the same content.
 */
const rate = z.number().nullable();
const metric = {
  entry_users: z.number().int().nonnegative(),
  completed_users: z.number().int().nonnegative(),
  entries: z.number().int().nonnegative(),
  completions: z.number().int().nonnegative(),
  incomplete: z.number().int().nonnegative(),
  session_completion_rate: rate,
  user_completion_rate: rate,
  avg_entries_per_user: rate,
  avg_completions_per_user: rate,
};
const ym = z.string().regex(/^\d{4}-\d{2}$/);
export const coachDbStoreSchema = z
  .object({
    schemaVersion: z.literal(1),
    ownerId: z.uuid(),
    workspaceId: z.uuid(),
    calcVersion: z.string().max(40),
    generatedAt: z.iso.datetime({ offset: true }),
    inputHash: z.string().regex(/^[0-9a-f]{64}$/),
    files: z
      .array(
        z
          .object({ name: z.string().max(200), docs: z.number().int() })
          .strict(),
      )
      .max(50),
    config: z
      .object({
        timeZone: z.string().max(64),
        includeChannels: z.array(z.string().max(100)).max(50),
        testChannels: z.array(z.string().max(100)).max(50),
        includeDeleted: z.boolean(),
      })
      .strict(),
    global: z.array(z.object({ year_month: ym, ...metric }).strict()).max(600),
    country: z
      .array(
        z
          .object({
            year_month: ym,
            country_code: z.string().max(10),
            ...metric,
          })
          .strict(),
      )
      .max(20000),
    version: z
      .array(
        z
          .object({ year_month: ym, version: z.enum(["V1", "V2"]), ...metric })
          .strict(),
      )
      .max(1200),
    quality: z
      .array(
        z
          .object({
            check: z.string().max(100),
            collection: z.string().max(40),
            count: z.number().int().nonnegative(),
            detail: z.string().max(1000),
            samples: z.string().max(1000),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
export type CoachDbStore = z.infer<typeof coachDbStoreSchema>;
type Session = { ownerId: string; workspaceId: string };
export const coachDbKey = (s: Session) =>
  `pmzip:coach-db:v1:${s.ownerId}:${s.workspaceId}`;

export function loadCoachDb(
  storage: { getItem: (k: string) => string | null },
  s: Session,
): CoachDbStore | null {
  const raw = storage.getItem(coachDbKey(s));
  if (raw === null) return null;
  const st = coachDbStoreSchema.parse(JSON.parse(raw));
  if (st.ownerId !== s.ownerId || st.workspaceId !== s.workspaceId)
    throw new Error("다른 워크스페이스의 Coach DB 집계입니다.");
  return st;
}
export function saveCoachDb(
  storage: { setItem: (k: string, v: string) => void },
  s: Session,
  st: CoachDbStore,
) {
  storage.setItem(coachDbKey(s), JSON.stringify(coachDbStoreSchema.parse(st)));
}
