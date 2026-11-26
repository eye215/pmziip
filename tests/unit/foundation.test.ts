import { describe, expect, it } from "vitest";
import { demoWorkspace, listProjects } from "../../src/lib/demo";
import { workspaceSchema } from "../../src/lib/schema";
import { projectMonth } from "../../src/lib/time";
import { coachDefinition } from "../../src/lib/connectors/coach-definition";

describe("synthetic foundation (not production authorization)", () => {
  it("has synthetic Coach/Survey and independent projects with stable UUIDs", () => {
    const data = workspaceSchema.parse(demoWorkspace);
    expect(data.mode).toBe("synthetic");
    expect(data.projects.map((p) => p.kind)).toEqual([
      "coach",
      "survey",
      "independent",
    ]);
    expect(data.projects[0].id).not.toBe(data.projects[1].id);
    expect(listProjects(data, { clientId: data.clients[0].id })).toHaveLength(
      2,
    );
    expect(listProjects(data, { projectId: data.projects[1].id })).toEqual([
      data.projects[1],
    ]);
    expect(listProjects(data, { projectId: "missing" })).toEqual([]);
  });
  it("rejects duplicate IDs and cross-workspace/group relationships", () => {
    const duplicate = structuredClone(demoWorkspace);
    duplicate.projects.push(duplicate.projects[0]);
    expect(workspaceSchema.safeParse(duplicate).success).toBe(false);
    const foreign = structuredClone(demoWorkspace);
    foreign.projects[0].workspaceId = "00000000-0000-4000-8000-000000000099";
    expect(workspaceSchema.safeParse(foreign).success).toBe(false);
    foreign.projects[0].workspaceId = foreign.id;
    foreign.projects[0].clientId = "00000000-0000-4000-8000-000000000099";
    expect(workspaceSchema.safeParse(foreign).success).toBe(false);
  });
  it("filters by identity without changing seed values", () => {
    const before = structuredClone(demoWorkspace);
    listProjects(demoWorkspace, { clientId: "missing" });
    expect(demoWorkspace).toEqual(before);
    const renamed = structuredClone(demoWorkspace);
    renamed.projects[0].name = "Renamed demo";
    expect(
      listProjects(renamed, { projectId: renamed.projects[0].id })[0].id,
    ).toBe(before.projects[0].id);
  });
});

describe("UTC storage / project calendar month", () => {
  it.each([
    ["2026-11-30T14:59:59Z", "Asia/Seoul", "2026-11"],
    ["2026-11-30T15:00:00Z", "Asia/Seoul", "2026-12"],
    ["2027-01-01T00:00:00Z", "America/New_York", "2026-12"],
    ["2026-03-08T07:00:00Z", "America/New_York", "2026-03"],
  ])("maps %s in %s to %s", (instant, zone, month) => {
    expect(projectMonth(instant, zone)).toBe(month);
  });
  it("rejects invalid or ambiguous dates and timezones", () => {
    for (const date of ["bad", "2026-11-30T15:00:00", "2026-02-30T00:00:00Z"]) {
      expect(() => projectMonth(date, "Asia/Seoul")).toThrow();
    }
    expect(() => projectMonth("2026-11-30T15:00:00Z", "bad/zone")).toThrow();
  });
});

describe("Galaxy Coach v1.2 metric definition (no API adapter yet)", () => {
  it("uses REPORT for both completion metrics and keeps valid scores distinct", () => {
    expect(coachDefinition.done.eventName).toBe("GALAXY_COACH_REPORT");
    expect(coachDefinition.done.metrics).toEqual(["totalUsers", "eventCount"]);
    expect(coachDefinition.score.eventName).toBe("GALAXY_COACH_REPORT");
    expect(coachDefinition.score.allowedValues).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
    expect(coachDefinition.doneCountSource).toBe("reportEventCount");
    expect(coachDefinition.validScoreCountSource).toBe("scoreEventCount");
    expect(coachDefinition.uniqueUsersPolicy).toBe(
      "query-period-total-separately",
    );
  });
});
