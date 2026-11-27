import { z } from "zod";
import {
  ruleSchema,
  type ExcludeRule,
} from "../../lib/connectors/exclude-rules";

/** Exclusion rules of this workspace (synced with records when sync is on). */
export const rulesStoreSchema = z
  .object({
    schemaVersion: z.literal(1),
    ownerId: z.uuid(),
    workspaceId: z.uuid(),
    rules: z.array(ruleSchema).max(300),
  })
  .strict();
export type RulesStore = z.infer<typeof rulesStoreSchema>;
type Session = { ownerId: string; workspaceId: string };
type Storage = {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
};
export const rulesKey = (s: Session) =>
  `pmzip:intake-rules:v1:${s.ownerId}:${s.workspaceId}`;

export function loadRules(storage: Storage, s: Session): RulesStore {
  const raw = storage.getItem(rulesKey(s));
  if (raw === null)
    return {
      schemaVersion: 1,
      ownerId: s.ownerId,
      workspaceId: s.workspaceId,
      rules: [],
    };
  const st = rulesStoreSchema.parse(JSON.parse(raw));
  if (st.ownerId !== s.ownerId || st.workspaceId !== s.workspaceId)
    throw new Error("다른 워크스페이스의 제외 규칙입니다.");
  return st;
}

export function saveRules(storage: Storage, s: Session, rules: ExcludeRule[]) {
  const st = rulesStoreSchema.parse({
    ...loadRules(storage, s),
    rules,
  });
  storage.setItem(rulesKey(s), JSON.stringify(st));
  return st;
}

/** Adds a rule unless the same field+text already exists. */
export function addRule(
  storage: Storage,
  s: Session,
  rule: ExcludeRule,
): { added: boolean; rules: ExcludeRule[] } {
  const cur = loadRules(storage, s).rules;
  const same = cur.some(
    (r) =>
      r.field === rule.field &&
      r.mode === rule.mode &&
      r.channel === rule.channel &&
      r.text.toLowerCase() === rule.text.trim().toLowerCase(),
  );
  if (same) return { added: false, rules: cur };
  return { added: true, rules: saveRules(storage, s, [...cur, rule]).rules };
}

export function removeRule(storage: Storage, s: Session, id: string) {
  return saveRules(
    storage,
    s,
    loadRules(storage, s).rules.filter((r) => r.id !== id),
  ).rules;
}
