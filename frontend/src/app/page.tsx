"use client";

import { ArrowRight, Info } from "lucide-react";
import Link from "next/link";
import { fmtInt, fmtPct } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { useSession } from "@/components/session-provider";
import { PageSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dropzone } from "@/components/upload/dropzone";
import { FilesTable } from "@/components/upload/files-table";
import { PeriodCard } from "@/components/upload/period-card";
import { WorkflowSteps } from "@/components/upload/workflow-steps";

function CombinedSummary() {
  const { report } = useSession();
  if (!report) return null;
  const leadFiles = report.files.filter((f) => f.kind === "leads");
  const sum = (k: "dataRows" | "accepted" | "rejected" | "blankRows" | "inReport" | "duplicateRows" | "outOfPeriod") => leadFiles.reduce((s, f) => s + (f[k] as number), 0);
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">File-level and combined summary</CardTitle>
          <CardDescription>Every row is accounted for: accepted, rejected, skipped as blank, or set aside as a duplicate.</CardDescription>
        </div>
        <Button asChild>
          <Link href="/dashboard">
            Open dashboard <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="overflow-x-auto px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">File</TableHead>
              <TableHead className="text-right">Data rows</TableHead>
              <TableHead className="text-right">Accepted</TableHead>
              <TableHead className="text-right">Rejected</TableHead>
              <TableHead className="text-right">Blank skipped</TableHead>
              <TableHead className="text-right">Duplicate rows</TableHead>
              <TableHead className="text-right">Outside period</TableHead>
              <TableHead className="text-right">In report</TableHead>
              <TableHead className="pr-6 text-right">Unique leads</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leadFiles.map((f) => (
              <TableRow key={f.fileId}>
                <TableCell className="max-w-72 truncate pl-6 font-medium">{f.fileName}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtInt(f.dataRows)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtInt(f.accepted)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtInt(f.rejected)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtInt(f.blankRows)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtInt(f.duplicateRows)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtInt(f.outOfPeriod)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtInt(f.inReport)}</TableCell>
                <TableCell className="pr-6 text-right tabular-nums">{fmtInt(f.uniqueLeads)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="pl-6 font-semibold">All files combined</TableCell>
              <TableCell className="text-right tabular-nums">{fmtInt(sum("dataRows"))}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtInt(sum("accepted"))}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtInt(sum("rejected"))}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtInt(sum("blankRows"))}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtInt(report.counts.duplicateRows)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtInt(report.counts.leadsOutsidePeriod)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtInt(report.counts.reportedLeads)}</TableCell>
              <TableCell className="pr-6 text-right tabular-nums">{fmtInt(report.counts.uniqueLeads)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
        <p className="mt-3 flex items-start gap-1.5 px-6 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          The combined duplicate count includes duplicates found across files, so it can exceed the per-file totals. Duplicate rate: {fmtPct(report.dataQuality.duplicateRate as number | null)}.
        </p>
      </CardContent>
    </Card>
  );
}

export default function UploadPage() {
  const { session, loading } = useSession();
  const periodKey = `${session?.id}-${JSON.stringify(session?.settings.dateRange ?? null)}`;
  if (loading) return <PageSkeleton />;
  return (
    <>
      <PageHeader
        title={session ? "Upload & files" : "Generate today's lead report"}
        description="Select the reporting date, upload one or more Excel/CSV exports, check the column mapping, then process the files. You can add more files to the same session at any time."
      />
      <div className="space-y-6">
        <WorkflowSteps />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Dropzone compact={Boolean(session?.files.length)} />
          <PeriodCard key={periodKey} />
        </div>
        <FilesTable />
        <CombinedSummary />
      </div>
    </>
  );
}
