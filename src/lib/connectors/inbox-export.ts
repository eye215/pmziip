import { z } from "zod";

/**
 * File written by tools/apps-script/coach-ga-export/Inbox.gs and downloaded
 * from the private web app (access: only me). Message bodies are sensitive:
 * the file is never put in a link-shared sheet; PM.zip keeps it in this
 * browser only. Sender is reduced to a domain (no names or addresses).
 */
export const INBOX_FORMAT = "pmzip.inbox-export";
const item = z
  .object({
    channel: z.enum(["gmail", "calendar", "slack"]),
    externalId: z.string().min(1).max(300),
    title: z.string().max(300),
    body: z.string().max(20000),
    fromDomain: z.string().max(200).nullable(),
    receivedAt: z.iso.datetime({ offset: true }),
    link: z
      .string()
      .max(2000)
      .refine((s) => /^https:\/\//.test(s), "https 링크여야 합니다."),
  })
  .strict();
export const inboxExportSchema = z
  .object({
    format: z.literal(INBOX_FORMAT),
    formatVersion: z.literal(1),
    generatedAt: z.iso.datetime({ offset: true }),
    generator: z
      .object({ name: z.string().max(100), version: z.string().max(40) })
      .strict(),
    query: z
      .object({
        gmailLabel: z.string().max(200).nullable(),
        calendarDays: z.number().int().nullable(),
      })
      .strict(),
    // Gmail ≤300 + calendar ≤100 + Slack ≤300 per export (Inbox.gs caps).
    items: z.array(item).max(1000),
  })
  .strict();
export type InboxExport = z.infer<typeof inboxExportSchema>;
export type InboxItem = InboxExport["items"][number];

export function parseInboxExport(text: string): InboxExport {
  if (new TextEncoder().encode(text).byteLength > 5_000_000)
    throw new Error("파일은 5MB 이하여야 합니다.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("JSON 형식이 아닙니다.");
  }
  return inboxExportSchema.parse(raw);
}
