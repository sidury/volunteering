function asDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fmt(day: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(asDate(day));
}

export const longDate = (day: string) => fmt(day, { weekday: "long", month: "long", day: "numeric" });
export const shortDate = (day: string) => fmt(day, { month: "short", day: "numeric", year: "numeric" });

export function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function fmtHours(h: number): string {
  return `${Number(h.toFixed(2))} ${h === 1 ? "hour" : "hours"}`;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function timeRange(start: string | null, end: string | null): string {
  if (start && end) return `${fmtTime(start)} – ${fmtTime(end)}`;
  return start ? fmtTime(start) : "";
}
