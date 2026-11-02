"use client";

import { AlertTriangle, Info, Lightbulb } from "lucide-react";
import { useRouter } from "next/navigation";
import { FileQualityChart, StatusDonut, TrendChart } from "@/components/dashboard/charts";
import { HBarChart } from "@/components/dashboard/bar-chart";
import { CAMPAIGN_COLS, SortableTable, type Col } from "@/components/dashboard/breakdown-table";
import { DashboardFilters } from "@/components/dashboard/filters";
import { Funnel } from "@/components/dashboard/funnel";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/page-header";
import { useSession } from "@/components/session-provider";
import { RequireReport } from "@/components/states";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtDay, fmtInt, fmtMinutes, fmtMoney, fmtPct } from "@/lib/format";
import type { BreakdownRow, CounsellorRow, LeadQuery, Report } from "@/lib/types";

/** Opens the lead table with a filter (chart click-through). */
function useOpenLeads() {
  const router = useRouter();
  const { setLeadFilter } = useSession();
  return (q: LeadQuery) => {
    setLeadFilter(q);
    router.push("/leads");
  };
}

function defn(report: Report | null, defs: { key: string; formula: string }[] | undefined, key: string) {
  return defs?.find((d) => d.key === key)?.formula;
}

function Notes({ report }: { report: Report }) {
  if (!report.notes.length) return null;
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">Calculation notes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 px-4">
        {report.notes.map((n) => (
          <p key={n.message} className="flex items-start gap-2 text-sm">
            {n.level === "warning" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[color:var(--status-warning)]" aria-label="Warning" /> : <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Note" />}
            <span>{n.message}</span>
          </p>
        ))}
      </CardContent>
    </Card>
  );
}

