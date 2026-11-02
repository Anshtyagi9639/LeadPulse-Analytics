"use client";

import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, download } from "@/lib/api";
import { fmtInt, fmtPct } from "@/lib/format";
import type { ValidationIssue } from "@/lib/types";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/page-header";
import { errorMessage, useSession } from "@/components/session-provider";
import { EmptyState, PageSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { IssuesTable } from "@/components/upload/issues-dialog";

function IssuesPanel({ sessionId, fileId }: { sessionId: string; fileId: string }) {
  const [issues, setIssues] = useState<{ total: number; issues: ValidationIssue[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .fileIssues(sessionId, fileId, 500)
      .then((d) => {
        if (!cancelled) setIssues(d);
      })
      .catch((e) => toast.error(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [sessionId, fileId]);
  return (
    <>
      <p className="px-6 pb-3 text-sm text-muted-foreground">
        {issues ? `${fmtInt(issues.total)} issue(s) in this file${issues.total > issues.issues.length ? ` — first ${issues.issues.length} shown` : ""}. Personal data is masked.` : "Loading…"}
      </p>
      {!issues ? (
        <Skeleton className="mx-6 h-40" />
      ) : issues.issues.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-muted-foreground">No issues in this file.</p>
      ) : (
        <IssuesTable issues={issues.issues} />
      )}
    </>
  );
}

export default function QualityPage() {
  const { session, report, loading } = useSession();
  const files = session?.files ?? [];
  const [fileId, setFileId] = useState<string | null>(null);
  const current = files.find((f) => f.id === fileId && f.status !== "error") ?? files.find((f) => f.status !== "error") ?? null;

  if (loading) return <PageSkeleton />;
  if (!session) return <EmptyState title="No reporting session yet">Upload files first.</EmptyState>;

  const dq = report?.dataQuality;
  const n = report?.counts.inScopeRows ?? 0;
  const share = (v: number | null | undefined) => (n && v !== null && v !== undefined ? `${fmtPct((v / n) * 100)} of rows` : undefined);
  const errored = files.filter((f) => f.status === "error");

  return (
    <>
      <PageHeader
        title="Data quality"
        description="Nothing is silently discarded. Each row is accepted, accepted with warnings, rejected, or skipped as blank — and every issue is listed here."
        actions={
          <Button variant="outline" onClick={() => download(`/sessions/${session.id}/validation-errors.csv`).catch((e) => toast.error(errorMessage(e)))}>
            <Download data-icon="inline-start" />
            Download validation errors (CSV)
          </Button>
        }
      />
      <div className="space-y-6">
        {dq ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Duplicate rate" value={fmtPct(dq.duplicateRate)} sub={`${fmtInt(report.counts.duplicateRows)} duplicate rows · ${fmtInt(dq.conflictingRecords)} conflicting records`} />
            <KpiCard label="Invalid (rejected) rows" value={fmtInt(dq.rejectedRows)} sub={`${fmtInt(dq.rowsWithWarnings)} rows accepted with warnings`} />
            <KpiCard label="Missing phone / invalid" value={`${fmtInt(dq.missingPhone)} / ${fmtInt(dq.invalidPhone)}`} sub={share(dq.missingPhone)} />
            <KpiCard label="Missing email / invalid" value={`${fmtInt(dq.missingEmail)} / ${fmtInt(dq.invalidEmail)}`} sub={share(dq.missingEmail)} />
            <KpiCard label="Missing campaign" value={fmtInt(dq.missingCampaign)} sub={share(dq.missingCampaign)} />
            <KpiCard label="Missing counsellor" value={fmtInt(dq.missingCounsellor)} sub={share(dq.missingCounsellor)} />
            <KpiCard label="Missing follow-up date" value={fmtInt(dq.missingFollowUpDate)} sub="Open leads without a next follow-up" />
            <KpiCard label="Missing conversion status" value={fmtInt(dq.missingConversionStatus)} sub={`${fmtInt(dq.missingCreatedDate)} rows without a created date`} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Process the files to see the data-quality KPMs. File-level validation issues are available below now.</p>
        )}

        {dq && dq.unmappedColumns.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Unmapped columns</CardTitle>
              <CardDescription>These columns were not used in the report. Map them if they contain reporting fields.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {dq.unmappedColumns.map((u) => (
                <p key={u.fileName}>
                  <span className="font-medium">{u.fileName}:</span> <span className="text-muted-foreground">{u.columns.join(", ")}</span>
                </p>
              ))}
            </CardContent>
          </Card>
        )}

        {errored.length > 0 && (
          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="text-base">Files that could not be read</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {errored.map((f) => (
                <p key={f.id}>
                  <span className="font-medium">{f.name}:</span> {f.error?.message}
                </p>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Validation issues by file</CardTitle>
              <CardDescription>Choose a file to see its row-level issues.</CardDescription>
            </div>
            <Select value={current?.id ?? ""} onValueChange={setFileId}>
              <SelectTrigger className="w-72" aria-label="Choose file">
                <SelectValue placeholder="Choose a file" />
              </SelectTrigger>
              <SelectContent>
                {files
                  .filter((f) => f.status !== "error")
                  .map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name} ({fmtInt(f.validation?.issueCount ?? f.mappingProblems.length)})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="max-h-[560px] overflow-auto px-0">
            {!current ? (
              <p className="px-6 py-8 text-center text-sm text-muted-foreground">No readable files.</p>
            ) : (
              <IssuesPanel key={`${current.id}-${current.validation?.validatedAt}`} sessionId={session.id} fileId={current.id} />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
