"use client";

import { Download, FileSpreadsheet, FileText, FolderOpen, History, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, download, timezoneLabel } from "@/lib/api";
import { fmtDuration, fmtInt, fmtMoney, fmtStamp } from "@/lib/format";
import type { HistoryEntry } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { errorMessage, useSession } from "@/components/session-provider";
import { EmptyState, PageSkeleton } from "@/components/states";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const TYPE_LABEL: Record<string, string> = { contact: "Lead contact", combined: "Combined", individual: "Individual file", comparison: "File comparison", quality: "Data quality" };

export default function HistoryPage() {
  const { session, openSession, loading } = useSession();
  const router = useRouter();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const lastGenerated = `${session?.report.generatedAt}|${session?.generatedReports}`;

  useEffect(() => {
    let cancelled = false;
    api
      .history()
      .then((d) => !cancelled && setEntries(d.entries))
      .catch((e) => toast.error(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [reload, lastGenerated]);

  const get = async (key: string, path: string) => {
    setPending(key);
    try {
      const name = await download(path);
      toast.success(`Downloaded ${name}`);
      setReload((n) => n + 1);
    } catch (e) {
      toast.error(errorMessage(e), { action: { label: "Retry", onClick: () => void get(key, path) } });
    } finally {
      setPending(null);
    }
  };

  // Timezone and timestamps are resolved in the browser only (never at build/prerender time).
  if (loading) return <PageSkeleton />;
  const allReports = (entries ?? []).flatMap((e) => e.reports.filter((r) => r.status === "completed"));
  const latest = allReports.sort((a, b) => b.generationCompletedAt.localeCompare(a.generationCompletedAt))[0];

  return (
    <>
      <PageHeader title="Report history" description={`Reports generated in this browser. Times are shown in ${timezoneLabel()}.`} />
      <div className="space-y-6">
        <Alert>
          <History />
          <AlertTitle>What is kept</AlertTitle>
          <AlertDescription>
            History keeps report metadata, timings and the processed summary (counts and rates) for 30 days, and survives server restarts. Generated report files contain lead data, so they are kept only inside their session and can be downloaded again until the session is cleared or expires (12 hours). After that, the processed summary can still be downloaded as PDF or Excel.
          </AlertDescription>
        </Alert>
        {latest && (
          <p className="text-sm text-muted-foreground">
            Latest successful report: <span className="font-medium text-foreground">{latest.filename}</span> · generated {fmtStamp(latest.generationCompletedAt)} · {fmtDuration(latest.generationMs)}
          </p>
        )}
        {!entries ? (
          <Skeleton className="h-48" />
        ) : entries.length === 0 ? (
          <EmptyState icon={History} title="No reports yet">
            Generated reports appear here after you process files or generate a report.
          </EmptyState>
        ) : (
          entries.map((e) => (
            <Card key={e.id} data-testid="history-row">
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    Session <span className="font-mono text-sm">{e.id.slice(0, 8)}</span>
                    {session?.id === e.id && <Badge variant="secondary">current</Badge>}
                    {e.mode === "test" && <Badge className="bg-[color:var(--status-warning)] text-white">TEST</Badge>}
                    <Badge variant="outline" className="border-[color:var(--status-good)] text-[color:var(--status-good)]">
                      Completed
                    </Badge>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Period {e.reportingPeriod.from === e.reportingPeriod.to ? e.reportingPeriod.from : `${e.reportingPeriod.from} – ${e.reportingPeriod.to}`} · {fmtInt(e.recordsProcessed)} records · {fmtInt(e.uniqueLeads)} unique leads
                    {e.summary && e.summary.cpl !== null ? ` · CPL ${fmtMoney(e.summary.cpl, e.summary.currency)}` : ""} · created {fmtStamp(e.createdAt)} · last activity {fmtStamp(e.updatedAt)}
                  </p>
                  <p className="text-xs text-muted-foreground">Files: {e.fileNames.join(", ")}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {e.summaryAvailable && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => get(`${e.id}-pdf`, `/history/${e.id}/export/pdf`)} disabled={pending !== null} aria-label="Download summary PDF">
                        {pending === `${e.id}-pdf` ? <Loader2 className="animate-spin" /> : <FileText />}
                        Summary PDF
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => get(`${e.id}-xlsx`, `/history/${e.id}/export/excel`)} disabled={pending !== null} aria-label="Download summary Excel">
                        {pending === `${e.id}-xlsx` ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />}
                        Summary Excel
                      </Button>
                    </>
                  )}
                  {e.sessionAvailable ? (
                    <Button
                      size="sm"
                      onClick={async () => {
                        if (session?.id === e.id || (await openSession(e.id))) router.push("/contact-report");
                      }}
                    >
                      <FolderOpen />
                      Reopen
                    </Button>
                  ) : (
                    <span className="self-center px-1 text-xs text-muted-foreground">Lead data expired</span>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="icon-sm" variant="ghost" aria-label="Delete history entry">
                        <Trash2 />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this history entry?</AlertDialogTitle>
                        <AlertDialogDescription>The saved metadata and summary are removed. An active session and its files are not affected.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={async () => {
                            try {
                              await api.deleteHistory(e.id);
                              setReload((n) => n + 1);
                            } catch (err) {
                              toast.error(errorMessage(err));
                            }
                          }}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardHeader>
              <CardContent className="overflow-x-auto px-0">
                {e.reports.length === 0 ? (
                  <p className="px-6 text-sm text-muted-foreground">No report files generated in this session{e.generations ? `; processed ${e.generations} time(s)` : ""}.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-6">Report ID</TableHead>
                        <TableHead>Report</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Source files</TableHead>
                        <TableHead className="text-right">Leads</TableHead>
                        <TableHead>Generated</TableHead>
                        <TableHead className="text-right">Processing</TableHead>
                        <TableHead className="text-right">Generation</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Downloads</TableHead>
                        <TableHead className="pr-6" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {e.reports.map((r) => (
                        <TableRow key={r.id} data-testid="history-report">
                          <TableCell className="pl-6 font-mono text-xs">{r.id.slice(0, 8)}</TableCell>
                          <TableCell className="max-w-64 truncate font-medium" title={r.filename}>
                            {r.filename}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {TYPE_LABEL[r.type] ?? r.type}
                            {r.test && (
                              <Badge variant="outline" className="ml-1.5 h-4 px-1 text-[10px]">
                                TEST
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="max-w-56 text-xs whitespace-normal">{r.fileNames.join(", ")}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtInt(r.totalLeads)}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap">{fmtStamp(r.generationCompletedAt)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtDuration(r.processingMs)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtDuration(r.generationMs)}</TableCell>
                          <TableCell className="text-xs">{r.status === "completed" ? "Completed" : <span className="text-destructive">Failed</span>}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap">{r.downloads.length ? `${r.downloads.length}× · last ${fmtStamp(r.downloads.at(-1))}` : "—"}</TableCell>
                          <TableCell className="pr-6">
                            {r.fileAvailable ? (
                              <Button size="sm" variant="outline" onClick={() => get(r.id, `/sessions/${e.id}/reports/${r.id}/download`)} disabled={pending !== null} aria-label={`Download ${r.filename} again`}>
                                {pending === r.id ? <Loader2 className="animate-spin" /> : <Download />}
                                Download
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">{r.status === "completed" ? "File expired" : "—"}</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </>
  );
}
