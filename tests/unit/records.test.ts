import { describe, expect, it } from "vitest";
import {
  createState,
  applyCommand,
  queryInitiatives,
  type Runtime,
} from "../../src/features/records/model";
import { previewLegacy, importLegacy } from "../../src/features/records/legacy";
import {
  loadLocal,
  commitLocal,
  storageKey,
} from "../../src/features/records/persistence";
import { localDateTime, instantFromLocal } from "../../src/lib/time";

const ownerId = "00000000-0000-4000-8000-000000000010";
const workspaceId = "00000000-0000-4000-8000-000000000001";
const coach = "00000000-0000-4000-8000-000000000003";
const survey = "00000000-0000-4000-8000-000000000004";
let seq = 100;
const runtime: Runtime = {
  session: { mode: "synthetic", ownerId, workspaceId },
  now: () => "2026-11-30T15:00:00.000Z",
  id: () => `00000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`,
};
const source = {
  title: "합성 요구",
  rawText: "  원문\n<script>명령이 아님</script>  ",
  sourceType: "manual" as const,
  reference: "https://example.invalid/source",
  collectedAt: "2026-11-30T14:59:00.000Z",
  requesterRole: "기획",
  sensitivity: "internal" as const,
};
const initiative = (projectId = coach) => ({
  projectId,
  title: "입력 개선",
  problem: "합성 문제",
  targetSegment: "합성 사용자",
  expectedChange: "입력 개선",
  category: "improvement" as const,
  priority: "high" as const,
  assignee: "",
  contribution: "검증",
  decisionReason: "근거",
  alternative: "대안",
  plannedAt: "2026-12-01T00:00:00.000Z",
  targetMonth: "2026-12",
  status: "draft" as const,
});
function fixture() {
  let state = createState(runtime.session);
  state = applyCommand(state, { type: "source.save", data: source }, runtime);
  state = applyCommand(
    state,
    {
      type: "initiative.save",
      data: initiative(),
      sourceIds: [state.sources[0].id],
    },
    runtime,
  );
  return state;
}
const memory = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
  };
};

