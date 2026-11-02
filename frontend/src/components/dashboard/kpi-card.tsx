"use client";

import { Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: string;
  sub?: React.ReactNode;
  /** Definition shown in the tooltip. */
  help?: string;
  /** Why the metric is N/A, when it is. */
  unavailable?: string | null;
  className?: string;
}

export function KpiCard({ label, value, sub, help, unavailable, className }: Props) {
  const na = value === "N/A";
  return (
    <Card className={cn("gap-2 py-4", className)} data-testid="kpi-card">
      <CardContent className="space-y-1 px-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
          {(help || (na && unavailable)) && (
            <Tooltip>
              <TooltipTrigger className="rounded text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" aria-label={`About ${label}`}>
                <Info className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                {na && unavailable ? <p className="font-medium">Not available: {unavailable}</p> : null}
                {help && <p>{help}</p>}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className={cn("text-2xl font-semibold tabular-nums", na && "text-muted-foreground")}>{value}</div>
        {(sub || (na && unavailable)) && <div className="line-clamp-2 text-xs text-muted-foreground">{na && unavailable ? unavailable : sub}</div>}
      </CardContent>
    </Card>
  );
}