function Overview() {
  const { report, meta, recommendations } = useSession();
  const openLeads = useOpenLeads();
  const r = report!;
  const q = r.quality;
  const fileQuality = r.files
    .filter((f) => f.kind === "leads")
    .map((f) => ({ fileId: f.fileId, fileName: f.fileName, valid: f.accepted - f.duplicateRows, duplicate: f.duplicateRows, invalid: f.rejected }));
  const cur = r.currency;
  const u = r.unavailable;
  const d = (k: string) => defn(r, meta?.definitions, k);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total leads" value={fmtInt(r.overview.totalLeads)} sub={`${fmtInt(r.counts.rawRows)} raw rows · ${fmtInt(r.counts.duplicateRowsExcluded)} duplicates excluded`} help={d("totalLeads")} />
        <KpiCard label="Unique leads" value={fmtInt(r.overview.uniqueLeads)} sub={`${fmtInt(r.counts.duplicateRows)} confirmed duplicate rows · ${fmtInt(r.counts.possibleDuplicateRows)} possible`} help={d("uniqueLeads")} />
        <KpiCard label="Qualified leads" value={fmtInt(r.overview.qualifiedLeads)} sub={r.sales.qualificationRate !== null ? `${fmtPct(r.sales.qualificationRate)} qualification rate · ${fmtInt(r.sales.pendingQualification)} pending` : undefined} help={d("qualificationRate")} unavailable={u.qualifiedLeads} />
        <KpiCard label="Total ad spend" value={fmtMoney(r.overview.totalSpend, cur)} sub={r.marketing.unattributedSpend ? `${fmtMoney(r.marketing.unattributedSpend, cur)} has no matching leads` : undefined} help={d("totalSpend")} unavailable={u.totalSpend} />
        <KpiCard label="CPL" value={fmtMoney(r.overview.cpl, cur)} sub={r.marketing.attributableLeads !== null ? `${fmtInt(r.marketing.attributableLeads)} attributable leads · ${fmtMoney(r.marketing.costPerQualified, cur)} per qualified` : undefined} help={d("cpl")} unavailable={u.cpl} />
        <KpiCard label="Applications" value={fmtInt(r.overview.applications)} sub={r.conversion.applicationRate !== null ? `${fmtPct(r.conversion.applicationRate)} of leads · ${fmtInt(r.conversion.offers)} offers` : undefined} help={d("applicationRate")} unavailable={u.applications} />
        <KpiCard label="Enrolments" value={fmtInt(r.overview.enrolments)} sub={r.conversion.enrolmentRate !== null ? `${fmtPct(r.conversion.enrolmentRate)} of leads${r.conversion.revenue !== null ? ` · ${fmtMoney(r.conversion.revenue, cur)} fees` : ""}` : undefined} help={d("enrolmentRate")} unavailable={u.enrolments} />
        <KpiCard label="Target achievement" value={fmtPct(r.overview.targetAchievement)} sub={r.marketing.targetLeads !== null ? `Target ${fmtInt(r.marketing.targetLeads)} leads${r.marketing.budgetUtilisation !== null ? ` · ${fmtPct(r.marketing.budgetUtilisation)} of budget used` : ""}` : undefined} help={d("targetAchievement")} unavailable={u.targetAchievement} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" aria-label="Record quality">
        <KpiCard label="Total records" value={fmtInt(q.totalRecords)} sub="Data rows in the processed lead files" />
        <KpiCard label="Valid leads" value={fmtInt(q.validLeads)} sub={`${fmtInt(q.possibleDuplicates)} possible duplicates still counted`} help="Accepted rows with confirmed duplicates collapsed (unique leads)." />
        <KpiCard label="Duplicate leads" value={fmtInt(q.duplicateLeads)} sub="Confirmed duplicate rows" />
        <KpiCard label="Invalid records" value={fmtInt(q.invalidLeads)} sub={`${fmtInt(q.leadsWithWarnings)} more accepted with warnings`} help="Rows rejected because they have no Lead ID, valid phone, valid email or name." />
        <KpiCard label="Validation success" value={fmtPct(q.validationSuccessRate)} sub="Accepted ÷ total records" />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Leads over time</CardTitle>
            <CardDescription>By Lead Created Date, {r.trend.granularity === "hour" ? "per hour" : "per day"}</CardDescription>
          </CardHeader>
          <CardContent>
            <TrendChart trend={r.trend} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lead status</CardTitle>
            <CardDescription>Click a status to open those leads</CardDescription>
          </CardHeader>
          <CardContent>
            <StatusDonut data={r.statusDistribution} onSelect={(st) => openLeads({ leadStatuses: [st === "(No status)" ? "(No status)" : st] })} />
          </CardContent>
        </Card>
      </div>
      {fileQuality.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Record quality by file</CardTitle>
            <CardDescription>Valid, duplicate and invalid records in each processed file. Click a segment to review those records.</CardDescription>
          </CardHeader>
          <CardContent>
            <FileQualityChart data={fileQuality} onSelect={(fileId, status) => openLeads({ fileIds: [fileId], statuses: [status] })} />
          </CardContent>
        </Card>
      )}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lead funnel</CardTitle>
            <CardDescription>Stages are shown only where the data defines them</CardDescription>
          </CardHeader>
          <CardContent>
            <Funnel stages={r.funnel} />
          </CardContent>
        </Card>
        <div className="space-y-6">
          {recommendations.length > 0 && (
            <Card className="gap-3 py-4">
              <CardHeader className="px-4">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Lightbulb className="size-4 text-primary" aria-hidden />
                  Rule-based recommendations
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 px-4">
                {recommendations.map((rec) => (
                  <div key={rec.finding} className="text-sm">
                    <span className="font-medium">{rec.area}: </span>
                    {rec.finding} <span className="text-muted-foreground">{rec.action}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          <Notes report={r} />
        </div>
      </div>
    </div>
  );
}

function Campaigns({ kind }: { kind: "campaigns" | "sources" }) {
  const { report } = useSession();
  const openLeads = useOpenLeads();
  const r = report!;
  const rows = r[kind];
  const cur = r.currency;
  const first = kind === "campaigns" ? "Campaign" : "Source";
  const withAds = rows.some((x) => x.impressions !== null || x.clicks !== null || x.budget !== null || x.baselineCpl !== null);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Leads by {first.toLowerCase()}</CardTitle>
          <CardDescription>{kind === "sources" ? "Only sources present in the uploaded data" : "Rows in the report per campaign"}</CardDescription>
        </CardHeader>
        <CardContent>
          <HBarChart
            ariaLabel={`Leads by ${first.toLowerCase()}`}
            data={rows.map((c) => ({ label: c.label, value: c.leads, detail: [`${fmtInt(c.qualified)} qualified`, `${fmtPct(c.share)} of leads`, `CPL ${fmtMoney(c.cpl, cur)}`] }))}
            format={(v) => fmtInt(v)}
            onSelect={(label) => openLeads(kind === "campaigns" ? { campaigns: [label] } : { sources: [label] })}
          />
        </CardContent>
      </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">CPL by {first.toLowerCase()}</CardTitle>
            <CardDescription>Spend ÷ leads for {first.toLowerCase()}s with spend</CardDescription>
          </CardHeader>
          <CardContent>
            <HBarChart
              ariaLabel={`CPL by ${first.toLowerCase()}`}
              data={[...rows].sort((a, b) => (b.cpl ?? -1) - (a.cpl ?? -1)).map((c) => ({ label: c.label, value: c.cpl, detail: [`Spend ${fmtMoney(c.spend, cur)}`, `${fmtInt(c.leads)} leads`] }))}
              format={(v) => fmtMoney(v, cur)}
              emptyText="No spend data — add spend on the Spend & Targets page."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Qualification rate by {first.toLowerCase()}</CardTitle>
            <CardDescription>Qualified ÷ assessed leads</CardDescription>
          </CardHeader>
          <CardContent>
            <HBarChart
              ariaLabel={`Qualification rate by ${first.toLowerCase()}`}
              data={[...rows].sort((a, b) => (b.qualificationRate ?? -1) - (a.qualificationRate ?? -1)).map((c) => ({ label: c.label, value: c.qualificationRate, detail: [`${fmtInt(c.qualified)} qualified of ${fmtInt(c.qualified + c.unqualified)} assessed`] }))}
              format={(v) => fmtPct(v, 0)}
              emptyText="Qualification status is not mapped."
            />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{first}-wise performance</CardTitle>
          <CardDescription>Click a column to sort. N/A means the data needed for that metric is missing.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <SortableTable<BreakdownRow> rows={rows} cols={CAMPAIGN_COLS(first, withAds)} currency={cur} rowKey={(x) => x.key} caption={`${first}-wise performance`} initialSort="leads" />
        </CardContent>
      </Card>
    </div>
  );
}

const COUNSELLOR_COLS: Col<CounsellorRow>[] = [
  { key: "counsellor", label: "Counsellor", kind: "text" },
  { key: "leads", label: "Leads", kind: "int" },
  { key: "contacted", label: "Contacted", kind: "int" },
  { key: "contactRate", label: "Contact rate", kind: "pct" },
  { key: "qualified", label: "Qualified", kind: "int" },
  { key: "qualificationRate", label: "Qual. rate", kind: "pct" },
  { key: "medianFirstResponseMinutes", label: "Median 1st response (min)", kind: "num" },
  { key: "followUpsDue", label: "Follow-ups due", kind: "int" },
  { key: "followUpsCompleted", label: "Completed", kind: "int" },
  { key: "followUpsOverdue", label: "Overdue", kind: "int" },
  { key: "followUpCompletion", label: "Completion", kind: "pct" },
  { key: "counsellingBooked", label: "Counselling booked", kind: "int" },
  { key: "counsellingAttended", label: "Attended", kind: "int" },
  { key: "applications", label: "Applications", kind: "int" },
  { key: "enrolments", label: "Enrolments", kind: "int" },
];

function Sales() {
  const { report, meta } = useSession();
  const r = report!;
  const s = r.sales;
  const u = r.unavailable;
  const d = (k: string) => defn(r, meta?.definitions, k);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Leads assigned" value={fmtInt(s.assigned)} sub={s.assigned !== null ? `${fmtInt(r.overview.totalLeads - s.assigned)} unassigned` : undefined} help={d("assigned")} unavailable={u.assigned} />
        <KpiCard label="Contact rate" value={fmtPct(s.contactRate)} sub={s.contacted !== null ? `${fmtInt(s.contacted)} leads contacted` : undefined} help={d("contactRate")} unavailable={u.contacted} />
        <KpiCard label="Median first response" value={s.firstResponse ? fmtMinutes(s.firstResponse.medianMinutes) : "N/A"} sub={s.firstResponse ? `${fmtPct(s.firstResponse.within1hPct)} within 1 hour · ${fmtInt(s.firstResponse.count)} timed leads` : undefined} help={d("firstResponse")} unavailable={u.firstResponse ?? "First Contact Date & Time is not mapped."} />
        <KpiCard label="Follow-ups overdue" value={fmtInt(s.followUpsOverdue)} sub={s.followUpsDue !== null ? `${fmtInt(s.followUpsDue)} due · ${fmtInt(s.followUpsCompleted)} completed (${fmtPct(s.followUpCompletion)})` : undefined} help={d("followUpsOverdue")} unavailable={u.followUpsDue} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Counsellor performance</CardTitle>
          <CardDescription>Contact rate here uses each counsellor&apos;s assigned leads as the denominator.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {r.counsellors.length ? (
            <SortableTable<CounsellorRow> rows={r.counsellors} cols={COUNSELLOR_COLS} currency={r.currency} rowKey={(x) => x.counsellor} caption="Counsellor performance" initialSort="leads" />
          ) : (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">Counsellor data is not available: no Assigned Counsellor column is mapped.</p>
          )}
        </CardContent>
      </Card>
      {r.counsellors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Leads per counsellor</CardTitle>
          </CardHeader>
          <CardContent>
            <HBarChart ariaLabel="Leads per counsellor" data={r.counsellors.map((c) => ({ label: c.counsellor, value: c.leads, detail: [`Contact rate ${fmtPct(c.contactRate)}`, `${fmtInt(c.followUpsOverdue)} overdue follow-ups`] }))} format={(v) => fmtInt(v)} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Dimensions() {
  const { report } = useSession();
  const r = report!;
  const dims: [string, BreakdownRow[]][] = [
    ["Country", r.dimensions.country],
    ["Course", r.dimensions.course],
    ["Study level", r.dimensions.studyLevel],
    ["Medium", r.dimensions.medium],
  ];
  const cols = (first: string): Col<BreakdownRow>[] => [
    { key: "label", label: first, kind: "text" },
    { key: "leads", label: "Leads", kind: "int" },
    { key: "share", label: "Share", kind: "pct" },
    { key: "qualified", label: "Qualified", kind: "int" },
    { key: "qualificationRate", label: "Qual. rate", kind: "pct" },
    { key: "applications", label: "Applications", kind: "int" },
    { key: "enrolments", label: "Enrolments", kind: "int" },
  ];
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {dims.map(([name, rows]) => (
        <Card key={name}>
          <CardHeader>
            <CardTitle className="text-base">Leads by {name.toLowerCase()}</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {rows.length ? <SortableTable<BreakdownRow> rows={rows} cols={cols(name)} currency={r.currency} rowKey={(x) => x.key} initialSort="leads" /> : <p className="px-6 py-6 text-sm text-muted-foreground">Not available: the {name.toLowerCase()} column is not mapped.</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { report } = useSession();
  return (
    <RequireReport>
      <PageHeader
        title="Daily dashboard"
        description={report ? `Reporting period ${report.period.isRange ? `${fmtDay(report.period.from)} – ${fmtDay(report.period.to)}` : fmtDay(report.period.from)} · generated ${new Date(report.generatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : undefined}
      />
      <DashboardFilters />
      <Tabs defaultValue="overview">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="overview">Executive overview</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="sales">Sales</TabsTrigger>
          <TabsTrigger value="dimensions">Country, course & level</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Overview />
        </TabsContent>
        <TabsContent value="campaigns">
          <Campaigns kind="campaigns" />
        </TabsContent>
        <TabsContent value="sources">
          <Campaigns kind="sources" />
        </TabsContent>
        <TabsContent value="sales">
          <Sales />
        </TabsContent>
        <TabsContent value="dimensions">
          <Dimensions />
        </TabsContent>
      </Tabs>
    </RequireReport>
  );
}