describe("Phase 1 synthetic records", () => {
  it("keeps original seconds/offset when editing other fields and rejects normalized invalid dates", () => {
    const original = "2026-11-25T11:22:33.456+09:00";
    expect(instantFromLocal(localDateTime(original), original)).toBe(original);
    expect(() => instantFromLocal("2026-02-30T12:00")).toThrow();
    expect(instantFromLocal("")).toBeNull();
  });
  it("T19: one source belongs to two projects without copying or overwriting original text", () => {
    let s = fixture();
    s = applyCommand(
      s,
      {
        type: "initiative.save",
        data: initiative(survey),
        sourceIds: [s.sources[0].id],
      },
      runtime,
    );
    expect(s.sources).toHaveLength(1);
    expect(s.links).toHaveLength(2);
    expect(s.sources[0].rawText).toBe(source.rawText);
    expect(queryInitiatives(s, { projectId: coach })).toHaveLength(1);
    expect(queryInitiatives(s, { projectId: survey })).toHaveLength(1);
    expect(s.sources[0].status).toBe("linked");
  });
  it("T18: rename, move, archive and restore preserve IDs, sources and work", () => {
    let s = fixture();
    const id = s.workspace.projects[0].id;
    const data = {
      name: "새 이름",
      description: "설명",
      clientId: null,
      kind: "coach" as const,
      timezone: "Asia/Seoul",
    };
    s = applyCommand(s, { type: "project.save", id, data }, runtime);
    s = applyCommand(
      s,
      { type: "project.archive", id, archived: true },
      runtime,
    );
    expect(s.initiatives[0].projectId).toBe(id);
    expect(s.sources).toHaveLength(1);
    expect(s.workspace.projects[0].clientId).toBeNull();
    s = applyCommand(
      s,
      { type: "project.archive", id, archived: false },
      runtime,
    );
    expect(s.workspace.projects[0].name).toBe("새 이름");
    expect(s.audit).toHaveLength(5);
  });
  it("rejects another owner/workspace, foreign links, unsafe URLs and empty text before mutation", () => {
    const s = fixture(),
      before = structuredClone(s);
    const other = {
      ...runtime,
      session: { ...runtime.session, ownerId: runtime.id() },
    };
    expect(() =>
      applyCommand(s, { type: "source.save", data: source }, other),
    ).toThrow();
    expect(() =>
      applyCommand(
        s,
        {
          type: "source.save",
          data: { ...source, reference: "javascript:alert(1)" },
        },
        runtime,
      ),
    ).toThrow();
    expect(() =>
      applyCommand(
        s,
        { type: "source.save", data: { ...source, rawText: "  " } },
        runtime,
      ),
    ).toThrow();
    expect(() =>
      applyCommand(
        s,
        {
          type: "initiative.save",
          data: initiative(),
          sourceIds: [runtime.id()],
        },
        runtime,
      ),
    ).toThrow();
    expect(() =>
      applyCommand(
        s,
        {
          type: "initiative.save",
          id: s.initiatives[0].id,
          data: initiative(survey),
          sourceIds: [],
        },
        runtime,
      ),
    ).toThrow();
    expect(s).toEqual(before);
  });
  it("keeps source edits as revisions and work status separate from measurement readiness", () => {
    let s = fixture();
    s = applyCommand(
      s,
      {
        type: "source.save",
        id: s.sources[0].id,
        data: { ...source, rawText: "수정본" },
      },
      runtime,
    );
    expect(s.sources[0].revisions[0].rawText).toBe(source.rawText);
    s = applyCommand(
      s,
      {
        type: "initiative.save",
        id: s.initiatives[0].id,
        data: { ...initiative(), status: "in_progress" },
        sourceIds: [s.sources[0].id],
      },
      runtime,
    );
    expect(s.initiatives[0].measurementStatus).toBe("not_ready");
  });
  it("connects several originals to an existing task idempotently without deleting any source", () => {
    let s = fixture();
    s = applyCommand(
      s,
      { type: "source.save", data: { ...source, title: "추가 근거" } },
      runtime,
    );
    const original = s.sources[0].id,
      extra = s.sources[1].id,
      work = s.initiatives[0].id;
    for (let i = 0; i < 2; i++)
      s = applyCommand(
        s,
        { type: "source.link", id: extra, initiativeIds: [work, work] },
        runtime,
      );
    expect(s.sources).toHaveLength(2);
    expect(s.links).toHaveLength(2);
    s = applyCommand(
      s,
      {
        type: "initiative.save",
        id: work,
        data: initiative(),
        sourceIds: [extra],
      },
      runtime,
    );
    expect(s.sources).toHaveLength(2);
    expect(s.sources.find((x) => x.id === original)?.status).toBe("reviewed");
  });
  it("merges only after a reason, preserves original records, joins sources and is idempotent", () => {
    let s = fixture();
    s = applyCommand(
      s,
      {
        type: "initiative.save",
        data: { ...initiative(), title: "유사 과제" },
        sourceIds: [],
      },
      runtime,
    );
    const [from, into] = s.initiatives;
    expect(() =>
      applyCommand(
        s,
        {
          type: "initiative.merge",
          fromId: from.id,
          intoId: into.id,
          reason: "",
        },
        runtime,
      ),
    ).toThrow();
    s = applyCommand(
      s,
      {
        type: "initiative.merge",
        fromId: from.id,
        intoId: into.id,
        reason: "중복 검토 후 승인",
      },
      runtime,
    );
    expect(s.initiatives).toHaveLength(2);
    expect(s.initiatives[0].mergedInto).toBe(into.id);
    expect(s.links).toContainEqual({
      sourceId: s.sources[0].id,
      initiativeId: into.id,
    });
    expect(
      applyCommand(
        s,
        {
          type: "initiative.merge",
          fromId: from.id,
          intoId: into.id,
          reason: "재실행",
        },
        runtime,
      ),
    ).toEqual(s);
    expect(queryInitiatives(s, {})).toHaveLength(1);
  });
  it("T20: collection/planning/target months are independent, inclusive range and unknown dates are explicit", () => {
    const s = fixture();
    expect(
      queryInitiatives(s, { role: "collected", month: "2026-11" }),
    ).toHaveLength(1);
    expect(
      queryInitiatives(s, { role: "planned", month: "2026-11" }),
    ).toHaveLength(0);
    expect(
      queryInitiatives(s, { role: "planned", month: "2026-12" }),
    ).toHaveLength(1);
    expect(
      queryInitiatives(s, {
        role: "target",
        fromMonth: "2026-11",
        toMonth: "2026-12",
      }),
    ).toHaveLength(1);
    expect(queryInitiatives(s, { role: "target", undated: true })).toHaveLength(
      0,
    );
    expect(() =>
      queryInitiatives(s, {
        role: "target",
        fromMonth: "2026-12",
        toMonth: "2026-11",
      }),
    ).toThrow();
  });
});

