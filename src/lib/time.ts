import { z } from "zod";

const instantSchema = z.iso.datetime({ offset: true });

/** Calendar labels use project timezone; input must be an unambiguous ISO instant. */
export function projectMonth(instant: string, timezone: string): string {
  const value = instantSchema.parse(instant);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid instant");
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit" }).formatToParts(date);
  return parts.find(p => p.type === "year")!.value + "-" + parts.find(p => p.type === "month")!.value;
}
