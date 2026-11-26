import {
  authorize,
  createState,
  stateSchema,
  type RecordsState,
  type Session,
} from "./model";
export type LocalStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};
export type Loaded = { state: RecordsState; token: string | null };
export const storageKey = (session: Session) =>
  `pmzip:synthetic:v1:${session.ownerId}:${session.workspaceId}`;
export function loadLocal(storage: LocalStorage, session: Session): Loaded {
  const token = storage.getItem(storageKey(session));
  if (token === null) return { state: createState(session), token: null };
  const state = stateSchema.parse(JSON.parse(token));
  authorize(state, session);
  return { state, token };
}
export function commitLocal(
  storage: LocalStorage,
  loaded: Loaded,
  next: RecordsState,
  session: Session,
): Loaded {
  authorize(loaded.state, session);
  authorize(next, session);
  stateSchema.parse(next);
  if (storage.getItem(storageKey(session)) !== loaded.token)
    throw new Error(
      "다른 탭에서 기록이 바뀌었습니다. 작성 내용을 복사한 뒤 새로고침해 주세요.",
    );
  if (next.revision !== loaded.state.revision + 1)
    throw new Error("저장 버전이 일치하지 않습니다.");
  const token = JSON.stringify(next);
  if (
    token.length > 5_000_000 ||
    new TextEncoder().encode(token).byteLength > 5_000_000
  )
    throw new Error("로컬 저장 한도를 넘었습니다. 먼저 백업해 주세요.");
  storage.setItem(storageKey(session), token);
  return { state: next, token };
}
