"use client";

import { Plus, Save, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { fmtMoney } from "@/lib/format";
import type { CampaignInput, Session } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { useSession } from "@/components/session-provider";
import { EmptyState, PageSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Row = Record<"campaignName" | "source" | "spend" | "budget" | "targetLeads" | "impressions" | "clicks" | "baselineCpl", string>;
const EMPTY: Row = { campaignName: "", source: "", spend: "", budget: "", targetLeads: "", impressions: "", clicks: "", baselineCpl: "" };
const NUM_FIELDS = ["spend", "budget", "targetLeads", "impressions", "clicks", "baselineCpl"] as const;

const toRow = (c: CampaignInput): Row => ({
  campaignName: c.campaignName ?? "",
  source: c.source ?? "",
  ...(Object.fromEntries(NUM_FIELDS.map((k) => [k, c[k] === null ? "" : String(c[k])])) as Record<(typeof NUM_FIELDS)[number], string>),
});

const num = (s: string) => {
  const t = s.replace(/[,\s₹]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};

export default function SpendPage() {
  const { session, loading } = useSession();
  if (loading) return <PageSkeleton />;
  if (!session) return <EmptyState title="No reporting session yet">Upload files first.</EmptyState>;
  // Remount the editor whenever the saved values change, so its draft state starts from them.
  const key = JSON.stringify([session.id, session.campaignInputs, session.settings.overallTargetLeads, session.settings.overallBudget]);
  return <SpendEditor key={key} session={session} />;
}

function SpendEditor({ session }: { session: Session }) {
  const { report, run, busy } = useSession();
  const [rows, setRows] = useState<Row[]>(() => session.campaignInputs.map(toRow));
  const [target, setTarget] = useState(session.settings.overallTargetLeads?.toString() ?? "");
  const [budget, setBudget] = useState(session.settings.overallBudget?.toString() ?? "");
  const campaigns = useMemo(() => report?.filterOptions.campaigns.filter((c) => c !== "(No campaign)") ?? [], [report]);
  const invalid = rows.some((r) => (!r.campaignName.trim() && !r.source.trim()) || NUM_FIELDS.some((k) => Number.isNaN(num(r[k]))));

  const set = (i: number, k: keyof Row, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const save = () =>
    run(
      "Saving spend & targets",
      async (id) => {
        await api.updateSettings(id, { overallTargetLeads: num(target), overallBudget: num(budget) });
        return api.setCampaignInputs(
          id,
          rows.map((r) => ({
            campaignName: r.campaignName.trim() || null,
            source: r.source.trim() || null,
            ...(Object.fromEntries(NUM_FIELDS.map((k) => [k, num(r[k])])) as Record<(typeof NUM_FIELDS)[number], number | null>),
          })),
        );
      },
      "Spend and targets saved. The report was recalculated.",
    );

  const adFiles = session.files.filter((f) => f.kind === "ad_spend");

  return (
    <>
      <PageHeader
        title="Spend & targets"
        description="Enter today's advertising spend, budgets and lead targets per campaign, or upload an ad-platform spend export on the Upload page. Spend is only compared with leads from the same reporting period."
        actions={
          <Button onClick={save} disabled={Boolean(busy) || invalid}>
            <Save data-icon="inline-start" />
            Save & recalculate
          </Button>
        }
      />
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Session targets (optional)</CardTitle>
            <CardDescription>A session-level lead target overrides the sum of campaign targets for the overall target-achievement KPI.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="t">Total lead target</Label>
              <Input id="t" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} className="w-44" aria-invalid={Number.isNaN(num(target))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b">Total budget ({report?.currency ?? "INR"})</Label>
              <Input id="b" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} className="w-44" aria-invalid={Number.isNaN(num(budget))} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Campaign spend & targets</CardTitle>
              <CardDescription>
                Campaign names are matched to the leads&apos; Campaign Name (case-insensitive). Leave Campaign empty to enter a source-level total.
                {adFiles.length > 0 && ` Spend from ${adFiles.length} uploaded ad-spend file(s) is added to these entries.`}
              </CardDescription>
            </div>
            <Button variant="outline" onClick={() => setRows([...rows, { ...EMPTY }])}>
              <Plus data-icon="inline-start" />
              Add row
            </Button>
          </CardHeader>
          <CardContent className="overflow-x-auto px-0">
            <datalist id="campaign-options">
              {campaigns.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            {rows.length === 0 ? (
              <p className="px-6 py-6 text-sm text-muted-foreground">No manual entries. Add a row, or upload an ad-spend file.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Campaign</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Spend</TableHead>
                    <TableHead>Budget</TableHead>
                    <TableHead>Target leads</TableHead>
                    <TableHead>Impressions</TableHead>
                    <TableHead>Clicks</TableHead>
                    <TableHead>Baseline CPL</TableHead>
                    <TableHead className="pr-6" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-6">
                        <Input list="campaign-options" value={r.campaignName} onChange={(e) => set(i, "campaignName", e.target.value)} className="w-56" aria-label="Campaign" />
                      </TableCell>
                      <TableCell>
                        <Input value={r.source} onChange={(e) => set(i, "source", e.target.value)} className="w-32" aria-label="Source" placeholder="e.g. Meta Ads" />
                      </TableCell>
                      {NUM_FIELDS.map((k) => (
                        <TableCell key={k}>
                          <Input inputMode="decimal" value={r[k]} onChange={(e) => set(i, k, e.target.value)} className="w-28" aria-label={k} aria-invalid={Number.isNaN(num(r[k]))} />
                        </TableCell>
                      ))}
                      <TableCell className="pr-6">
                        <Button size="icon-sm" variant="ghost" aria-label="Remove row" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                          <Trash2 />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {invalid && <p className="px-6 pt-3 text-sm text-destructive">Each row needs a campaign or source, and numbers must be zero or more.</p>}
          </CardContent>
        </Card>
        {report && report.marketing.totalSpend !== null && (
          <p className="text-sm text-muted-foreground">
            Current report: total spend {fmtMoney(report.marketing.totalSpend, report.currency)}, attributable {fmtMoney(report.marketing.attributableSpend, report.currency)}, CPL {fmtMoney(report.marketing.cpl, report.currency)}.
          </p>
        )}
      </div>
    </>
  );
}
