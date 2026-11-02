"use client";

import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)", "var(--series-7)", "var(--series-8)"];
const fmt = (n: number) => n.toLocaleString("en-IN");
const short = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const legendText = (v: string) => <span className="text-xs text-foreground">{v}</span>;

function Box({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">{children}</div>;
}

export function Empty({ text }: { text: string }) {
  return <p className="py-10 text-center text-sm text-muted-foreground">{text}</p>;
}

export interface SeriesDef {
  key: string;
  name: string;
  color?: string;
}

/** Horizontal bars by category with one or more series (grouped or stacked). Click a category to filter. */
export function MultiBar({ data, series, stacked = false, ariaLabel, onSelect, empty = "No data." }: { data: (Record<string, number | string> & { label: string })[]; series: SeriesDef[]; stacked?: boolean; ariaLabel: string; onSelect?: (label: string) => void; empty?: string }) {
  if (!data.length) return <Empty text={empty} />;
  const height = data.length * (stacked || series.length === 1 ? 34 : 22 * series.length + 14) + 60;
  return (
    <figure aria-label={ariaLabel}>
      <div style={{ height }} role="img" aria-label={`${ariaLabel}: ${data.map((d) => `${d.label} ${series.map((s) => `${s.name} ${d[s.key]}`).join(", ")}`).join("; ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }} barCategoryGap={8} barGap={2}>
            <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
            <XAxis type="number" allowDecimals={false} tick={{ fill: "var(--chart-axis)", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="label" width={150} tickFormatter={(v: string) => short(v)} tick={{ fill: "var(--foreground)", fontSize: 12 }} axisLine={{ stroke: "var(--chart-grid)" }} tickLine={false} />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.6 }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <Box>
                    <div className="mb-0.5 font-medium">{String(label)}</div>
                    {payload.map((p) => (
                      <div key={String(p.dataKey)} className="tabular-nums">
                        {p.name}: {fmt(Number(p.value))}
                      </div>
                    ))}
                    {onSelect && <div className="text-muted-foreground">Click to filter by this value</div>}
                  </Box>
                ) : null
              }
            />
            {series.length > 1 && <Legend formatter={legendText} iconType="square" />}
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.name}
                stackId={stacked ? "s" : undefined}
                fill={s.color ?? SERIES[i]}
                stroke="var(--chart-surface)"
                strokeWidth={stacked ? 2 : 0}
                radius={!stacked || i === series.length - 1 ? [0, 4, 4, 0] : 0}
                maxBarSize={22}
                isAnimationActive={false}
                className={onSelect ? "cursor-pointer" : undefined}
                onClick={(d) => onSelect?.((d as unknown as { payload: { label: string } }).payload.label)}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/** Proportions with a legend that lists every value (identity is never colour-only). */
export function Donut({ data, colors, ariaLabel, onSelect, empty = "No data." }: { data: { label: string; value: number }[]; colors?: string[]; ariaLabel: string; onSelect?: (label: string) => void; empty?: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return <Empty text={empty} />;
  const color = (i: number) => colors?.[i] ?? SERIES[i % SERIES.length];
  return (
    <figure aria-label={ariaLabel} className="grid items-center gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
      <div className="h-48" role="img" aria-label={`${ariaLabel}: ${data.map((d) => `${d.label} ${d.value}`).join("; ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius="58%" outerRadius="92%" paddingAngle={1} stroke="var(--chart-surface)" strokeWidth={2} isAnimationActive={false} onClick={(d) => onSelect?.((d as unknown as { label: string }).label)} className={onSelect ? "cursor-pointer" : undefined}>
              {data.map((d, i) => (
                <Cell key={d.label} fill={color(i)} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <Box>
                    <div className="font-medium">{String(payload[0].name)}</div>
                    <div className="tabular-nums">
                      {fmt(Number(payload[0].value))} ({((Number(payload[0].value) / total) * 100).toFixed(1)}%)
                    </div>
                  </Box>
                ) : null
              }
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="space-y-1 text-sm">
        {data.map((d, i) => (
          <li key={d.label}>
            <button type="button" disabled={!onSelect} onClick={() => onSelect?.(d.label)} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-muted disabled:hover:bg-transparent">
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: color(i) }} aria-hidden />
              <span className="flex-1 truncate">{d.label}</span>
              <span className="tabular-nums text-muted-foreground">{fmt(d.value)}</span>
              <span className="w-12 text-right tabular-nums text-muted-foreground">{((d.value / total) * 100).toFixed(0)}%</span>
            </button>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** Leads per day (dates on the x axis). */
export function DayLine({ data, ariaLabel }: { data: { date: string; leads: number }[]; ariaLabel: string }) {
  const pts = data.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date)).map((d) => ({ ...d, label: new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }) }));
  if (!pts.length) return <Empty text="No LAST WORKED dates to chart." />;
  return (
    <figure aria-label={ariaLabel}>
      <div className="h-56" role="img" aria-label={`${ariaLabel}: ${pts.map((p) => `${p.label} ${p.leads}`).join("; ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={pts} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="label" tick={{ fill: "var(--chart-axis)", fontSize: 11 }} axisLine={{ stroke: "var(--chart-grid)" }} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fill: "var(--chart-axis)", fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "3 3" }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <Box>
                    <div className="font-medium">{String(label)}</div>
                    <div className="tabular-nums">Leads last worked: {fmt(Number(payload[0].value))}</div>
                  </Box>
                ) : null
              }
            />
            <Line type="monotone" dataKey="leads" name="Leads" stroke="var(--series-1)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
