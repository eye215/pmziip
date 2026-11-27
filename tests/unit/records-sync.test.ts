import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createState,
  type Runtime,
} from "../../src/features/records/model";
import { storageKey } from "../../src/features/records/persistence";
import {
  decide,
  readBundle,
  validateBundle,
} from "../../src/features/sync/model";
import { keepLocal, runSync, takeRemote } from "../../src/features/sync/engine";
import type { SyncConfig } from "../../src/features/sync/client";

// Synthetic records only. Runs the real Sync.gs in a VM behind a fake fetch.
const session = {
  mode: "synthetic" as const,
  ownerId: "00000000-0000-4000-8000-000000000010",
  workspaceId: "00000000-0000-4000-8000-000000000001",
};
const TOKEN = "t".repeat(64);
const URL_ =
  "https://script.google.com/macros/s/AKfyc" + "x".repeat(30) + "/exec";

function server() {
  const rows: unknown[][] = [];
  const props = new Map<string, string>([
    ["PMZIP_SYNC_TOKEN", TOKEN],
    ["PMZIP_SYNC_SHEET_ID", "sheet"],
  ]);
  const sheet = {
    getLastRow: () => rows.length,
    appendRow: (r: unknown[]) => void rows.push(r),
    deleteRow: (i: number) => void rows.splice(i - 1, 1),
    getRange: (r: number, c: number, nr: number, nc: number) => ({
      getValues: () =>
        rows.slice(r - 1, r - 1 + nr).map((x) => x.slice(c - 1, c - 1 + nc)),
      setNumberFormat() {
        return this;
      },
      setValues: (v: unknown[][]) => {
        v.forEach((x, i) => (rows[r - 1 + i] = x));
      },
    }),
  };
  const ctx: Record<string, unknown> = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => props.get(k) ?? null,
        setProperty: (k: string, v: string) => void props.set(k, v),
        deleteProperty: (k: string) => void props.delete(k),
      }),
    },
    LockService: {
      getScriptLock: () => ({ waitLock() {}, releaseLock() {} }),
    },
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: () => sheet,
        insertSheet: () => sheet,
      }),
    },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (t: string) => ({
        setMimeType: () => ({ text: t }),
      }),
    },
    Logger: { log() {} },
    Utilities: { getUuid: () => "00000000-0000-4000-8000-000000000000" },
  };
  vm.createContext(ctx);
  vm.runInContext(
    readFileSync("tools/apps-script/records-sync/Sync.gs", "utf8"),
    ctx,
  );
  const fetcher = (async (_url: string, init: RequestInit) => {
    const out = vm.runInContext(
      `doPost(${JSON.stringify({ postData: { contents: init.body } })})`,
      ctx,
    ) as { text: string };
    return new Response(out.text, { status: 200 });
  }) as typeof fetch;
  return { rows, fetcher };
}

function device() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    keys: () => [...m.keys()],
  };
}
let n = 0;
const runtime: Runtime = {
  session,
  now: () => "2026-11-27T01:00:00.000Z",
  id: () => `00000000-0000-4000-8000-${String(700 + n++).padStart(12, "0")}`,
};
function addSource(storage: ReturnType<typeof device>, title: string) {
  const raw = storage.getItem(storageKey(session));
  const st = raw ? JSON.parse(raw) : createState(session);
  const next = applyCommand(
    st,
    {
      type: "source.save",
      data: {
        title,
        rawText: `${title} 합성 원문`,
        sourceType: "manual",
        reference: "",
        collectedAt: "2026-11-20T01:00:00.000Z",
        requesterRole: "",
        sensitivity: "internal",
      },
    },
    runtime,
  );
  storage.setItem(storageKey(session), JSON.stringify(next));
}
const sha = async (t: string) => createHash("sha256").update(t).digest("hex");
const config = (): SyncConfig => ({
  url: URL_,
  token: TOKEN,
  lastRevision: null,
  lastHash: null,
  lastSyncAt: null,
  lastOk: null,
  lastResult: null,
});
const deps = (storage: ReturnType<typeof device>, fetcher: typeof fetch) => ({
  storage,
  session,
  fetcher,
  now: () => "2026-11-27T02:00:00.000Z",
  sha256: sha,
});

describe("records sync decisions", () => {
  it("is deterministic from revisions and hashes", () => {
    const s = { lastRevision: 3, lastHash: "a" };
    const d = (localHash: string, remoteRevision: number, remoteHash = "x") =>
      decide({
        state: s,
        localHash,
        localEmpty: false,
        remoteRevision,
        remoteHash,
      });
    expect(d("a", 3)).toBe("in_sync");
    expect(d("b", 3)).toBe("push");
    expect(d("a", 4)).toBe("pull");
    expect(d("b", 4)).toBe("conflict");
    expect(d("b", 4, "b")).toBe("in_sync");
    const first = (localEmpty: boolean, remoteRevision: number) =>
      decide({
        state: { lastRevision: null, lastHash: null },
        localHash: "l",
        localEmpty,
        remoteRevision,
        remoteHash: remoteRevision ? "r" : null,
      });
    expect(first(false, 0)).toBe("first_push");
    expect(first(true, 2)).toBe("first_pull");
    expect(first(false, 2)).toBe("conflict");
  });
});

