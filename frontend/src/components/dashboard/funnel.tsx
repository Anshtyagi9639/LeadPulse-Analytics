"use client";

import { fmtInt, fmtPct } from "@/lib/format";
import type { FunnelStage } from "@/lib/types";

/** Funnel as horizontal bars on a shared scale; unavailable stages are listed, not drawn. */
export function Funnel({ stages }: { stages: FunnelStage[] }) {
  const max = Math.max(1, ...stages.map((s) => s.count ?? 0));
  return (
    <ol className="space-y-2" aria-label="Lead funnel">
      {stages.map((s) => (
        <li key={s.key} className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[140px_minmax(0,1fr)_150px]">
          <span className="text-sm font-medium">{s.label}</span>
          {s.available && s.count !== null ? (
            <>
              <div className="h-6 rounded-r bg-muted/50" title={`${s.label}: ${fmtInt(s.count)}`}>
                <div className="h-full rounded-r-[4px] bg-[color:var(--series-1)]" style={{ width: `${Math.max(0.5, (s.count / max) * 100)}%` }} />
              </div>
              <span className="col-start-2 text-xs tabular-nums text-muted-foreground sm:col-start-3">
                <span className="font-semibold text-foreground">{fmtInt(s.count)}</span> · {fmtPct(s.pctOfReceived)} of received
                {s.pctOfPrevious !== null && ` · ${fmtPct(s.pctOfPrevious)} of prev.`}
              </span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground italic sm:col-span-2">Not available — required columns are not mapped</span>
          )}
          {s.available && s.note && <span className="col-span-full -mt-1 text-xs text-muted-foreground sm:col-start-2">{s.note}</span>}
        </li>
      ))}
    </ol>
  );
}
