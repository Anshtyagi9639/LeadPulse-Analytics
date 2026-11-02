"use client";

import { FileSpreadsheet, FileText, Loader2, Sheet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { download } from "@/lib/api";
import { duplicateModeLabel, fmtDay } from "@/lib/format";
import { ReportBuilder } from "@/components/exports/report-builder";
import { PageHeader } from "@/components/page-header";
import { errorMessage, useSession } from "@/components/session-provider";
import { RequireReport } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const CSV_TABLES = [
  ["executive", "Executive summary"],
  ["files", "File-wise summary"],
  ["campaigns", "Campaign-wise performance"],
  ["sources", "Source-wise performance"],
  ["counsellors", "Counsellor performance"],
  ["funnel", "Lead funnel"],
  ["data-quality", "Data quality"],
  ["definitions", "KPI definitions"],
  ["validation-errors", "Validation errors"],
] as const;

export default function ExportsPage() {
  const { session, report } = useSession();
  const [pending, setPending] = useState<string | null>(null);
  const get = async (key: string, path: string) => {
    if (!session) return;
    setPending(key);
    try {
      await download(`/sessions/${session.id}${path}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPending(null);
    }
  };
  const spin = (k: string) => (pending === k ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null);
  const f = report?.settings.filters;

  return (
    <RequireReport>
      <PageHeader title="Reports & downloads" description="Generate lead reports, file comparisons and data-quality summaries, or download the management report. Text values are protected against spreadsheet formula injection." />
      {report && (
        <p className="mb-6 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
          <span className="font-medium">Current view:</span> {report.period.isRange ? `${fmtDay(report.period.from)} – ${fmtDay(report.period.to)}` : fmtDay(report.period.from)} · {report.scope.fileNames.length} file(s) · {duplicateModeLabel(report.settings.duplicateMode)}
          {f && (f.campaigns.length || f.sources.length) ? ` · filtered to ${[...f.campaigns, ...f.sources].join(", ")}` : " · no filters"}
        </p>
      )}
      <div className="mb-6">
        <ReportBuilder />
      </div>
      <h2 className="mb-3 text-lg font-semibold">Management report</h2>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSpreadsheet className="size-4 text-primary" aria-hidden />
              Excel workbook
            </CardTitle>
            <CardDescription>Executive Summary, File-wise, Campaign-wise, Source-wise, Counsellor, Lead Funnel, Data Quality, KPI Definitions and Validation Errors worksheets.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => get("xlsx", "/export/excel")} disabled={pending !== null}>
              {spin("xlsx")}Download Excel (.xlsx)
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="size-4 text-primary" aria-hidden />
              PDF management report
            </CardTitle>
            <CardDescription>KPI cards, upload summary, campaign and sales tables, funnel, data-quality findings, recommendations and calculation notes.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => get("pdf", "/export/pdf")} disabled={pending !== null}>
              {spin("pdf")}Download PDF
            </Button>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sheet className="size-4 text-primary" aria-hidden />
              CSV tables
            </CardTitle>
            <CardDescription>One CSV per summary table (UTF-8, opens directly in Excel).</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {CSV_TABLES.map(([k, label]) => (
              <Button key={k} variant="outline" size="sm" onClick={() => get(k, `/export/csv/${k}`)} disabled={pending !== null}>
                {spin(k)}
                {label}
              </Button>
            ))}
          </CardContent>
        </Card>
      </div>
    </RequireReport>
  );
}
