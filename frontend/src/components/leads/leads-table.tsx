"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Download, Loader2, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api, downloadPost, timezoneLabel } from "@/lib/api";
import type { LeadFlag, LeadQuery, LeadRow, LeadsResponse, LeadStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, useSession } from "../session-provider";
import { FacetSelect } from "./facet-select";
import { FLAG_LABEL, FlagList, STATUS_LABEL, StatusBadge } from "./status";

const PAGE_SIZES = [10, 25, 50, 100, 250];
type Col = { id: string; label: string; kind: "std" | "orig" };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function cellValue(r: LeadRow, c: Col): string {
  return (c.kind === "std" ? r.std[c.id] : r.original[c.id]) ?? "";
}

function DetailSheet({ row, columns, onClose }: { row: LeadRow; columns: LeadsResponse["columns"]; onClose: () => void }) {
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>
            {row.fileName} · row {row.rowNumber}
          </SheetTitle>
          <SheetDescription>Cleaned values are normalised for matching and reporting; original values are exactly as uploaded and are never changed.</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4 pb-6 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={row.status} />
            {row.excludedFromReport && row.status !== "invalid" && <Badge variant="secondary">Excluded from report totals</Badge>}
          </div>
          {row.rejectReason && <p className="text-[color:var(--status-critical)]">Rejected: {row.rejectReason}</p>}
          {row.flags.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Data-quality flags</h3>
              <ul className="list-disc pl-5">
                {row.flags.map((f) => (
                  <li key={f}>{FLAG_LABEL[f]}</li>
                ))}
              </ul>
            </div>
          )}
          {(row.duplicateGroupId || row.alsoIn.length > 0) && (
            <div>
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Matching</h3>
              {row.duplicateGroupId && <p>Duplicate group {row.duplicateGroupId} · matched on {row.matchedOn.join(", ") || "—"}</p>}
              {row.alsoIn.length > 0 && <p>Also found in: {row.alsoIn.join(", ")}</p>}
            </div>
          )}
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Cleaned (standard schema)</h3>
              <dl className="divide-y rounded-lg border">
                {columns.standard
                  .filter((c) => row.std[c.key])
                  .map((c) => (
                    <div key={c.key} className="grid grid-cols-[120px_1fr] gap-2 px-3 py-1.5">
                      <dt className="text-muted-foreground">{c.label}</dt>
                      <dd className="break-words">{row.std[c.key]}</dd>
                    </div>
                  ))}
              </dl>
            </div>
            <div>
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Original values</h3>
              <dl className="divide-y rounded-lg border">
                {Object.entries(row.original).map(([h, v]) => (
                  <div key={h} className="grid grid-cols-[120px_1fr] gap-2 px-3 py-1.5">
                    <dt className="truncate text-muted-foreground" title={h}>
                      {h}
                    </dt>
                    <dd className="break-words">{v || <span className="text-muted-foreground">(blank)</span>}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function LeadsTable() {
  const { session, leadFilter, setLeadFilter } = useSession();
  const readyLeadFiles = useMemo(() => (session?.files ?? []).filter((f) => f.status === "ready" && f.kind === "leads"), [session?.files]);
  // A chart click can hand a filter to the table; it is consumed once on mount.
  const [initial] = useState<LeadQuery>(() => leadFilter ?? {});
  const [mode, setMode] = useState<"combined" | "file">(initial.fileIds?.length === 1 ? "file" : "combined");
  const [fileId, setFileId] = useState<string>(initial.fileIds?.[0] ?? readyLeadFiles[0]?.id ?? "");
  const [scope, setScope] = useState<"report" | "all">("report");
  const [search, setSearch] = useState(initial.search ?? "");
  const [filters, setFilters] = useState<LeadQuery>({ ...initial, fileIds: undefined, search: undefined });
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "file", dir: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<LeadsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showOriginal, setShowOriginal] = useState(false);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<LeadRow | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const debouncedSearch = useDebounced(search, 300);
  const consumed = useRef(false);

  useEffect(() => {
    if (!consumed.current && leadFilter) {
      consumed.current = true;
      setTimeout(() => setLeadFilter(null), 0);
    }
  }, [leadFilter, setLeadFilter]);

  const reportFileIds = useMemo(() => session?.report.fileIds ?? [], [session?.report.fileIds]);
  const fileIds = useMemo(() => {
    if (mode === "file") return fileId ? [fileId] : [];
    if (scope === "all" || !reportFileIds.length) return readyLeadFiles.map((f) => f.id);
    return reportFileIds;
  }, [mode, fileId, scope, reportFileIds, readyLeadFiles]);

  const query: LeadQuery = useMemo(
    () => ({ ...filters, search: debouncedSearch || undefined, fileIds, sort: sort.key, dir: sort.dir }),
    [filters, debouncedSearch, fileIds, sort],
  );
  const version = `${session?.report.lastProcessedAt}|${session?.files.map((f) => f.validation?.validatedAt).join(",")}|${session?.settings.duplicateMode}|${JSON.stringify(session?.settings.matchRules)}|${session?.duplicateDecisionCount}`;
  const sessionId = session?.id;

  useEffect(() => {
    if (!sessionId || !fileIds.length) return;
    let cancelled = false;
    api
      .leads(sessionId, { ...query, page, pageSize })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, query, page, pageSize, version, fileIds.length]);

  const columns: Col[] = useMemo(() => {
    if (!data) return [];
    const std: Col[] = data.columns.standard.map((c) => ({ id: c.key, label: c.label, kind: "std" }));
    const orig: Col[] = data.columns.original.map((h) => ({ id: h, label: h, kind: "orig" }));
    return showOriginal ? orig : std;
  }, [data, showOriginal]);
  const visible = columns.filter((c) => !hidden.has(`${c.kind}:${c.id}`));

  const setFilter = (patch: Partial<LeadQuery>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };
  const activeChips: { label: string; clear: () => void }[] = [];
  const chip = (key: keyof LeadQuery, label: string, values: string[] | undefined, fmt: (v: string) => string = (v) => v) => {
    if (values?.length) activeChips.push({ label: `${label}: ${values.map(fmt).join(", ")}`, clear: () => setFilter({ [key]: undefined }) });
  };
  chip("statuses", "Status", filters.statuses, (v) => STATUS_LABEL[v as LeadStatus]);
  chip("flags", "Quality", filters.flags, (v) => FLAG_LABEL[v as LeadFlag]);
  chip("sources", "Source", filters.sources);
  chip("campaigns", "Campaign", filters.campaigns);
  chip("leadStatuses", "Lead status", filters.leadStatuses);
  chip("owners", "Owner", filters.owners);
  chip("stages", "Stage", filters.stages);
  chip("dispositions", "Disposition", filters.dispositions);
  chip("followUp", "Follow-up", filters.followUp);
  if (filters.dateFrom || filters.dateTo) activeChips.push({ label: `Created ${filters.dateFrom ?? "…"} – ${filters.dateTo ?? "…"}`, clear: () => setFilter({ dateFrom: undefined, dateTo: undefined }) });
  if (filters.presence && filters.presence !== "all")
    activeChips.push({ label: filters.presence === "unique_to_file" ? "Only in one file" : "In several files", clear: () => setFilter({ presence: undefined }) });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;
  const pageUids = data?.rows.map((r) => r.uid) ?? [];
  const allOnPage = pageUids.length > 0 && pageUids.every((u) => selected.has(u));

  const doExport = async (kind: "filtered" | "selected", format: "csv" | "xlsx") => {
    if (!session) return;
    const key = `${kind}-${format}`;
    setExporting(key);
    try {
      const name = await downloadPost(`/sessions/${session.id}/export/leads`, {
        format,
        variant: "both",
        query: { ...query, sort: sort.key, dir: sort.dir },
        uids: kind === "selected" ? [...selected] : undefined,
        stdColumns: data?.columns.standard.map((c) => c.key).filter((k) => !hidden.has(`std:${k}`)),
        originalColumns: data?.columns.original.filter((h) => !hidden.has(`orig:${h}`)),
        timezoneLabel: timezoneLabel(),
      });
      toast.success(`Downloaded ${name}`);
    } catch (e) {
      toast.error(errorMessage(e), { action: { label: "Retry", onClick: () => void doExport(kind, format) } });
    } finally {
      setExporting(null);
    }
  };

  const startResize = (id: string, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).parentElement!;
    const startX = e.clientX;
    const startW = th.getBoundingClientRect().width;
    const move = (ev: PointerEvent) => setWidths((w) => ({ ...w, [id]: Math.max(70, Math.round(startW + ev.clientX - startX)) }));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const sortHead = (id: string, label: string, className?: string) => {
    const active = sort.key === id;
    const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
      <th key={id} className={cn("relative h-9 border-b bg-muted/60 px-2 text-left text-xs font-medium whitespace-nowrap", className)} style={widths[id] ? { width: widths[id], minWidth: widths[id], maxWidth: widths[id] } : undefined} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" className="inline-flex max-w-full items-center gap-1 truncate hover:text-foreground" onClick={() => setSort({ key: id, dir: active && sort.dir === "asc" ? "desc" : "asc" })}>
          <span className="truncate">{label}</span>
          <Icon className={cn("size-3 shrink-0", !active && "opacity-40")} aria-hidden />
        </button>
        <span role="separator" aria-orientation="vertical" aria-label={`Resize ${label}`} onPointerDown={(e) => startResize(id, e)} className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40" />
      </th>
    );
  };

  if (!session) return null;
  if (!readyLeadFiles.length) return <p className="py-10 text-center text-sm text-muted-foreground">Upload a lead file and complete its column mapping to see lead records.</p>;

  return (
    <div className="space-y-3">
      {/* View & scope */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border p-0.5" role="tablist" aria-label="Report view">
          {(["combined", "file"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={cn("rounded-md px-3 py-1 text-sm", mode === m ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
              onClick={() => {
                setMode(m);
                setPage(1);
                setSelected(new Set());
              }}
            >
              {m === "combined" ? "Combined report" : "File-by-file report"}
            </button>
          ))}
        </div>
        {mode === "file" ? (
          <Select
            value={fileId}
            onValueChange={(v) => {
              setFileId(v);
              setPage(1);
              setSelected(new Set());
            }}
          >
            <SelectTrigger className="w-72" aria-label="File">
              <SelectValue placeholder="Choose a file" />
            </SelectTrigger>
            <SelectContent>
              {readyLeadFiles.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          reportFileIds.length > 0 &&
          readyLeadFiles.length > reportFileIds.length && (
            <Select
              value={scope}
              onValueChange={(v) => {
                setScope(v as "report" | "all");
                setPage(1);
              }}
            >
              <SelectTrigger className="w-64" aria-label="Files included">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="report">Files in the current report</SelectItem>
                <SelectItem value="all">All uploaded lead files</SelectItem>
              </SelectContent>
            </Select>
          )
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {data ? `${data.total.toLocaleString("en-IN")} of ${data.totalUnfiltered.toLocaleString("en-IN")} records` : ""}
          {selected.size > 0 && ` · ${selected.size} selected`}
        </span>
      </div>

      {mode === "file" && data && (
        <div className="flex flex-wrap gap-2 text-xs">
          {data.facets.statuses.map((s) => (
            <span key={s.value} className="rounded-md border px-2 py-1">
              {STATUS_LABEL[s.value as LeadStatus]}: <span className="font-semibold tabular-nums">{s.count.toLocaleString("en-IN")}</span>
            </span>
          ))}
        </div>
      )}

      {/* Toolbar: search, filters, columns, export */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/30 p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search name, phone, email, campaign…"
            className="h-8 w-64 pl-8"
            aria-label="Search leads"
          />
        </div>
        {data && (
          <>
            <FacetSelect label="Status" facets={data.facets.statuses} value={filters.statuses ?? []} onChange={(v) => setFilter({ statuses: v as LeadStatus[] })} format={(v) => STATUS_LABEL[v as LeadStatus] ?? v} />
            <FacetSelect label="Data quality" facets={data.facets.flags} value={filters.flags ?? []} onChange={(v) => setFilter({ flags: v as LeadFlag[] })} format={(v) => FLAG_LABEL[v as LeadFlag] ?? v} />
            <FacetSelect label="Source" facets={data.facets.sources} value={filters.sources ?? []} onChange={(v) => setFilter({ sources: v })} />
            <FacetSelect label="Campaign" facets={data.facets.campaigns} value={filters.campaigns ?? []} onChange={(v) => setFilter({ campaigns: v })} />
            <FacetSelect label="Lead status" facets={data.facets.leadStatuses} value={filters.leadStatuses ?? []} onChange={(v) => setFilter({ leadStatuses: v })} />
            <FacetSelect label="Owner" facets={data.facets.owners} value={filters.owners ?? []} onChange={(v) => setFilter({ owners: v })} />
            <FacetSelect label="Stage" facets={data.facets.stages} value={filters.stages ?? []} onChange={(v) => setFilter({ stages: v })} />
            <FacetSelect label="Disposition" facets={data.facets.dispositions} value={filters.dispositions ?? []} onChange={(v) => setFilter({ dispositions: v })} />
            <FacetSelect label="Follow-up" facets={data.facets.followUp} value={filters.followUp ?? []} onChange={(v) => setFilter({ followUp: v as LeadQuery["followUp"] })} format={(v) => ({ overdue: "Overdue", upcoming: "On/after report date", none: "No follow-up date" })[v] ?? v} />
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  Date & files
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="lf-from">Created from</Label>
                    <Input id="lf-from" type="date" value={filters.dateFrom ?? ""} onChange={(e) => setFilter({ dateFrom: e.target.value || undefined })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="lf-to">Created to</Label>
                    <Input id="lf-to" type="date" value={filters.dateTo ?? ""} onChange={(e) => setFilter({ dateTo: e.target.value || undefined })} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Found in</Label>
                  <Select value={filters.presence ?? "all"} onValueChange={(v) => setFilter({ presence: v === "all" ? undefined : (v as LeadQuery["presence"]) })}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any file</SelectItem>
                      <SelectItem value="unique_to_file">Only one file (missing from the others)</SelectItem>
                      <SelectItem value="in_multiple_files">Several files (matching leads)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </PopoverContent>
            </Popover>
          </>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns3 data-icon="inline-start" />
                Columns
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
              <div className="flex gap-1 border-b p-2">
                <Button size="xs" variant={showOriginal ? "outline" : "default"} onClick={() => setShowOriginal(false)}>
                  Cleaned values
                </Button>
                <Button size="xs" variant={showOriginal ? "default" : "outline"} onClick={() => setShowOriginal(true)}>
                  Original columns
                </Button>
              </div>
              <div className="max-h-80 space-y-0.5 overflow-auto p-2">
                {columns.map((c) => {
                  const k = `${c.kind}:${c.id}`;
                  return (
                    <Label key={k} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 font-normal hover:bg-muted">
                      <Checkbox
                        checked={!hidden.has(k)}
                        onCheckedChange={(on) =>
                          setHidden((h) => {
                            const n = new Set(h);
                            if (on) n.delete(k);
                            else n.add(k);
                            return n;
                          })
                        }
                      />
                      <span className="truncate">{c.label}</span>
                    </Label>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" disabled={exporting !== null || !data?.total}>
                {exporting ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Download data-icon="inline-start" />}
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{data ? `Current filters (${data.total.toLocaleString("en-IN")})` : "Current filters"}</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => doExport("filtered", "xlsx")}>Excel (.xlsx)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => doExport("filtered", "csv")}>CSV</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Selected rows ({selected.size})</DropdownMenuLabel>
              <DropdownMenuItem disabled={!selected.size} onClick={() => doExport("selected", "xlsx")}>
                Excel (.xlsx)
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!selected.size} onClick={() => doExport("selected", "csv")}>
                CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {(activeChips.length > 0 || selected.size > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeChips.map((c) => (
            <Badge key={c.label} variant="secondary" className="gap-1 pr-1">
              <span className="max-w-72 truncate">{c.label}</span>
              <button type="button" className="rounded p-0.5 hover:bg-background" aria-label={`Remove filter ${c.label}`} onClick={c.clear}>
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          {activeChips.length > 1 && (
            <Button size="xs" variant="ghost" onClick={() => setFilters({})}>
              Clear all filters
            </Button>
          )}
          {selected.size > 0 && (
            <Button size="xs" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear selection ({selected.size})
            </Button>
          )}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border" data-testid="leads-table">
        {!data ? (
          <Skeleton className="m-3 h-64" />
        ) : (
          <table className="w-max min-w-full table-fixed border-collapse text-sm">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="h-9 w-10 border-b bg-muted/60 px-2">
                  <Checkbox
                    aria-label="Select all rows on this page"
                    checked={allOnPage}
                    onCheckedChange={(on) =>
                      setSelected((s) => {
                        const n = new Set(s);
                        for (const u of pageUids) {
                          if (on) n.add(u);
                          else n.delete(u);
                        }
                        return n;
                      })
                    }
                  />
                </th>
                {sortHead("status", "Status", "w-40")}
                {sortHead("flags", "Data quality", "w-52")}
                {mode === "combined" && sortHead("file", "File", "w-48")}
                {sortHead("rowNumber", "Row", "w-16")}
                {visible.map((c) => sortHead(c.kind === "orig" ? `orig:${c.id}` : c.id, c.label, "w-44"))}
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={visible.length + 5} className="px-4 py-10 text-center text-muted-foreground">
                    No leads match the current search and filters.
                  </td>
                </tr>
              )}
              {data.rows.map((r) => (
                <tr key={r.uid} className={cn("cursor-pointer border-b hover:bg-muted/40", selected.has(r.uid) && "bg-primary/5")} onClick={() => setDetail(r)} data-testid="lead-row">
                  <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      aria-label={`Select row ${r.rowNumber} of ${r.fileName}`}
                      checked={selected.has(r.uid)}
                      onCheckedChange={(on) =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (on) n.add(r.uid);
                          else n.delete(r.uid);
                          return n;
                        })
                      }
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="max-w-52 overflow-hidden px-2 py-1.5">
                    <FlagList flags={r.flags} />
                  </td>
                  {mode === "combined" && (
                    <td className="truncate px-2 py-1.5" title={r.fileName}>
                      {r.fileName}
                    </td>
                  )}
                  <td className="px-2 py-1.5 tabular-nums">{r.rowNumber}</td>
                  {visible.map((c) => {
                    const v = cellValue(r, c);
                    return (
                      <td key={`${c.kind}:${c.id}`} className="truncate px-2 py-1.5" title={v}>
                        {v || <span className="text-muted-foreground">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {data && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Rows per page</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => {
                setPageSize(Number(v));
                setPage(1);
              }}
            >
              <SelectTrigger className="h-8 w-20" aria-label="Rows per page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground tabular-nums">
              Page {Math.min(page, totalPages)} of {totalPages}
            </span>
            <Button size="icon-sm" variant="outline" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft />
            </Button>
            <Button size="icon-sm" variant="outline" aria-label="Next page" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
      {detail && data && <DetailSheet row={detail} columns={data.columns} onClose={() => setDetail(null)} />}
    </div>
  );
}
