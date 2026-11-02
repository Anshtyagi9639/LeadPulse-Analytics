"use client";

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface BarDatum {
  label: string;
  value: number | null;
  /** Extra lines for the tooltip. */
  detail?: string[];
}

interface Props {
  data: BarDatum[];
  format: (v: number) => string;
  /** Accessible description of what the chart shows. */
  ariaLabel: string;
  maxBars?: number;
  emptyText?: string;
  /** Show the formatted value at the end of each bar (selective direct labels). */
  showValues?: boolean;
  /** Called with the bar's label when a bar is clicked (e.g. to filter the lead table). */
  onSelect?: (label: string) => void;
}

const truncate = (s: string, n = 26) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function ChartTooltip({ active, payload, format }: { active?: boolean; payload?: { payload: BarDatum }[]; format: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="mb-0.5 font-medium">{d.label}</div>
      <div className="tabular-nums">{d.value === null ? "N/A" : format(d.value)}</div>
      {d.detail?.map((l) => (
        <div key={l} className="text-muted-foreground">
          {l}
        </div>
      ))}
    </div>
  );
}

/** Single-series horizontal bar chart (magnitude by category). Bars without a value are omitted and noted. */
export function HBarChart({ data, format, ariaLabel, maxBars = 12, emptyText = "No data to chart.", showValues = true, onSelect }: Props) {
  const withValue = data.filter((d): d is BarDatum & { value: number } => d.value !== null);
  const shown = withValue.slice(0, maxBars);
  const omitted = data.length - withValue.length;
  if (!shown.length) return <p className="py-10 text-center text-sm text-muted-foreground">{emptyText}</p>;
  const height = shown.length * 34 + 28;
  return (
    <figure aria-label={ariaLabel} className="w-full">
      <div style={{ height }} role="img" aria-label={`${ariaLabel}: ${shown.map((d) => `${d.label} ${format(d.value)}`).join("; ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={shown} layout="vertical" margin={{ top: 4, right: showValues ? 72 : 16, bottom: 4, left: 8 }} barCategoryGap={8}>
            <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
            <XAxis type="number" tickFormatter={(v: number) => format(v)} tick={{ fill: "var(--chart-axis)", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis
              type="category"
              dataKey="label"
              width={170}
              tickFormatter={(v: string) => truncate(v)}
              tick={{ fill: "var(--foreground)", fontSize: 12 }}
              axisLine={{ stroke: "var(--chart-grid)" }}
              tickLine={false}
            />
            <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={<ChartTooltip format={format} />} />
            <Bar dataKey="value" fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false} className={onSelect ? "cursor-pointer" : undefined} onClick={(d) => onSelect?.((d as unknown as { payload: BarDatum }).payload.label)}>
              {showValues && <LabelList dataKey="value" position="right" formatter={(v: unknown) => format(Number(v))} style={{ fill: "var(--muted-foreground)", fontSize: 11 }} />}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {onSelect && <p className="mt-1 text-xs text-muted-foreground">Click a bar to open those leads in the lead table.</p>}
      {(withValue.length > maxBars || omitted > 0) && (
        <figcaption className="mt-1 text-xs text-muted-foreground">
          {withValue.length > maxBars && `Top ${maxBars} of ${withValue.length} shown. `}
          {omitted > 0 && `${omitted} item(s) have no value (N/A) and are not charted.`}
        </figcaption>
      )}
    </figure>
  );
}
