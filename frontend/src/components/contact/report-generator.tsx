"use client";

import { CheckCircle2, Download, Eye, FileArchive, Loader2, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, download, timezoneLabel } from "@/lib/api";
import { fmtDuration, fmtInt, fmtStamp } from "@/lib/format";
import type { ContactFilters, ContactView, GeneratedReport, GenerateRequest } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorMessage } from "../session-provider";

type Option = "individual" | "contact" | "comparison" | "quality";
const OPTIONS: { value: Option; label: string; help: string }[] = [
  { value: "contact", label: "B · Combined lead report", help: "One report for the selected files (Lead_Contact_Report / Combined_Lead_Report). Duplicates across files are counted once." },
  { value: "individual", label: "A · Individual file reports", help: "A separate report for each selected file, with its own summary, data and charts." },
  { value: "comparison", label: "C · File comparison report", help: "Files side by side: records, valid, duplicates, owners, stages, missing columns, data quality." },
  { value: "quality", label: "Data quality report", help: "Validation issues, rejected rows and the audit trail." },
];
const TYPE_LABEL: Record<GeneratedReport["type"], string> = { contact: "Lead contact", combined: "Combined", individual: "Individual file", comparison: "File comparison", quality: "Data quality" };

/** Generate & download the Lead Contact Report (and related reports) with column selection, preview and timings. */
export function ReportGenerator({ sessionId, view, fileIds, filters, reportDate, testMode }: { sessionId: string; view: ContactView; fileIds: string[]; filters: ContactFilters; reportDate: string; testMode: boolean }) {
  const [option, setOption] = useState<Option>("contact");
  const [format, setFormat] = useState<"xlsx" | "csv" | "pdf">("xlsx");
  const [applyFilters, setApplyFilters] = useState(true);
  const [includeStatus, setIncludeStatus] = useState(true);
  const [included, setIncluded] = useState<Set<string>>(() => new Set(view.defaultColumns));
  const [names, setNames] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<GeneratedReport[]>([]);
  const [reload, setReload] = useState(0);
  const filtersActive = Boolean(filters.owners?.length || filters.stages?.length || filters.dispositions?.length || filters.followUp?.length);

  useEffect(() => {
    let cancelled = false;
    api
      .listReports(sessionId)
      .then((r) => !cancelled && setReports(r.reports))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sessionId, reload]);

  const columns = useMemo(() => view.columns.filter((c) => c.presentIn.length || included.has(c.key)), [view.columns, included]);
  const chosen = view.columns.filter((c) => included.has(c.key)).map((c) => ({ key: c.key, header: (names[c.key] ?? c.header).trim() || c.header }));
  const supportsColumns = option === "contact" || option === "individual";
  const fmtAllowed = supportsColumns ? (["xlsx", "csv", "pdf"] as const) : (["xlsx", "csv"] as const);
  const effectiveFormat = (fmtAllowed as readonly string[]).includes(format) ? format : "xlsx";

  const body = (): GenerateRequest => ({
    type: option,
    fileIds,
    format: effectiveFormat,
    columns: supportsColumns ? chosen : undefined,
    filters: supportsColumns && applyFilters ? filters : undefined,
    reportDate,
    includeStatus,
    timezoneLabel: timezoneLabel(),
  });

  const generate = async () => {
    if (supportsColumns && !chosen.length) {
      toast.error("Select at least one column.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const out = await api.generateReport(sessionId, body());
      setReload((n) => n + 1);
      const ok = out.reports.filter((r) => r.status === "completed");
      toast.success(`${ok.length} report${ok.length === 1 ? "" : "s"} generated in ${fmtDuration(ok.reduce((s, r) => s + r.generationMs, 0))}. Use Download to save ${ok.length === 1 ? "it" : "them"}.`);
    } catch (e) {
      setError(errorMessage(e));
      setReload((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  const get = async (r: GeneratedReport) => {
    try {
      const name = await download(`/sessions/${sessionId}/reports/${r.id}/download`);
      toast.success(`Downloaded ${name}`);
      setReload((n) => n + 1);
    } catch (e) {
      toast.error(errorMessage(e), { action: { label: "Retry", onClick: () => void get(r) } });
    }
  };
  const latestIndividual = reports.filter((r) => r.type === "individual" && r.fileAvailable);
  const zip = async () => {
    try {
      const batch = latestIndividual.filter((r) => r.generationStartedAt.slice(0, 16) === latestIndividual[0].generationStartedAt.slice(0, 16));
      const name = await download(`/sessions/${sessionId}/reports/zip?ids=${batch.map((r) => r.id).join(",")}`);
      toast.success(`Downloaded ${name}`);
      setReload((n) => n + 1);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const expected = supportsColumns && applyFilters && filtersActive ? view.counts.filteredLeads : view.counts.reportedLeads;
  const sheets =
    option === "comparison"
      ? ["File Comparison", "Field Mapping", "Column Differences", "Overlaps", "Owners & Stages"]
      : option === "quality"
        ? ["Summary", "Data Quality KPMs", "Rejected Records", "Validation Errors", "Audit Trail"]
        : ["Summary Report (KPIs, owners, stages, follow-ups, dispositions, last worked, notes, charts)", "Full Data", ...(view.counts.duplicateRowsExcluded || view.counts.possibleDuplicates ? ["Duplicate Leads"] : []), ...(view.counts.rejected || view.files.some((f) => f.incomplete) ? ["Invalid or Incomplete Leads"] : []), ...(option === "contact" && fileIds.length > 1 ? ["File Comparison"] : []), "Processing Details"];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Generate report</CardTitle>
        <CardDescription>
          Choose the report, columns and format, check it with Preview Report, then generate. Generated files are kept for this session (until it is cleared or expires) and listed below with their timings.
          {testMode && " This is a test session: files are named TEST_…"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <RadioGroup value={option} onValueChange={(v) => setOption(v as Option)} className="grid gap-2 md:grid-cols-2">
          {OPTIONS.map((o) => (
            <Label key={o.value} htmlFor={`opt-${o.value}`} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
              <RadioGroupItem id={`opt-${o.value}`} value={o.value} className="mt-0.5" />
              <span>
                <span className="block font-medium">{o.label}</span>
                <span className="block text-xs text-muted-foreground">{o.help}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">Format</span>
            <RadioGroup value={effectiveFormat} onValueChange={(v) => setFormat(v as typeof format)} className="flex gap-4">
              {fmtAllowed.map((f) => (
                <Label key={f} className="flex items-center gap-1.5 font-normal">
                  <RadioGroupItem value={f} aria-label={f.toUpperCase()} /> {f === "xlsx" ? "Excel (.xlsx)" : f.toUpperCase()}
                </Label>
              ))}
            </RadioGroup>
          </div>
          {supportsColumns && (
            <>
              <Label className="flex items-center gap-2 font-normal">
                <Checkbox checked={applyFilters} onCheckedChange={(v) => setApplyFilters(Boolean(v))} disabled={!filtersActive} /> Apply the current filters{filtersActive ? "" : " (none active)"}
              </Label>
              <Label className="flex items-center gap-2 font-normal">
                <Checkbox checked={includeStatus} onCheckedChange={(v) => setIncludeStatus(Boolean(v))} /> Add source file / validation status columns
              </Label>
            </>
          )}
        </div>

        {supportsColumns && (
          <details className="rounded-lg border" open>
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
              Columns in Full Data — {chosen.length} selected · rename a column by editing its output name
            </summary>
            <div className="max-h-80 overflow-auto border-t">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>Report column</TableHead>
                    <TableHead>Output name</TableHead>
                    <TableHead>Found in</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {columns.map((c) => (
                    <TableRow key={c.key}>
                      <TableCell>
                        <Checkbox
                          aria-label={`Include ${c.header}`}
                          checked={included.has(c.key)}
                          disabled={!c.presentIn.length}
                          onCheckedChange={(on) =>
                            setIncluded((s) => {
                              const n = new Set(s);
                              if (on) n.add(c.key);
                              else n.delete(c.key);
                              return n;
                            })
                          }
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {c.header}
                        {c.salesmax && (
                          <Badge variant="outline" className="ml-2 h-4 px-1 text-[10px]">
                            SalesMax
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Input value={names[c.key] ?? c.header} onChange={(e) => setNames((n) => ({ ...n, [c.key]: e.target.value }))} className="h-7 w-56" aria-label={`Output name for ${c.header}`} disabled={!included.has(c.key)} maxLength={100} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.presentIn.length ? (c.missingIn.length ? `${c.presentIn.length} of ${c.presentIn.length + c.missingIn.length} files` : "All files") : <span className="text-[color:var(--status-warning)]">Missing — not in any file</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </details>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setPreview(true)}>
            <Eye data-icon="inline-start" />
            Preview report
          </Button>
          <Button onClick={generate} disabled={busy} size="lg">
            {busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Play data-icon="inline-start" />}
            {busy ? "Generating…" : "Generate report"}
          </Button>
          {latestIndividual.length > 1 && (
            <Button variant="outline" onClick={zip}>
              <FileArchive data-icon="inline-start" />
              Download individual reports (ZIP)
            </Button>
          )}
          {error && (
            <span className="text-sm text-destructive" role="alert">
              {error}{" "}
              <Button size="xs" variant="outline" onClick={generate}>
                Retry
              </Button>
            </span>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold">Generated reports in this session</h3>
          {reports.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Report</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead>Generated ({timezoneLabel()})</TableHead>
                    <TableHead className="text-right">Processing</TableHead>
                    <TableHead className="text-right">Generation</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last download</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.map((r) => (
                    <TableRow key={r.id} data-testid="generated-report">
                      <TableCell className="max-w-72">
                        <div className="truncate font-medium" title={r.filename}>
                          {r.filename}
                        </div>
                        <div className="font-mono text-[10px] text-muted-foreground">ID {r.id.slice(0, 8)}</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {TYPE_LABEL[r.type]}
                        {r.test && (
                          <Badge variant="outline" className="ml-1.5 h-4 px-1 text-[10px]">
                            TEST
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(r.totalLeads)}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{fmtStamp(r.generationCompletedAt)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtDuration(r.processingMs)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtDuration(r.generationMs)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{fmtDuration((r.processingMs ?? 0) + r.generationMs)}</TableCell>
                      <TableCell>
                        {r.status === "completed" ? (
                          <span className="inline-flex items-center gap-1 text-xs text-[color:var(--status-good)]">
                            <CheckCircle2 className="size-3.5" aria-hidden /> Completed
                          </span>
                        ) : (
                          <span className="text-xs text-destructive" title={r.error ?? ""}>
                            Failed
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{r.downloads.length ? `${fmtStamp(r.downloads.at(-1))} (${r.downloads.length}×)` : "—"}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" disabled={!r.fileAvailable} onClick={() => get(r)} aria-label={`Download ${r.filename}`}>
                          <Download data-icon="inline-start" />
                          Download
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </CardContent>

      {preview && (
        <Dialog open onOpenChange={(o) => !o && setPreview(false)}>
          <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Report preview{testMode ? " (TEST)" : ""}</DialogTitle>
              <DialogDescription>Nothing is generated yet. This is what the {OPTIONS.find((o) => o.value === option)!.label.replace(/^[A-C] · /, "").toLowerCase()} will contain.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <dl className="grid grid-cols-[180px_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">Files</dt>
                <dd>{view.files.map((f) => f.fileName).join(", ")}</dd>
                <dt className="text-muted-foreground">Report date</dt>
                <dd>{reportDate} (follow-ups before this date are overdue)</dd>
                <dt className="text-muted-foreground">Format</dt>
                <dd>{effectiveFormat.toUpperCase()}</dd>
                {supportsColumns && (
                  <>
                    <dt className="text-muted-foreground">Expected leads</dt>
                    <dd className="font-semibold">
                      {option === "individual" ? view.files.map((f) => `${f.fileName}: ${fmtInt(f.leadsInReport)}`).join(" · ") : fmtInt(expected)}
                      {applyFilters && filtersActive ? " (filtered)" : ""}
                    </dd>
                    <dt className="text-muted-foreground">Duplicate handling</dt>
                    <dd>
                      {view.duplicateMode.replace(/_/g, " ")} · {fmtInt(view.counts.duplicateRowsExcluded)} duplicate rows excluded · {fmtInt(view.counts.rejected)} invalid rows listed separately
                    </dd>
                  </>
                )}
              </dl>
              <div>
                <h4 className="mb-1 font-medium">{effectiveFormat === "xlsx" ? "Sheets" : effectiveFormat === "csv" ? "Contents" : "Sections"}</h4>
                <ul className="list-disc pl-5">
                  {effectiveFormat === "xlsx" ? sheets.map((s) => <li key={s}>{s}</li>) : effectiveFormat === "csv" ? <li>{supportsColumns ? "Full Data table with the selected columns" : `${sheets[0]} table`}</li> : <li>Key numbers, owners, stages, follow-ups, dispositions, last worked, notes, processing details</li>}
                </ul>
              </div>
              {supportsColumns && (
                <div>
                  <h4 className="mb-1 font-medium">Columns ({chosen.length})</h4>
                  <p className="text-muted-foreground">{chosen.map((c) => c.header).join(" · ") || "None selected"}</p>
                  {view.report.missingFields.length > 0 && <p className="mt-1 text-[color:var(--status-warning)]">Not in the uploaded data (shown as N/A): {view.report.missingFields.join(", ")}</p>}
                </div>
              )}
              {supportsColumns && (
                <div>
                  <h4 className="mb-1 font-medium">Key numbers (current view)</h4>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3">
                    {(
                      [
                        ["Total leads", view.report.kpis.totalLeads],
                        ["Not worked", view.report.kpis.notWorked],
                        ["Qualified", view.report.kpis.qualified],
                        ["Total calls", view.report.kpis.totalCalls],
                        ["Overdue follow-ups", view.report.kpis.overdueFollowUps],
                        ["No follow-up date", view.report.kpis.noFollowUpDate],
                      ] as const
                    ).map(([l, v]) => (
                      <span key={l}>
                        {l}: <span className="font-semibold tabular-nums">{fmtInt(v)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <Button
                onClick={() => {
                  setPreview(false);
                  void generate();
                }}
              >
                <Play data-icon="inline-start" />
                Generate this report
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
