"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Facet } from "@/lib/types";

/** Multi-select filter with counts. Applies when the popover closes or Apply is pressed. */
export function FacetSelect({ label, facets, value, onChange, format = (v) => v }: { label: string; facets: Facet[]; value: string[]; onChange: (v: string[]) => void; format?: (v: string) => string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(value);
  const [filter, setFilter] = useState("");
  const change = (o: boolean) => {
    if (o) setDraft(value);
    setOpen(o);
    if (!o && JSON.stringify([...draft].sort()) !== JSON.stringify([...value].sort())) onChange(draft);
  };
  const shown = facets.filter((f) => !filter || format(f.value).toLowerCase().includes(filter.toLowerCase()));
  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Filter by ${label}`}>
          {label}
          {value.length > 0 && <Badge className="h-4 px-1.5 text-[10px]">{value.length}</Badge>}
          <ChevronDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        {facets.length > 8 && (
          <div className="border-b p-2">
            <Input placeholder={`Find ${label.toLowerCase()}…`} value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8" aria-label={`Find ${label}`} />
          </div>
        )}
        <div className="max-h-72 space-y-0.5 overflow-auto p-2">
          {shown.length === 0 && <p className="p-2 text-sm text-muted-foreground">No values.</p>}
          {shown.map((f) => (
            <Label key={f.value} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 font-normal hover:bg-muted">
              <Checkbox checked={draft.includes(f.value)} onCheckedChange={(c) => setDraft(c ? [...draft, f.value] : draft.filter((x) => x !== f.value))} />
              <span className="flex-1 truncate">{format(f.value) || "(blank)"}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{f.count.toLocaleString("en-IN")}</span>
            </Label>
          ))}
        </div>
        <div className="flex justify-between border-t p-2">
          <Button size="sm" variant="ghost" onClick={() => setDraft([])}>
            Clear
          </Button>
          <Button size="sm" onClick={() => change(false)}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
