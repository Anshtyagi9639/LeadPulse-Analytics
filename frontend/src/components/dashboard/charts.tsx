"use client";

import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Report } from "@/lib/types";

const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)", "var(--series-7)", "var(--series-8)"];

function Box({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">{children}</div>;
}

const legendText = (v: string) => <span className="text-xs text-foreground">{v}</span>;

/** Leads (and qualified leads) over time — per hour for one day, per day for a range. */
export function TrendChart({ trend }: { trend: Report["trend"] }) {
  if (!trend.points.length) return <p className="py-10 text-center text-sm text-muted-foreground">No Lead Created Date{trend.granularity === "hour" ? " with a time of day" : ""} to chart.</p>;
  const label = (b: string) => (trend.granularity === "hour" ? `${b.slice(11, 16)}` : new Date(`${b}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }));
  const data = trend.points.map((p) => ({ ...p, label: label(p.bucket) }));
  return (
    <figure aria-label="Leads over time">
      <div className="h-64" role="img" aria-label={`Leads over time: ${data.map((d) => `${d.label} ${d.leads}`).join("; ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="label" tick={{ fill: "var(--chart-axis)", fontSize: 11 }} axisLine={{ stroke: "var(--chart-grid)" }} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fill: "var(--chart-axis)", fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "3 3" }}
              content={({ active, payload, label: l }) =>
                active && payload?.length ? (
                  <Box>
                    <div className="mb-0.5 font-medium">{trend.granularity === "hour" ? `${l} (local data time)` : l}</div>
                    {payload.map((p) => (
                      <div key={String(p.dataKey)} className="tabular-nums">
                        {p.name}: {Number(p.value).toLocaleString("en-IN")}
                      </div>
                    ))}
                  </Box>
                ) : null
              }
            />
            <Legend formatter={legendText} iconType="plainline" />
            <Line type="monotone" dataKey="leads" name="Leads" stroke="var(--series-1)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} isAnimationActive={false} />
            <Line type="monotone" dataKey="qualified" name="Qualified" stroke="var(--series-2)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {trend.undated > 0 && <figcaption className="mt-1 text-xs text-muted-foreground">{trend.undated.toLocaleString("en-IN")} lead(s) without a usable created time are not plotted.</figcaption>}
    </figure>
  );
}

/** Lead Status distribution. Click a slice to open those leads in the table. */
export function StatusDonut({ data, onSelect }: { data: Report["statusDistribution"]; onSelect?: (status: string) => void }) {
  if (!data.length) return <p className="py-10 text-center text-sm text-muted-foreground">Lead Status is not mapped in the processed files.</p>;
  const total = data.reduce((s, d) => s + d.leads, 0);
  const color = (i: number, status: string) => (status === "Other" ? "var(--series-other)" : SERIES[i % SERIES.length]);
  return (
    <figure aria-label="Lead status distribution" className="grid items-center gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
      <div className="h-52" role="img" aria-label={`Lead status: ${data.map((d) => `${d.status} ${d.leads}`).join("; ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="leads" nameKey="status" innerRadius="58%" outerRadius="92%" paddingAngle={1} stroke="var(--chart-surface)" strokeWidth={2} isAnimationActive={false} onClick={(d) => onSelect?.((d as unknown as { status: string }).status)} className={onSelect ? "cursor-pointer" : undefined}>
              {data.map((d, i) => (
                <Cell key={d.status} fill={color(i, d.status)} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <Box>
                    <div className="font-medium">{String(payload[0].name)}</div>
                    <div className="tabular-nums">
                      {Number(payload[0].value).toLocaleString("en-IN")} leads ({((Number(payload[0].value) / total) * 100).toFixed(1)}%)
                    </div>
                    {onSelect && <div className="text-muted-foreground">Click to view these leads</div>}
                  </Box>
                ) : null
              }
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="space-y-1 text-sm">
        {data.map((d, i) => (
          <li key={d.status}>
            <button type="button" disabled={!onSelect || d.status === "Other"} onClick={() => onSelect?.(d.status)} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-muted disabled:hover:bg-transparent">
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: color(i, d.status) }} aria-hidden />
              <span className="flex-1 truncate">{d.status}</span>
              <span className="tabular-nums text-muted-foreground">{d.leads.toLocaleString("en-IN")}</span>
              <span className="w-12 text-right tabular-nums text-muted-foreground">{((d.leads / total) * 100).toFixed(0)}%</span>
            </button>
          </li>
        ))}
      </ul>
    </figure>
  );
}

export interface FileQualityDatum {
  fileId: string;
  fileName: string;
  valid: number;
  duplicate: number;
  invalid: number;
}

/** Valid / duplicate / invalid records per file. Status colours are reserved for these states and always labelled. */
export function FileQualityChart({ data, onSelect }: { data: FileQualityDatum[]; onSelect?: (fileId: string, status: "valid" | "duplicate" | "invalid") => void }) {
  if (!data.length) return <p className="py-10 text-center text-sm text-muted-foreground">No lead files to compare.</p>;
  const short = (s: string) => (s.length > 28 ? `${s.slice(0, 27)}…` : s);
  const height = data.length * 40 + 60;
  const segs = [
    { key: "valid", name: "Valid", color: "var(--status-good)" },
    { key: "duplicate", name: "Duplicate", color: "var(--status-warning)" },
    { key: "invalid", name: "Invalid", color: "var(--status-critical)" },
  ] as const;
  return (
    <figure aria-label="Record quality by file">
      <div style={{ height }} role="img" aria-label={`Record quality by file: ${data.map((d) => `${d.fileName}: ${d.valid} valid, ${d.duplicate} duplicate, ${d.invalid} invalid`).join("; ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }} barCategoryGap={10}>
            <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
            <XAxis type="number" allowDecimals={false} tick={{ fill: "var(--chart-axis)", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="fileName" width={190} tickFormatter={short} tick={{ fill: "var(--foreground)", fontSize: 12 }} axisLine={{ stroke: "var(--chart-grid)" }} tickLine={false} />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.6 }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <Box>
                    <div className="mb-0.5 font-medium">{String(label)}</div>
                    {payload.map((p) => (
                      <div key={String(p.dataKey)} className="tabular-nums">
                        {p.name}: {Number(p.value).toLocaleString("en-IN")}
                      </div>
                    ))}
                    {onSelect && <div className="text-muted-foreground">Click a segment to view those records</div>}
                  </Box>
                ) : null
              }
            />
            <Legend formatter={legendText} iconType="square" />
            {segs.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.name}
                stackId="q"
                fill={s.color}
                stroke="var(--chart-surface)"
                strokeWidth={2}
                maxBarSize={24}
                radius={i === segs.length - 1 ? [0, 4, 4, 0] : 0}
                isAnimationActive={false}
                className={onSelect ? "cursor-pointer" : undefined}
                onClick={(d) => onSelect?.((d as unknown as { payload: FileQualityDatum }).payload.fileId, s.key)}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
