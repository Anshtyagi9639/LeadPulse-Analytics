"use client";

import { ChevronDown, Filter, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { duplicateModeLabel } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSession } from "../session-provider";

function MultiSelect({ label, options, value, onApply }: { label: string; options: string[]; value: string[]; onApply: (v: string[]) => void }) {
  const [draft, setDraft] = useState<string[]>(value);
  const [open, setOpen] = useState(false);
  // Radix only reports user-initiated closes (Escape / outside click) via onOpenChange,
  // so the Apply button must go through the same path explicitly.
  const changeOpen = (o: boolean) => {
    setOpen(o);
    if (!o && JSON.stringify([...draft].sort()) !== JSON.stringify([...value].sort())) onApply(draft);
  };
  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          {label}
          {value.length > 0 && <Badge className="h-4 px-1.5 text-[10px]">{value.length}</Badge>}
          <ChevronDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="max-h-72 space-y-1 overflow-auto p-3">
          {options.length === 0 && <p className="text-sm text-muted-foreground">No values.</p>}
          {options.map((o) => (
            <Label key={o} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 font-normal hover:bg-muted">
              <Checkbox checked={draft.includes(o)} onCheckedChange={(c) => setDraft(c ? [...draft, o] : draft.filter((x) => x !== o))} />
              <span className="truncate">{o}</span>
            </Label>
          ))}
        </div>
        <div className="flex justify-between border-t p-2">
          <Button size="sm" variant="ghost" onClick={() => setDraft([])}>
            Clear
          </Button>
          <Button size="sm" onClick={() => changeOpen(false)}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Filters live in one row above the charts. They are stored on the session so exports use the same view. */
export function DashboardFilters() {
  const { session, report, run } = useSession();
  const filters = session?.settings.filters ?? { campaigns: [], sources: [] };
  const active = filters.campaigns.length + filters.sources.length > 0;
  if (!session || !report) return null;
  const options = report.filterOptions;
  const apply = (next: { campaigns: string[]; sources: string[] }) => run("Applying filters", (id) => api.updateSettings(id, { filters: next }));

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border bg-muted/30 px-3 py-2">
      <Filter className="size-4 text-muted-foreground" aria-hidden />
      <MultiSelect key={`c-${filters.campaigns.join("|")}`} label="Campaigns" options={options.campaigns} value={filters.campaigns} onApply={(campaigns) => apply({ ...filters, campaigns })} />
      <MultiSelect key={`s-${filters.sources.join("|")}`} label="Sources" options={options.sources} value={filters.sources} onApply={(sources) => apply({ ...filters, sources })} />
      {active && (
        <Button size="sm" variant="ghost" onClick={() => apply({ campaigns: [], sources: [] })}>
          <X data-icon="inline-start" />
          Clear filters
        </Button>
      )}
      <span className="ml-auto text-xs text-muted-foreground">
        {report.scope.leadFiles} lead file(s){report.scope.adFiles ? ` + ${report.scope.adFiles} ad-spend file(s)` : ""} · {duplicateModeLabel(report.settings.duplicateMode)}
        {report.settings.dateFilter === "restrict" ? " · reporting period only" : ""}
      </span>
    </div>
  );
}
