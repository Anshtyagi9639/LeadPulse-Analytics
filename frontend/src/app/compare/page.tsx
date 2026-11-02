"use client";

import { Award, Download, FlaskConical, Loader2, Mail, Trophy, TriangleAlert, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, download, timezoneLabel } from "@/lib/api";
import { fmtDuration, fmtInt, fmtMoney, fmtPct, fmtStamp } from "@/lib/format";
import type { FileComparison, LeadQuery, Report } from "@/lib/types";
import { FileQualityChart } from "@/components/dashboard/charts";
import { PageHeader } from "@/components/page-header";
import { errorMessage, useSession } from "@/components/session-provider";
import { EmptyState, PageSkeleton } from "@/components/states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function Highlight({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | null }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="space-y-1 px-4">
        <div className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          <Icon className="size-3.5" aria-hidden />
          {label}
        </div>
        <div className="truncate text-sm font-semibold" title={value ?? ""}>
          {value ?? "N/A"}
        </div>
      </CardContent>
    </Card>
  );
}

function PreviewTable({ previews }: { previews: { label: string; report: Report }[] }) {
  const rows: [string, (r: Report) => string][] = [
    ["Total records", (r) => fmtInt(r.quality.totalRecords)],
    ["Valid (unique) leads", (r) => fmtInt(r.quality.validLeads)],
    ["Duplicate leads", (r) => fmtInt(r.quality.duplicateLeads)],
    ["Invalid records", (r) => fmtInt(r.quality.invalidLeads)],
    ["Validation success", (r) => fmtPct(r.quality.validationSuccessRate)],
    ["Qualified leads", (r) => fmtInt(r.overview.qualifiedLeads)],
    ["Ad spend", (r) => fmtMoney(r.overview.totalSpend, r.currency)],
    ["CPL", (r) => fmtMoney(r.overview.cpl, r.currency)],
    ["Applications", (r) => fmtInt(r.overview.applications)],
    ["Enrolments", (r) => fmtInt(r.overview.enrolments)],
  ];
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Metric</TableHead>
            {previews.map((p) => (
              <TableHead key={p.label} className="text-right whitespace-nowrap">
                {p.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(([label, fn]) => (
            <TableRow key={label}>
              <TableCell className="font-medium">{label}</TableCell>
              {previews.map((p) => (
                <TableCell key={p.label} className="text-right tabular-nums">
                  {fn(p.report)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function ComparePage() {
  const { session, loading, setLeadFilter } = useSession();
  const router = useRouter();
  const leadFiles = useMemo(() => (session?.files ?? []).filter((f) => f.status === "ready" && f.kind === "leads"), [session?.files]);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const chosen = useMemo(() => (picked ? leadFiles.filter((f) => picked.has(f.id)) : leadFiles), [picked, leadFiles]);
  const chosenIds = chosen.map((f) => f.id).join(",");
  const [data, setData] = useState<FileComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<{ label: string; report: Report }[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const sessionId = session?.id;
  const version = `${session?.files.map((f) => f.validation?.validatedAt).join(",")}|${JSON.stringify(session?.settings.matchRules)}|${session?.settings.duplicateMode}`;

  useEffect(() => {
    if (!sessionId || !chosenIds) return;
    let cancelled = false;
    api
      .comparison(sessionId, chosenIds.split(","))
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
  }, [sessionId, chosenIds, version]);

  if (loading) return <PageSkeleton />;
  if (!session) return <EmptyState title="No reporting session yet">Upload two or more files to compare them.</EmptyState>;
  if (leadFiles.length === 0) return <EmptyState title="No lead files ready">Upload lead files and complete their column mapping first.</EmptyState>;

  const openLeads = (q: LeadQuery) => {
    setLeadFilter(q);
    router.push("/leads");
  };
  const runPreview = async () => {
    setPreviewing(true);
    try {
      const per = await Promise.all(chosen.map(async (f) => ({ label: f.name, report: (await api.previewReport(session.id, [f.id])).report })));
      const combined = chosen.length > 1 ? [{ label: "All selected combined", report: (await api.previewReport(session.id, chosen.map((f) => f.id))).report }] : [];
      setPreviews([...per, ...combined]);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPreviewing(false);
    }
  };
  const doExport = async (format: "xlsx" | "csv") => {
    setExporting(format);
    try {
      const name = await download(`/sessions/${session.id}/export/comparison?format=${format}&fileIds=${chosen.map((f) => f.id).join(",")}&tz=${encodeURIComponent(timezoneLabel())}`);
      toast.success(`Downloaded ${name}`);
    } catch (e) {
      toast.error(errorMessage(e), { action: { label: "Retry", onClick: () => void doExport(format) } });
    } finally {
      setExporting(null);
    }
  };
  const h = data?.highlights;
  const names = data?.files.map((f) => f.fileName) ?? [];

  return (
    <>
      <PageHeader
        title="Compare files"
        description="Compare uploaded files before using them. This view is read-only: it never changes your report, mappings or duplicate decisions, and nothing is merged or deleted."
        actions={
          <>
            <Button variant="outline" onClick={() => doExport("csv")} disabled={!data || exporting !== null}>
              {exporting === "csv" ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Download data-icon="inline-start" />}
              CSV
            </Button>
            <Button onClick={() => doExport("xlsx")} disabled={!data || exporting !== null}>
              {exporting === "xlsx" ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Download data-icon="inline-start" />}
              Download comparison (.xlsx)
            </Button>
          </>
        }
      />
      <div className="space-y-6">
        <Card className="gap-3 py-4">
          <CardContent className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4">
            <span className="text-sm font-medium">Files to compare:</span>
            {leadFiles.map((f) => (
              <Label key={f.id} className="flex items-center gap-2 font-normal">
                <Checkbox
                  checked={chosen.some((c) => c.id === f.id)}
                  onCheckedChange={(on) => {
                    const next = new Set(chosen.map((c) => c.id));
                    if (on) next.add(f.id);
                    else next.delete(f.id);
                    if (next.size) setPicked(next);
                    setPreviews(null);
                  }}
                />
                {f.name}
              </Label>
            ))}
          </CardContent>
        </Card>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {!data ? (
          <Skeleton className="h-72" />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Highlight icon={Trophy} label="Most valid leads" value={h?.mostValidLeads ? `${h.mostValidLeads.fileName} (${fmtInt(h.mostValidLeads.value)})` : null} />
              <Highlight icon={TriangleAlert} label="Highest duplicate %" value={h?.highestDuplicatePct ? `${h.highestDuplicatePct.fileName} (${fmtPct(h.highestDuplicatePct.value)})` : null} />
              <Highlight icon={Mail} label="Most complete contacts" value={h?.mostCompleteContact ? `${h.mostCompleteContact.fileName} (${fmtPct(h.mostCompleteContact.value)})` : null} />
              <Highlight icon={Award} label="Best data quality" value={h?.bestQuality ? `${h.bestQuality.fileName} (score ${h.bestQuality.value})` : null} />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Records by file</CardTitle>
                <CardDescription>Valid, duplicate (within the compared files) and invalid records. Click a segment to review those records.</CardDescription>
              </CardHeader>
              <CardContent>
                <FileQualityChart
                  data={data.files.map((f) => ({ fileId: f.fileId, fileName: f.fileName, valid: f.validLeads, duplicate: f.duplicateRecords, invalid: f.invalidRecords }))}
                  onSelect={(fileId, status) => openLeads({ fileIds: [fileId], statuses: status === "duplicate" ? ["duplicate", "possible_duplicate"] : [status] })}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">File-by-file results</CardTitle>
                <CardDescription>
                  Times in {timezoneLabel()}. {data.qualityScoreDefinition}
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto px-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">File</TableHead>
                      <TableHead className="text-right">Records</TableHead>
                      <TableHead className="text-right">Processed</TableHead>
                      <TableHead className="text-right">Valid</TableHead>
                      <TableHead className="text-right">Duplicates</TableHead>
                      <TableHead className="text-right">Dup. %</TableHead>
                      <TableHead className="text-right">Invalid</TableHead>
                      <TableHead className="text-right">Incomplete</TableHead>
                      <TableHead className="text-right">Phone or email</TableHead>
                      <TableHead className="text-right">Quality score</TableHead>
                      <TableHead className="text-right">Only in this file</TableHead>
                      <TableHead className="text-right">In other files</TableHead>
                      <TableHead>Failures</TableHead>
                      <TableHead className="text-right">Processing time</TableHead>
                      <TableHead className="pr-6">Completed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.files.map((f) => (
                      <TableRow key={f.fileId}>
                        <TableCell className="max-w-56 truncate pl-6 font-medium" title={f.fileName}>
                          {f.fileName}
                          <div className="text-xs font-normal text-muted-foreground">{f.sheet}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtInt(f.totalRecords)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtInt(f.processedLeads)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtInt(f.validLeads)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtInt(f.duplicateRecords)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtPct(f.duplicatePct)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtInt(f.invalidRecords)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtInt(f.incompleteRecords)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtPct(f.contact.anyContactPct)}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{f.qualityScore ?? "N/A"}</TableCell>
                        <TableCell className="text-right">
                          <button type="button" className="tabular-nums text-primary underline-offset-2 hover:underline" onClick={() => openLeads({ fileIds: [f.fileId], presence: "unique_to_file" })}>
                            {fmtInt(f.uniqueToFile)}
                          </button>
                        </TableCell>
                        <TableCell className="text-right">
                          <button type="button" className="tabular-nums text-primary underline-offset-2 hover:underline" onClick={() => openLeads({ fileIds: [f.fileId], presence: "in_multiple_files" })}>
                            {fmtInt(f.sharedWithOtherFiles)}
                          </button>
                        </TableCell>
                        <TableCell className="max-w-56 text-xs whitespace-normal">{f.failures.length ? f.failures.map((x) => `${x.reason} (${x.count})`).join("; ") : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtDuration(f.timing.processingMs)}</TableCell>
                        <TableCell className="pr-6 text-xs whitespace-nowrap">{fmtStamp(f.timing.uploadCompletedAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {data.overlaps.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Users className="size-4 text-primary" aria-hidden />
                    Matching leads across files
                  </CardTitle>
                  <CardDescription>Leads in file A that also appear in file B, by the identifiers enabled in the duplicate settings. Review them before deciding how to handle duplicates.</CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto px-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-6">File A</TableHead>
                        <TableHead>File B</TableHead>
                        <TableHead className="text-right">Matching leads</TableHead>
                        <TableHead className="text-right">By Lead ID</TableHead>
                        <TableHead className="text-right">By phone</TableHead>
                        <TableHead className="pr-6 text-right">By email</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.overlaps.map((o) => (
                        <TableRow key={`${o.a}|${o.b}`}>
                          <TableCell className="max-w-56 truncate pl-6">{o.a}</TableCell>
                          <TableCell className="max-w-56 truncate">{o.b}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{fmtInt(o.matchingLeads)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtInt(o.byLeadId)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtInt(o.byPhone)}</TableCell>
                          <TableCell className="pr-6 text-right tabular-nums">{fmtInt(o.byEmail)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Field mapping and missing values</CardTitle>
                  <CardDescription>Which column each file uses for each standard field, and the share of rows where it is blank.</CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto px-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-6">Field</TableHead>
                        {names.map((n) => (
                          <TableHead key={n} className="max-w-48 truncate" title={n}>
                            {n}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.fieldMatrix.map((m) => (
                        <TableRow key={m.key}>
                          <TableCell className="pl-6 font-medium">{m.label}</TableCell>
                          {names.map((n) => (
                            <TableCell key={n} className="text-xs">
                              {m.columns[n] ? (
                                <>
                                  <span>{m.columns[n]}</span>
                                  <span className={(m.missingPct[n] ?? 0) > 0 ? "ml-1.5 text-[color:var(--status-warning)]" : "ml-1.5 text-muted-foreground"}>{fmtPct(m.missingPct[n], 0)} blank</span>
                                </>
                              ) : (
                                <span className="text-muted-foreground italic">not present</span>
                              )}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Column differences</CardTitle>
                  <CardDescription>Columns that exist in only some files.</CardDescription>
                </CardHeader>
                <CardContent className="max-h-[480px] space-y-2 overflow-auto text-sm">
                  {data.columnDifferences.length === 0 && <p className="text-muted-foreground">All files have the same columns.</p>}
                  {data.columnDifferences.map((d) => (
                    <div key={d.header} className="rounded-lg border px-3 py-2">
                      <div className="font-medium">{d.header}</div>
                      <div className="text-xs text-muted-foreground">Only in: {d.presentIn.join(", ")}</div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FlaskConical className="size-4 text-primary" aria-hidden />
                    Testing mode: report preview
                  </CardTitle>
                  <CardDescription>Calculates the report for each selected file and for all of them combined, side by side. Your main report is not changed.</CardDescription>
                </div>
                <Button variant="outline" onClick={runPreview} disabled={previewing}>
                  {previewing && <Loader2 className="animate-spin" data-icon="inline-start" />}
                  Preview reports
                </Button>
              </CardHeader>
              <CardContent className="px-0">
                {previews ? (
                  <>
                    <Alert className="mx-6 mb-3 w-auto">
                      <FlaskConical />
                      <AlertTitle>Preview only</AlertTitle>
                      <AlertDescription>These figures are not saved and do not affect the dashboard or downloads. Use “Process” on the Upload page to make a selection the main report.</AlertDescription>
                    </Alert>
                    <PreviewTable previews={previews} />
                  </>
                ) : (
                  <p className="px-6 text-sm text-muted-foreground">Press “Preview reports” to compare the KPIs each file would produce.</p>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