describe("atomic local persistence", () => {
  it("reloads exact saved records and refuses a stale tab write", () => {
    const store = memory(),
      first = loadLocal(store, runtime.session);
    const next = applyCommand(
      first.state,
      { type: "source.save", data: source },
      runtime,
    );
    const saved = commitLocal(store, first, next, runtime.session);
    expect(loadLocal(store, runtime.session).state).toEqual(next);
    expect(() => commitLocal(store, first, next, runtime.session)).toThrow();
    expect(saved.state.sources[0].rawText).toBe(source.rawText);
  });
  it("keeps saved bytes on quota errors or corrupt/foreign data; never silently resets", () => {
    const store = memory(),
      key = storageKey(runtime.session);
    store.values.set(key, "broken json");
    expect(() => loadLocal(store, runtime.session)).toThrow();
    expect(store.values.get(key)).toBe("broken json");
    store.values.clear();
    const first = loadLocal(store, runtime.session);
    const next = applyCommand(
      first.state,
      { type: "source.save", data: source },
      runtime,
    );
    const failure = {
      getItem: store.getItem,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => commitLocal(failure, first, next, runtime.session)).toThrow();
    expect(store.getItem(key)).toBeNull();
    expect(first.state.sources).toHaveLength(0);
  });
  it("refuses unknown versions/fields instead of stripping and overwriting them", () => {
    const store = memory(),
      key = storageKey(runtime.session);
    for (const extra of [
      { schemaVersion: 2 },
      { futurePlans: [{ important: "preserve" }] },
    ]) {
      const raw = JSON.stringify({ ...createState(runtime.session), ...extra });
      store.values.set(key, raw);
      expect(() => loadLocal(store, runtime.session)).toThrow();
      expect(store.getItem(key)).toBe(raw);
    }
  });
});

describe("v0.1 JSON preview and additive migration", () => {
  const legacy = [
    {
      id: 42,
      project: "Old Demo",
      month: "2026-11",
      title: "이전 과제",
      raw: "원문",
      hypothesis: "보존할 가설",
      beforeN: "0",
      beforeD: "100",
      kpi: "보존할 지표",
    },
  ];
  it("previews without writes, explicitly maps projects, preserves all original fields and deduplicates reruns", () => {
    const s = createState(runtime.session),
      text = JSON.stringify(legacy);
    const preview = previewLegacy(s, text, runtime.session);
    expect(preview.newRows).toBe(1);
    expect(s.initiatives).toHaveLength(0);
    expect(() => importLegacy(s, text, {}, runtime)).toThrow();
    const result = importLegacy(s, text, { "Old Demo": coach }, runtime);
    expect(result.initiatives[0].projectId).toBe(coach);
    expect(result.legacy[0].original).toEqual(legacy[0]);
    expect(previewLegacy(result, text, runtime.session).skippedRows).toBe(1);
    expect(importLegacy(result, text, { "Old Demo": coach }, runtime)).toEqual(
      result,
    );
  });
  it("rejects changed identities, mixed invalid rows and duplicate conflicting IDs atomically", () => {
    const s = importLegacy(
      createState(runtime.session),
      JSON.stringify(legacy),
      { "Old Demo": coach },
      runtime,
    );
    expect(() =>
      importLegacy(
        s,
        JSON.stringify([{ ...legacy[0], title: "수정" }]),
        { "Old Demo": coach },
        runtime,
      ),
    ).toThrow();
    expect(() =>
      importLegacy(
        s,
        JSON.stringify([...legacy, { id: 43, project: "" }]),
        { "Old Demo": coach },
        runtime,
      ),
    ).toThrow();
    expect(() =>
      importLegacy(
        s,
        JSON.stringify([...legacy, { ...legacy[0], title: "충돌" }]),
        { "Old Demo": coach },
        runtime,
      ),
    ).toThrow();
    expect(s.initiatives).toHaveLength(1);
  });
  it("creates an explicitly requested new project and deduplicates reordered input keys", () => {
    const initial = createState(runtime.session);
    const s = importLegacy(
      initial,
      JSON.stringify(legacy),
      { "Old Demo": "new" },
      runtime,
    );
    expect(s.workspace.projects).toHaveLength(4);
    expect(s.initiatives[0].projectId).toBe(s.workspace.projects[3].id);
    const reordered = [Object.fromEntries(Object.entries(legacy[0]).reverse())];
    expect(
      importLegacy(
        s,
        JSON.stringify(reordered),
        { "Old Demo": "new" },
        runtime,
      ),
    ).toEqual(s);
  });
});
