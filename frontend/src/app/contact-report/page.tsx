"use client";

import { ExternalLink, FlaskConical, Info, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { fmtBytes, fmtDuration, fmtInt, fmtPct, fmtStamp } from "@/lib/format";
import type { ContactFilters, ContactView, DuplicateRuleResult, FollowUpStatus } from "@/lib/types";
import { Donut, DayLine, MultiBar } from "@/components/contact/charts";
import { ReportGenerator } from "@/components/contact/report-generator";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { FacetSelect } from "@/components/leads/facet-select";
import { PageHeader } from "@/components/page-header";
import { errorMessage, useSession } from "@/components/session-provider";
import { EmptyState, PageSkeleton } from "@/components/states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const FOLLOW_LABEL: Record<FollowUpStatus, string> = { overdue: "Overdue", upcoming: "On/after report date", none: "No follow-up date" };
const FOLLOW_FROM_LABEL: Record<string, FollowUpStatus> = { Overdue: "overdue", "On/after report date": "upcoming", "No follow-up date": "none" };

function ChartCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function ContactReportPage() {
  const { session, loading, setLeadFilter } = useSession();
  const router = useRouter();
  const leadFiles = useMemo(() => (session?.files ?? []).filter((f) => f.status === "ready" && f.kind === "leads"), [session?.files]);
  const [fileIds, setFileIds] = useState<string[] | null>(null);
  const [reportDate, setReportDate] = useState<string | null>(null);
  const [filters, setFilters] = useState<ContactFilters>({});
  const [view, setView] = useState<ContactView | null>(null);
  const [rules, setRules] = useState<DuplicateRuleResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionId = session?.id;
  const scope = fileIds ?? (session?.report.fileIds.length ? session.report.fileIds : leadFiles.map((f) => f.id));
  const scopeKey = scope.join(",");
  const version = `${session?.files.map((f) => f.validation?.validatedAt).join(",")}|${session?.settings.duplicateMode}|${JSON.stringify(session?.settings.matchRules)}|${session?.duplicateDecisionCount}|${session?.report.lastProcessedAt}`;

  useEffect(() => {
    if (!sessionId || !scopeKey) return;
    let cancelled = false;
    api
      .contactReport(sessionId, { fileIds: scopeKey.split(","), reportDate: reportDate ?? undefined, ...filters })
      .then((v) => {
        if (cancelled) return;
        setView(v);
        setError(null);
      })
      .catch((e) => !cancelled && setError(errorMessage(e)));
    api
      .duplicateRules(sessionId, scopeKey.split(","))
      .then((r) => !cancelled && setRules(r.rules))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sessionId, scopeKey, reportDate, filters, version]);

  if (loading) return <PageSkeleton />;
  if (!session) return <EmptyState title="No reporting session yet">Upload SalesMax contact exports first.</EmptyState>;
  if (!leadFiles.length) return <EmptyState title="No lead files ready">Upload files and confirm their column mapping on the Upload page.</EmptyState>;

  const toggle = (key: keyof ContactFilters, value: string) =>
    setFilters((f) => {
      const cur = (f[key] as string[] | undefined) ?? [];
      const next = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
      return { ...f, [key]: next.length ? next : undefined };
    });
  const openLeads = () => {
    setLeadFilter({ fileIds: scope.length === 1 ? scope : undefined, owners: filters.owners, stages: filters.stages, dispositions: filters.dispositions, followUp: filters.followUp });
    router.push("/leads");
  };
  const chips = [
    ...(filters.owners ?? []).map((v) => ({ k: "owners" as const, v, l: `Owner: ${v}` })),
    ...(filters.stages ?? []).map((v) => ({ k: "stages" as const, v, l: `Stage: ${v}` })),
    ...(filters.dispositions ?? []).map((v) => ({ k: "dispositions" as const, v, l: `Disposition: ${v}` })),
    ...(filters.followUp ?? []).map((v) => ({ k: "followUp" as const, v, l: `Follow-up: ${FOLLOW_LABEL[v]}` })),
  ];
  const r = view?.report;
  const k = r?.kpis;
  const total = k?.totalLeads ?? 0;

  return (
    <>
      <PageHeader
        title="Lead Contact Report"
        description="The SalesMax Lead Contact Report — key numbers, owner performance, stages, follow-ups and dispositions — calculated from the uploaded files with the same rules as the reference workbook. Tables, graphs and downloads always show the same figures."
        actions={
          <Button variant="outline" onClick={openLeads}>
            <ExternalLink data-icon="inline-start" />
            Open these leads in the table
          </Button>
        }
      />
      {session.mode === "test" && (
        <Alert className="mb-4 border-[color:var(--status-warning)]">
          <FlaskConical />
          <AlertTitle>Testing mode</AlertTitle>
          <AlertDescription>Reports from this session are labelled TEST. Use “Reset test” in the toolbar to start over; production sessions are not affected.</AlertDescription>
        </Alert>
      )}

      {/* Filters: one row above the content */}
      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border bg-muted/30 p-3">
        <div className="space-y-1">
          <Label htmlFor="cr-date" className="text-xs">
            Report date (follow-ups before it are overdue)
          </Label>
          <Input id="cr-date" type="date" value={reportDate ?? view?.reportDate ?? ""} onChange={(e) => setReportDate(e.target.value || null)} className="h-8 w-44" />
        </div>
        <FacetSelect label="Files" facets={leadFiles.map((f) => ({ value: f.name, count: f.validation?.dataRows ?? 0 }))} value={leadFiles.filter((f) => scope.includes(f.id)).map((f) => f.name)} onChange={(names) => setFileIds(names.length ? leadFiles.filter((f) => names.includes(f.name)).map((f) => f.id) : null)} />
        {view && (
          <>
            <FacetSelect label="Owner" facets={view.facets.owners} value={filters.owners ?? []} onChange={(v) => setFilters((f) => ({ ...f, owners: v.length ? v : undefined }))} />
            <FacetSelect label="Stage" facets={view.facets.stages} value={filters.stages ?? []} onChange={(v) => setFilters((f) => ({ ...f, stages: v.length ? v : undefined }))} />
            <FacetSelect label="Disposition" facets={view.facets.dispositions} value={filters.dispositions ?? []} onChange={(v) => setFilters((f) => ({ ...f, dispositions: v.length ? v : undefined }))} />
            <FacetSelect label="Follow-up" facets={view.facets.followUp} value={filters.followUp ?? []} onChange={(v) => setFilters((f) => ({ ...f, followUp: v.length ? (v as FollowUpStatus[]) : undefined }))} format={(v) => FOLLOW_LABEL[v as FollowUpStatus] ?? v} />
          </>
        )}
        {chips.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setFilters({})}>
            <X data-icon="inline-start" />
            Clear filters
          </Button>
        )}
      </div>
      {chips.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <Badge key={c.l} variant="secondary" className="gap-1 pr-1">
              {c.l}
              <button type="button" aria-label={`Remove filter ${c.l}`} className="rounded p-0.5 hover:bg-background" onClick={() => toggle(c.k, c.v)}>
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      {!view || !r || !k ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="space-y-6">
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-4 py-2 text-sm" data-testid="scope-strip">
            <Info className="size-4 text-muted-foreground" aria-hidden />
            <span>
              Raw rows <b className="tabular-nums">{fmtInt(view.counts.rawRows)}</b>
            </span>
            <span>
              Invalid <b className="tabular-nums">{fmtInt(view.counts.rejected)}</b>
            </span>
            <span>
              Unique leads <b className="tabular-nums">{fmtInt(view.counts.uniqueLeads)}</b>
            </span>
            <span>
              Duplicate rows excluded <b className="tabular-nums">{fmtInt(view.counts.duplicateRowsExcluded)}</b>
            </span>
            <span>
              Leads in report <b className="tabular-nums">{fmtInt(view.counts.reportedLeads)}</b>
            </span>
            {chips.length > 0 && (
              <span>
                Filtered leads <b className="tabular-nums">{fmtInt(view.counts.filteredLeads)}</b>
              </span>
            )}
            <span className="text-muted-foreground">Report date {view.reportDate}</span>
          </p>
          {r.missingFields.length > 0 && <p className="text-sm text-[color:var(--status-warning)]">Not in the uploaded data, so related figures show N/A: {r.missingFields.join(", ")}.</p>}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="contact-kpis">
            <KpiCard label="Total leads" value={fmtInt(k.totalLeads)} sub={chips.length ? "Filtered view" : "Leads in this report"} />
            <KpiCard label="Not yet worked" value={fmtInt(k.notWorked)} sub="AWAITING FIRST TOUCH = NOT_WORKED" unavailable={k.notWorked === null ? "AWAITING FIRST TOUCH is not mapped." : null} />
            <KpiCard label="Worked at least once" value={fmtInt(k.workedAtLeastOnce)} sub="Leads with an ATTEMPTS number" unavailable={k.workedAtLeastOnce === null ? "ATTEMPTS is not mapped." : null} />
            <KpiCard label="Qualified leads" value={fmtInt(k.qualified)} sub={k.qualificationRate !== null ? `${fmtPct(k.qualificationRate)} of total leads` : undefined} unavailable={k.qualified === null ? "LEAD STAGE is not mapped." : null} />
            <KpiCard label="Total attempts" value={fmtInt(k.totalAttempts)} unavailable={k.totalAttempts === null ? "ATTEMPTS is not mapped." : null} />
            <KpiCard label="Total calls" value={fmtInt(k.totalCalls)} unavailable={k.totalCalls === null ? "TOTAL CALLS is not mapped." : null} />
            <KpiCard label="Calls today" value={fmtInt(k.callsToday)} unavailable={k.callsToday === null ? "CALLS TODAY is not mapped." : null} />
            <KpiCard label="Marked INTERESTED" value={fmtInt(k.interested)} sub="LEAD DISPOSITION = INTERESTED" unavailable={k.interested === null ? "LEAD DISPOSITION is not mapped." : null} />
            <KpiCard label="Overdue follow-ups" value={fmtInt(k.overdueFollowUps)} sub={`NEXT FOLLOWUP before ${view.reportDate}`} unavailable={k.overdueFollowUps === null ? "NEXT FOLLOWUP is not mapped." : null} />
            <KpiCard label="Follow-ups on/after report date" value={fmtInt(k.upcomingFollowUps)} unavailable={k.upcomingFollowUps === null ? "NEXT FOLLOWUP is not mapped." : null} />
            <KpiCard label="No follow-up date" value={fmtInt(k.noFollowUpDate)} sub="Blank or not a date" unavailable={k.noFollowUpDate === null ? "NEXT FOLLOWUP is not mapped." : null} />
            <KpiCard label="Qualification rate" value={fmtPct(k.qualificationRate)} sub="Qualified ÷ total leads" unavailable={k.qualificationRate === null ? "LEAD STAGE is not mapped." : null} />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <ChartCard title="Leads by owner" description="Click a bar to filter">
              <MultiBar ariaLabel="Leads by owner" data={r.owners.map((o) => ({ label: o.owner, leads: o.leads }))} series={[{ key: "leads", name: "Leads" }]} onSelect={(v) => toggle("owners", v)} empty="LEAD OWNER is not mapped." />
            </ChartCard>
            <ChartCard title="Qualified vs not qualified by owner" description="Stacked: qualified + not qualified = owner's leads">
              <MultiBar ariaLabel="Qualified vs not qualified by owner" stacked data={r.owners.map((o) => ({ label: o.owner, qualified: o.qualified, notQualified: o.notQualified }))} series={[{ key: "qualified", name: "Qualified" }, { key: "notQualified", name: "Not qualified" }]} onSelect={(v) => toggle("owners", v)} empty="LEAD OWNER is not mapped." />
            </ChartCard>
            <ChartCard title="Leads by stage" description="Click a stage to filter">
              <Donut ariaLabel="Leads by stage" data={r.stages.map((s) => ({ label: s.stage, value: s.leads }))} onSelect={(v) => toggle("stages", v)} empty="LEAD STAGE is not mapped." />
            </ChartCard>
            <ChartCard title="Total calls and calls today by owner">
              <MultiBar ariaLabel="Total calls and calls today by owner" data={r.owners.map((o) => ({ label: o.owner, totalCalls: o.totalCalls, callsToday: o.callsToday }))} series={[{ key: "totalCalls", name: "Total calls" }, { key: "callsToday", name: "Calls today" }]} onSelect={(v) => toggle("owners", v)} empty={k.totalCalls === null ? "TOTAL CALLS is not mapped." : "No calls."} />
            </ChartCard>
            <ChartCard title="Leads not yet worked by owner">
              <MultiBar ariaLabel="Leads not yet worked by owner" data={k.notWorked === null ? [] : r.owners.map((o) => ({ label: o.owner, notWorked: o.notWorked }))} series={[{ key: "notWorked", name: "Not worked" }]} onSelect={(v) => toggle("owners", v)} empty="AWAITING FIRST TOUCH is not mapped." />
            </ChartCard>
            <ChartCard title="Follow-up status" description={`Relative to the report date ${view.reportDate}. Click to filter.`}>
              <Donut
                ariaLabel="Follow-up status"
                data={k.overdueFollowUps === null ? [] : [{ label: FOLLOW_LABEL.overdue, value: k.overdueFollowUps }, { label: FOLLOW_LABEL.upcoming, value: k.upcomingFollowUps ?? 0 }, { label: FOLLOW_LABEL.none, value: k.noFollowUpDate ?? 0 }]}
                colors={["var(--status-critical)", "var(--status-good)", "var(--series-other)"]}
                onSelect={(v) => toggle("followUp", FOLLOW_FROM_LABEL[v])}
                empty="NEXT FOLLOWUP is not mapped."
              />
            </ChartCard>
            <ChartCard title="Lead count by file" description="Leads each file contributes to this report (after duplicate handling)">
              <MultiBar ariaLabel="Lead count by file" data={view.files.map((f) => ({ label: f.fileName, leads: f.leadsInReport, qualified: f.qualified }))} series={[{ key: "leads", name: "Leads in report" }, { key: "qualified", name: "Qualified" }]} />
            </ChartCard>
            <ChartCard title="Record quality by file" description="Valid (complete), valid but incomplete, duplicates and invalid rows">
              <MultiBar
                ariaLabel="Record quality by file"
                stacked
                data={view.files.map((f) => ({ label: f.fileName, complete: Math.max(0, f.valid - f.incomplete), incomplete: Math.min(f.incomplete, f.valid), duplicate: f.duplicate, invalid: f.invalid }))}
                series={[
                  { key: "complete", name: "Valid", color: "var(--status-good)" },
                  { key: "incomplete", name: "Incomplete", color: "var(--series-other)" },
                  { key: "duplicate", name: "Duplicate", color: "var(--status-warning)" },
                  { key: "invalid", name: "Invalid", color: "var(--status-critical)" },
                ]}
              />
            </ChartCard>
          </div>
          <ChartCard title="Leads last worked per day" description="By LAST WORKED date">
            <DayLine ariaLabel="Leads last worked per day" data={r.lastWorkedByDate} />
          </ChartCard>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Performance by Lead Owner</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto px-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">Lead Owner</TableHead>
                      <TableHead className="text-right">Leads</TableHead>
                      <TableHead className="text-right">Not Worked</TableHead>
                      <TableHead className="text-right">Qualified</TableHead>
                      <TableHead className="text-right">Total Calls</TableHead>
                      <TableHead className="pr-6 text-right">Calls Today</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.owners.map((o) => (
                      <TableRow key={o.owner} className="cursor-pointer" onClick={() => toggle("owners", o.owner)}>
                        <TableCell className="pl-6 font-medium">{o.owner}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtInt(o.leads)}</TableCell>
                        <TableCell className="text-right tabular-nums">{k.notWorked === null ? "N/A" : fmtInt(o.notWorked)}</TableCell>
                        <TableCell className="text-right tabular-nums">{k.qualified === null ? "N/A" : fmtInt(o.qualified)}</TableCell>
                        <TableCell className="text-right tabular-nums">{k.totalCalls === null ? "N/A" : fmtInt(o.totalCalls)}</TableCell>
                        <TableCell className="pr-6 text-right tabular-nums">{k.callsToday === null ? "N/A" : fmtInt(o.callsToday)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  {r.owners.length > 0 && (
                    <TableFooter>
                      <TableRow>
                        <TableCell className="pl-6 font-semibold">Total</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtInt(r.owners.reduce((s, o) => s + o.leads, 0))}</TableCell>
                        <TableCell className="text-right tabular-nums">{k.notWorked === null ? "N/A" : fmtInt(r.owners.reduce((s, o) => s + o.notWorked, 0))}</TableCell>
                        <TableCell className="text-right tabular-nums">{k.qualified === null ? "N/A" : fmtInt(r.owners.reduce((s, o) => s + o.qualified, 0))}</TableCell>
                        <TableCell className="text-right tabular-nums">{k.totalCalls === null ? "N/A" : fmtInt(r.owners.reduce((s, o) => s + o.totalCalls, 0))}</TableCell>
                        <TableCell className="pr-6 text-right tabular-nums">{k.callsToday === null ? "N/A" : fmtInt(r.owners.reduce((s, o) => s + o.callsToday, 0))}</TableCell>
                      </TableRow>
                    </TableFooter>
                  )}
                </Table>
              </CardContent>
            </Card>
            <div className="space-y-6">
              {(
                [
                  ["Leads by Stage", "Lead Stage", r.stages.map((s) => [s.stage, s.leads, s.pct] as const), "stages"],
                  ["Lead Disposition (latest call result)", "Disposition", r.dispositions.map((d) => [d.disposition, d.leads, d.pct] as const), "dispositions"],
                ] as const
              ).map(([title, head, rows, key]) =>
                rows.length ? (
                  <Card key={title}>
                    <CardHeader>
                      <CardTitle className="text-base">{title}</CardTitle>
                    </CardHeader>
                    <CardContent className="px-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="pl-6">{head}</TableHead>
                            <TableHead className="text-right">Leads</TableHead>
                            <TableHead className="pr-6 text-right">% of Total</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.map(([label, n, p]) => (
                            <TableRow key={label} className="cursor-pointer" onClick={() => toggle(key, label)}>
                              <TableCell className="pl-6">{label}</TableCell>
                              <TableCell className="text-right tabular-nums">{fmtInt(n)}</TableCell>
                              <TableCell className="pr-6 text-right tabular-nums">{fmtPct(p)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                        <TableFooter>
                          <TableRow>
                            <TableCell className="pl-6 font-semibold">Total</TableCell>
                            <TableCell className="text-right tabular-nums">{fmtInt(rows.reduce((s, x) => s + x[1], 0))}</TableCell>
                            <TableCell className="pr-6 text-right tabular-nums">{total ? fmtPct((rows.reduce((s, x) => s + x[1], 0) / total) * 100) : "N/A"}</TableCell>
                          </TableRow>
                        </TableFooter>
                      </Table>
                    </CardContent>
                  </Card>
                ) : null,
              )}
            </div>
          </div>

          {r.notes.length > 0 && (
            <Card className="gap-3 py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-sm">Notes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 px-4 text-sm">
                {r.notes.map((n) => (
                  <p key={n}>• {n}</p>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Files and columns</CardTitle>
              <CardDescription>Columns of each file compared with the 16-column SalesMax schema. Missing columns are reported, never filled in.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">File</TableHead>
                    <TableHead>Worksheet</TableHead>
                    <TableHead className="text-right">Rows</TableHead>
                    <TableHead className="text-right">Columns</TableHead>
                    <TableHead className="text-right">Duplicates</TableHead>
                    <TableHead className="text-right">Invalid</TableHead>
                    <TableHead>Missing SalesMax columns</TableHead>
                    <TableHead>Additional columns</TableHead>
                    <TableHead className="pr-6">Uploaded · processing</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.files.map((f) => (
                    <TableRow key={f.fileId}>
                      <TableCell className="max-w-56 pl-6">
                        <div className="truncate font-medium" title={f.fileName}>
                          {f.fileName}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {f.ext.toUpperCase()} · {fmtBytes(f.size)}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        {f.sheetName}
                        {f.sheetNames.length > 1 && <span className="text-muted-foreground"> (of {f.sheetNames.join(", ")})</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(f.rows)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(f.detectedColumns)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(f.duplicate)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(f.invalid)}</TableCell>
                      <TableCell className="max-w-64 text-xs whitespace-normal">{f.missingSalesmax.length ? <span className="text-[color:var(--status-warning)]">{f.missingSalesmax.join(", ")}</span> : "None"}</TableCell>
                      <TableCell className="max-w-48 text-xs whitespace-normal">{f.additionalColumns.join(", ") || "None"}</TableCell>
                      <TableCell className="pr-6 text-xs whitespace-nowrap">
                        {fmtStamp(f.uploadCompletedAt)} · {fmtDuration(f.processingMs)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {rules && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Compare duplicate-handling rules</CardTitle>
                <CardDescription>How many leads each rule would keep for the selected files. Nothing changes until you pick a rule on the Duplicates page.</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto px-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">Rule</TableHead>
                      <TableHead className="text-right">Accepted rows</TableHead>
                      <TableHead className="text-right">Leads in report</TableHead>
                      <TableHead className="text-right">Excluded</TableHead>
                      <TableHead className="pr-6 text-right">Possible duplicates (kept)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rules.map((x) => (
                      <TableRow key={x.label} className={x.current ? "bg-primary/5" : undefined}>
                        <TableCell className="pl-6">
                          {x.label}
                          {x.current && (
                            <Badge variant="secondary" className="ml-2">
                              current
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtInt(x.acceptedRows)}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{fmtInt(x.leadsInReport)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtInt(x.excludedRows)}</TableCell>
                        <TableCell className="pr-6 text-right tabular-nums">{fmtInt(x.possibleDuplicates)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <ReportGenerator key={`${scopeKey}|${view.defaultColumns.join(",")}`} sessionId={session.id} view={view} fileIds={scope} filters={filters} reportDate={view.reportDate} testMode={session.mode === "test"} />
        </div>
      )}
    </>
  );
}
