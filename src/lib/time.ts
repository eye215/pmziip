import { z } from "zod";

const instantSchema = z.iso.datetime({ offset: true });

/** Calendar labels use project timezone; input must be an unambiguous ISO instant. */
export function projectMonth(instant: string, timezone: string): string {
  const value = instantSchema.parse(instant);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid instant");
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  return (
    parts.find((p) => p.type === "year")!.value +
    "-" +
    parts.find((p) => p.type === "month")!.value
  );
}

/** Form display uses the device's local zone; storage retains explicit UTC instants. */
export function localDateTime(instant: string): string {
  const date = new Date(instantSchema.parse(instant)),
    pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function instantFromLocal(
  value: string,
  original?: string | null,
): string | null {
  if (!value) return null;
  if (original && localDateTime(original) === value) return original;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("날짜와 시간을 확인해 주세요.");
  const date = new Date(value);
  if (
    !Number.isFinite(date.getTime()) ||
    localDateTime(date.toISOString()) !== value
  )
    throw new Error("해당 시간대에 존재하지 않는 날짜 또는 시간입니다.");
  return date.toISOString();
}
