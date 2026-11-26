import { workspaceSchema, type Workspace } from "./schema";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const clientId = "00000000-0000-4000-8000-000000000002";

// Deliberately invented names, UUIDs and examples. This is not a customer's workspace.
export const demoWorkspace = workspaceSchema.parse({
  id: workspaceId, mode: "synthetic", name: "개인 워크스페이스",
  clients: [{ id: clientId, workspaceId, name: "Demo Client" }],
  projects: [
    { id: "00000000-0000-4000-8000-000000000003", workspaceId, clientId, name: "Demo Coach", kind: "coach", timezone: "Asia/Seoul" },
    { id: "00000000-0000-4000-8000-000000000004", workspaceId, clientId, name: "Demo Survey", kind: "survey", timezone: "Asia/Seoul" },
    { id: "00000000-0000-4000-8000-000000000005", workspaceId, clientId: null, name: "Demo Independent", kind: "independent", timezone: "UTC" },
  ],
});

// Display scoping only. Production API ownership and database authorization arrive in Phase 1.
export function listProjects(data: Workspace, scope: { clientId?: string; projectId?: string } = {}) {
  return data.projects.filter(project =>
    (!scope.clientId || project.clientId === scope.clientId) &&
    (!scope.projectId || project.id === scope.projectId));
}