describe("PC → sheet → phone (real Sync.gs)", () => {
  it("phone receives PC records; later edits flow both ways", async () => {
    if (!crypto.subtle) return;
    const { fetcher, rows } = server();
    const pc = device();
    const phone = device();
    addSource(pc, "PC 원문");
    let pcCfg = (await runSync(deps(pc, fetcher), config())).config;
    expect(pcCfg.lastRevision).toBe(1);
    expect(rows.length).toBeGreaterThan(1);

    const ph = await runSync(deps(phone, fetcher), config());
    expect(ph.decision).toBe("first_pull");
    expect(ph.changed).toContain("records");
    expect(phone.getItem(storageKey(session))).toBe(
      pc.getItem(storageKey(session)),
    );
    let phCfg = ph.config;

    addSource(phone, "휴대폰 원문");
    const up = await runSync(deps(phone, fetcher), phCfg);
    expect(up.decision).toBe("push");
    phCfg = up.config;
    const down = await runSync(deps(pc, fetcher), pcCfg);
    expect(down.decision).toBe("pull");
    pcCfg = down.config;
    expect(
      JSON.parse(pc.getItem(storageKey(session))!).sources.map(
        (s: { title: string }) => s.title,
      ),
    ).toEqual(["PC 원문", "휴대폰 원문"]);
    // The PC's previous text was kept before it was replaced.
    expect(pc.keys().some((k) => k.includes(":before-sync:"))).toBe(true);
  });

  it("both changed → conflict; nothing overwritten until the user picks", async () => {
    const { fetcher } = server();
    const pc = device();
    const phone = device();
    addSource(pc, "공통");
    const pcCfg = (await runSync(deps(pc, fetcher), config())).config;
    const phCfg = (await runSync(deps(phone, fetcher), config())).config;
    addSource(pc, "PC만");
    addSource(phone, "휴대폰만");
    expect((await runSync(deps(pc, fetcher), pcCfg)).decision).toBe("push");
    const before = phone.getItem(storageKey(session));
    const c = await runSync(deps(phone, fetcher), phCfg);
    expect(c.decision).toBe("conflict");
    expect(phone.getItem(storageKey(session))).toBe(before); // untouched
    // Keep the phone's version: pushed on top, the sheet keeps older revisions.
    const k = await keepLocal(deps(phone, fetcher), c.config);
    expect(k.decision).toBe("push");
    // PC had no new edits → takes it.
    const t = await takeRemote(deps(pc, fetcher), pcCfg);
    expect(t.decision).toBe("pull");
    expect(pc.getItem(storageKey(session))).toBe(before);
  });

  it("wrong token and damaged remote data are refused", async () => {
    const { fetcher } = server();
    const bad = await runSync(deps(device(), fetcher), {
      ...config(),
      token: "u".repeat(64),
    });
    expect(bad.decision).toBe("error");
    expect(bad.message).toContain("토큰");
    // A bundle holding another workspace's records is rejected.
    const pc = device();
    addSource(pc, "A");
    const b = readBundle(pc, session);
    const foreign = {
      ...b,
      items: {
        ...b.items,
        records: b.items.records!.replaceAll(
          session.workspaceId,
          "00000000-0000-4000-8000-000000000099",
        ),
      },
    };
    expect(() => validateBundle(foreign, session)).toThrow();
    expect(() => validateBundle({ ...b, format: "x" }, session)).toThrow();
    expect(validateBundle(b, session)).toEqual(b);
    // Coach DB aggregates travel too and are validated; older bundles load.
    const coach = JSON.stringify({
      schemaVersion: 1,
      ownerId: session.ownerId,
      workspaceId: session.workspaceId,
      calcVersion: "coach-db-1.0",
      generatedAt: "2026-11-27T00:00:00.000Z",
      inputHash: "c".repeat(64),
      files: [],
      config: {
        timeZone: "UTC",
        includeChannels: [],
        testChannels: [],
        includeDeleted: false,
      },
      global: [],
      country: [],
      version: [],
      quality: [],
    });
    expect(
      validateBundle({ ...b, items: { ...b.items, coachDb: coach } }, session)
        .items.coachDb,
    ).toBe(coach);
    expect(() =>
      validateBundle({ ...b, items: { ...b.items, coachDb: "{}" } }, session),
    ).toThrow();
    const { coachDb: _drop, rules: _drop2, ...older } = b.items;
    void _drop;
    void _drop2;
    expect(
      validateBundle({ ...b, items: older }, session).items.coachDb,
    ).toBeNull();
  });
});
