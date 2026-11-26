import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "../../docs/handoff-v1.1-manifest.json";
import trace from "../../docs/requirements-trace.json";

describe("handoff preservation and traceability", () => {
  it("preserves original prototype bytes", () => {
    const entry = manifest.find((x) => x.path === "reference/pmzip.html")!;
    expect(
      createHash("sha256").update(readFileSync(entry.path)).digest("hex"),
    ).toBe(entry.sha256);
  });
  it("maps every old and added requirement to its phase and test", () => {
    expect(trace.map((x) => x.id)).toEqual(
      Array.from(
        { length: 44 },
        (_, i) => `F${String(i + 1).padStart(2, "0")}`,
      ),
    );
    for (const row of trace) {
      expect(row.phase).toBeGreaterThanOrEqual(1);
      expect(row.tests.length).toBeGreaterThan(0);
      expect(["planned", "local-verified", "partial"]).toContain(row.status);
    }
    const tests = new Set(trace.flatMap((x) => x.tests));
    for (let i = 1; i <= 44; i++)
      expect(tests.has(`T${String(i).padStart(2, "0")}`)).toBe(true);
  });
});
