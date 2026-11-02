"use client";

import { CheckCircle2, Download, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, download, downloadPost, timezoneLabel } from "@/lib/api";
import type { LeadQuery, LeadStatus, LeadsResponse } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorMessage, useSession } from "../session-provider";

type Kind = "combined" | "file" | "comparison" | "quality";
type Records = "all" | "valid" | "duplicates" | "invalid";

const RECORDS: Record<Records, LeadStatus[] | undefined> = {
  all: undefined,
  valid: ["valid"],
  duplicates: ["duplicate", "possible_duplicate"],
  invalid: ["invalid"],
};

/** Generate & download: one place to choose report type, records, dates, columns and format. */
export function ReportBuilder() {
  const { session } = useSession();
  const leadFiles = useMemo(() => (session?.files ?? []).filter((f) => f.status === "ready" && f.kind === "leads"), [session?.files]);
  const [kind, setKind] = useState<Kind>("combined");
  const [fileId, setFileId] = useState(leadFiles[0]?.id ?? "");
  const [records, setRecords] = useState<Records>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [variant, setVariant] = useState<"cleaned" | "original" | "both">("both");
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [columns, setColumns] = useState<LeadsResponse["columns"] | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [state, setState] = useState<{ status: "idle" | "working" | "done" | "error"; message?: string }>({ status: "idle" });
  const sessionId = session?.id;
  const reportIds = session?.report.fileIds.join(",") ?? "";
  const leadScope = kind === "file" ? fileId : reportIds || leadFiles.map((f) => f.id).join(",");

  useEffect(() => {
    if (!sessionId || !leadScope || kind === "comparison" || kind === "quality") return;
    let cancelled = false;
    api
      .leads(sessionId, { fileIds: leadScope.split(","), page: 1, pageSize: 5 })
      .then((d) => !cancelled && setColumns(d.columns))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sessionId, leadScope, kind]);

  if (!session) return null;
  const isLeads = kind === "combined" || kind === "file";

  const generate = async () => {
    setState({ status: "working" });
    try {
      let name: string;
      if (isLeads) {
        const query: LeadQuery = { fileIds: leadScope.split(","), statuses: RECORDS[records], dateFrom: from || undefined, dateTo: to || undefined };
        name = await downloadPost(`/sessions/${session.id}/export/leads`, {
          format,
          variant,
          query,
          stdColumns: columns?.standard.map((c) => c.key).filter((k) => !excluded.has(`std:${k}`)),
          originalColumns: columns?.original.filter((h) => !excluded.has(`orig:${h}`)),
          timezoneLabel: timezoneLabel(),
        });
      } else if (kind === "comparison") {
        name = await download(`/sessions/${session.id}/export/comparison?format=${format}&tz=${encodeURIComponent(timezoneLabel())}`);
      } else {
        name = await download(`/sessions/${session.id}/export/quality?format=${format}&tz=${encodeURIComponent(timezoneLabel())}`);
      }
      setState({ status: "done", message: name });
      toast.success(`Downloaded ${name}`);
    } catch (e) {
      setState({ status: "error", message: errorMessage(e) });
    }
  };

  const colList = columns ? [...(variant === "original" ? [] : columns.standard.map((c) => ({ k: `std:${c.key}`, label: c.label }))), ...(variant === "cleaned" ? [] : columns.original.map((h) => ({ k: `orig:${h}`, label: `${h} (original)` })))] : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Generate & download a report</CardTitle>
        <CardDescription>Exports always reflect the current session data. Phone numbers and IDs are written as text so leading zeros are kept.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Report</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
              <SelectTrigger className="w-full" aria-label="Report type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="combined">Combined lead report</SelectItem>
                <SelectItem value="file" disabled={!leadFiles.length}>
                  One file&apos;s lead report
                </SelectItem>
                <SelectItem value="comparison">File comparison report</SelectItem>
                <SelectItem value="quality">Data-quality summary</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {kind === "file" && (
            <div className="space-y-1.5">
              <Label>File</Label>
              <Select value={fileId} onValueChange={setFileId}>
                <SelectTrigger className="w-full" aria-label="File">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {leadFiles.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {isLeads && (
            <div className="space-y-1.5">
              <Label>Records</Label>
              <Select value={records} onValueChange={(v) => setRecords(v as Records)}>
                <SelectTrigger className="w-full" aria-label="Records to include">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All records (with status)</SelectItem>
                  <SelectItem value="valid">Valid leads only</SelectItem>
                  <SelectItem value="duplicates">Duplicates only</SelectItem>
                  <SelectItem value="invalid">Invalid records only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Format</Label>
            <RadioGroup value={format} onValueChange={(v) => setFormat(v as "xlsx" | "csv")} className="flex gap-4 pt-1.5">
              <Label className="flex items-center gap-2 font-normal">
                <RadioGroupItem value="xlsx" /> Excel (.xlsx)
              </Label>
              <Label className="flex items-center gap-2 font-normal">
                <RadioGroupItem value="csv" /> CSV
              </Label>
            </RadioGroup>
          </div>
        </div>

        {isLeads && (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="rb-from">Lead created from</Label>
              <Input id="rb-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rb-to">Lead created to</Label>
              <Input id="rb-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>Values</Label>
              <Select value={variant} onValueChange={(v) => setVariant(v as typeof variant)}>
                <SelectTrigger className="w-full" aria-label="Values to include">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Cleaned + original values</SelectItem>
                  <SelectItem value="cleaned">Cleaned standard values only</SelectItem>
                  <SelectItem value="original">Original values exactly as uploaded</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {isLeads && colList.length > 0 && (
          <details className="rounded-lg border px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium">
              Columns ({colList.filter((c) => !excluded.has(c.k)).length} of {colList.length} selected)
            </summary>
            <div className="mt-2 flex gap-2">
              <Button size="xs" variant="outline" onClick={() => setExcluded(new Set())}>
                Select all
              </Button>
              <Button size="xs" variant="outline" onClick={() => setExcluded(new Set(colList.map((c) => c.k)))}>
                Select none
              </Button>
            </div>
            <div className="mt-2 grid max-h-64 gap-1 overflow-auto sm:grid-cols-2 lg:grid-cols-3">
              {colList.map((c) => (
                <Label key={c.k} className="flex items-center gap-2 font-normal">
                  <Checkbox
                    checked={!excluded.has(c.k)}
                    onCheckedChange={(on) =>
                      setExcluded((x) => {
                        const n = new Set(x);
                        if (on) n.delete(c.k);
                        else n.add(c.k);
                        return n;
                      })
                    }
                  />
                  <span className="truncate">{c.label}</span>
                </Label>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">File, row, status, data-quality flags and duplicate information are always included.</p>
          </details>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={generate} disabled={state.status === "working" || (kind === "file" && !fileId)} size="lg">
            {state.status === "working" ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Download data-icon="inline-start" />}
            {state.status === "working" ? "Generating…" : "Generate & download"}
          </Button>
          {state.status === "done" && (
            <span className="inline-flex items-center gap-1.5 text-sm text-[color:var(--status-good)]" role="status">
              <CheckCircle2 className="size-4" aria-hidden /> {state.message} downloaded
            </span>
          )}
          {state.status === "error" && (
            <span className="inline-flex flex-wrap items-center gap-2 text-sm text-destructive" role="alert">
              {state.message}
              <Button size="xs" variant="outline" onClick={generate}>
                Retry
              </Button>
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
