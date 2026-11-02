export const NA = "N/A";

export function fmtInt(v: number | null | undefined): string {
  return v === null || v === undefined ? NA : Math.round(v).toLocaleString("en-IN");
}

export function fmtPct(v: number | null | undefined, dp = 1): string {
  return v === null || v === undefined ? NA : `${v.toFixed(dp)}%`;
}

export function fmtMoney(v: number | null | undefined, currency = "INR"): string {
  if (v === null || v === undefined) return NA;
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: v >= 1000 ? 0 : 2 }).format(v);
  } catch {
    return `${currency} ${v.toLocaleString("en-IN")}`;
  }
}

export function fmtNum(v: number | null | undefined, dp = 1): string {
  return v === null || v === undefined ? NA : v.toLocaleString("en-IN", { maximumFractionDigits: dp });
}

export function fmtMinutes(v: number | null | undefined): string {
  if (v === null || v === undefined) return NA;
  if (v < 60) return `${Math.round(v)} min`;
  const h = Math.floor(v / 60);
  const m = Math.round(v % 60);
  return `${h}h ${m}m`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function fmtDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function duplicateModeLabel(m: string): string {
  return (
    {
      count_all: "Count all rows as submitted",
      exclude_duplicates: "Exclude confirmed duplicates",
      keep_latest: "Keep latest record",
      manual_review: "Review duplicates manually",
    } as Record<string, string>
  )[m] ?? m;
}

/** Time only when the timestamp is today, otherwise a short date and time. */
export function fmtTimeOrDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : fmtDateTime(iso);
}

/** Duration in ms as "850 ms", "4.2 s" or "1 min 5 s". */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/** Date + time with the local timezone abbreviation, e.g. "30 Oct, 09:32 IST". */
export function fmtStamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
}
