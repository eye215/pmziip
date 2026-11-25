import { z } from "zod";

const id = z.uuid();
const clientSchema = z.object({ id, workspaceId: id, name: z.string().min(1) });
const projectSchema = z.object({
  id, workspaceId: id, clientId: id.nullable(), name: z.string().min(1),
  kind: z.enum(["coach", "survey", "independent"]),
  timezone: z.string().refine(value => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
  }, "Invalid IANA timezone"),
});

export const workspaceSchema = z.object({
  id, mode: z.literal("synthetic"), name: z.string().min(1),
  clients: z.array(clientSchema), projects: z.array(projectSchema),
}).superRefine((data, ctx) => {
  const ids = [data.id, ...data.clients.map(x => x.id), ...data.projects.map(x => x.id)];
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Duplicate entity identity" });
  for (const client of data.clients) if (client.workspaceId !== data.id) {
    ctx.addIssue({ code: "custom", message: "Client belongs to another workspace" });
  }
  for (const project of data.projects) {
    if (project.workspaceId !== data.id || (project.clientId !== null && !data.clients.some(c => c.id === project.clientId))) {
      ctx.addIssue({ code: "custom", message: "Project relationship leaves workspace" });
    }
  }
});

export type Workspace = z.infer<typeof workspaceSchema>;
export type Project = Workspace["projects"][number];
