"use client";

import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { duplicateModeLabel, fmtInt } from "@/lib/format";
import type { DuplicateGroup, DuplicateMode, DuplicatesResponse } from "@/lib/types";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/page-header";
import { errorMessage, useSession } from "@/components/session-provider";
import { EmptyState, PageSkeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const MODES: { value: DuplicateMode; help: string }[] = [
  { value: "count_all", help: "Every accepted row counts as a lead, exactly as submitted. Unique leads are still shown separately." },
  { value: "exclude_duplicates", help: "Confirmed duplicates (same Lead ID, phone or email) count once — the first occurrence is kept." },
  { value: "keep_latest", help: "Confirmed duplicates count once — the record with the most recent activity is kept." },
  { value: "manual_review", help: "Nothing is merged until you decide for each group below. Undecided groups count all rows." },
];

const PAGE = 20;
const MATCH: Record<string, string> = { lead_id: "Lead ID", phone: "Phone", email: "Email", name_city: "Name + city" };

function GroupCard({ g, manual, onDecide }: { g: DuplicateGroup; manual: boolean; onDecide: (d: string | null) => void }) {
  return (
    <div className="rounded-lg border" data-testid="duplicate-group">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2">
        <Badge variant={g.kind === "confirmed" ? "secondary" : "outline"}>{g.kind === "confirmed" ? "Confirmed duplicate" : "Possible duplicate"}</Badge>
        <span className="text-xs text-muted-foreground">Matched on {g.matchedOn.map((m) => MATCH[m] ?? m).join(", ") || "—"}</span>
        {g.conflict && (
          <span className="inline-flex items-center gap-1 text-xs text-[color:var(--status-warning)]">
            <AlertTriangle className="size-3.5" aria-hidden />
            {g.conflictReasons.join("; ")}
          </span>
        )}
        {manual && (
          <div className="ml-auto flex flex-wrap gap-1">
            {(
              [
                ["keep_all", "Keep all rows"],
                ["keep_first", "Keep first"],
                ["keep_latest", "Keep latest"],
              ] as const
            ).map(([v, l]) => (
              <Button key={v} size="xs" variant={g.decision === v ? "default" : "outline"} onClick={() => onDecide(g.decision === v ? null : v)} aria-pressed={g.decision === v}>
                {l}
              </Button>
            ))}
          </div>
        )}
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead className="text-right">Row</TableHead>
              <TableHead>Lead ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Campaign</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {g.members.map((m) => (
              <TableRow key={m.uid}>
                <TableCell className="max-w-44 truncate">
                  {m.fileName}
                  {m.uid === g.firstUid && <Badge variant="outline" className="ml-1.5 h-4 px-1 text-[10px]">first</Badge>}
                  {m.uid === g.latestUid && <Badge variant="outline" className="ml-1.5 h-4 px-1 text-[10px]">latest</Badge>}
                </TableCell>
                <TableCell className="text-right tabular-nums">{m.rowNumber}</TableCell>
                <TableCell>{m.leadId ?? "—"}</TableCell>
                <TableCell>{m.name ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{m.phone ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{m.email ?? "—"}</TableCell>
                <TableCell className="max-w-40 truncate">{m.campaign}</TableCell>
                <TableCell>{m.leadStatus ?? "—"}</TableCell>
                <TableCell className="whitespace-nowrap">{m.createdAt ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function DuplicatesPage() {
  const { session, loading, run, busy } = useSession();
  const [kind, setKind] = useState<"all" | "confirmed" | "possible">("all");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<DuplicatesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const sessionId = session?.id;
  const version = `${session?.report.lastProcessedAt}-${session?.files.length}-${session?.settings.cautiousMatching}-${session?.duplicateDecisionCount}`;

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    api
      .duplicates(sessionId, { kind: kind === "all" ? undefined : kind, limit: PAGE, offset })
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
  }, [sessionId, kind, offset, version, reload]);

  if (loading) return <PageSkeleton />;
  if (!session) return <EmptyState title="No reporting session yet">Upload files first.</EmptyState>;
  const s = data?.summary;
  const mode = session.settings.duplicateMode;

  const decide = async (gid: string, d: string | null) => {
    const ok = await run("Saving decision", (id) => api.setDecisions(id, { [gid]: d }));
    if (ok) {
      setReload((n) => n + 1);
      if (!session.report.available) toast.info("Decision saved. It will apply when you process the files.");
    }
  };

  return (
    <>
      <PageHeader title="Duplicate leads" description="Duplicates are detected across every file in the session by Lead ID, then normalised phone, then normalised email. Names alone never merge records. Your source files are never changed." />
      <div className="space-y-6">
        {s && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Total raw rows" value={fmtInt(s.totalRows)} sub="Accepted rows in the files under review" />
            <KpiCard label="Unique leads" value={fmtInt(s.uniqueLeads)} sub={`${fmtInt(s.confirmedGroups)} confirmed groups`} />
            <KpiCard label="Duplicate rows" value={fmtInt(s.duplicateRows)} sub={`${fmtInt(s.possibleDuplicateRows)} more possible (need review)`} />
            <KpiCard label="Conflicting / missing ID" value={`${fmtInt(s.conflictingRecords)} / ${fmtInt(s.missingIdRows)}`} sub={`${fmtInt(s.unidentifiableRows)} rows have no ID, phone or email`} />
          </div>
        )}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">How should duplicates be counted?</CardTitle>
              <CardDescription>Applies to the temporary working data only. Changing it recalculates the report.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <RadioGroup value={mode} onValueChange={(v) => run("Updating duplicate handling", (id) => api.updateSettings(id, { duplicateMode: v as DuplicateMode }), `Duplicate handling: ${duplicateModeLabel(v)}.`)} disabled={Boolean(busy)}>
                {MODES.map((m) => (
                  <Label key={m.value} htmlFor={m.value} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
                    <RadioGroupItem value={m.value} id={m.value} className="mt-0.5" />
                    <span>
                      <span className="block font-medium">{duplicateModeLabel(m.value)}</span>
                      <span className="block text-xs text-muted-foreground">{m.help}</span>
                    </span>
                  </Label>
                ))}
              </RadioGroup>
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <Switch id="cautious" checked={session.settings.cautiousMatching} onCheckedChange={(v) => run("Updating matching", (id) => api.updateSettings(id, { cautiousMatching: v }))} disabled={Boolean(busy)} />
                <Label htmlFor="cautious" className="block font-normal">
                  <span className="block font-medium">Cautious name + city matching</span>
                  <span className="block text-xs text-muted-foreground">Also flags rows with identical full name and city as <em>possible</em> duplicates for review. They are never merged automatically.</span>
                </Label>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Duplicates by file and campaign</CardTitle>
              <CardDescription>Rows beyond the first in each group</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {(
                [
                  ["File", s?.byFile.map((x) => [x.fileName, x.duplicateRows, x.possibleDuplicateRows] as const)],
                  ["Campaign", s?.byCampaign.map((x) => [x.campaign, x.duplicateRows, x.possibleDuplicateRows] as const)],
                ] as const
              ).map(([title, rows]) => (
                <Table key={title}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{title}</TableHead>
                      <TableHead className="text-right">Confirmed</TableHead>
                      <TableHead className="text-right">Possible</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(rows ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground">
                          None
                        </TableCell>
                      </TableRow>
                    )}
                    {(rows ?? []).map(([label, c, p]) => (
                      <TableRow key={label}>
                        <TableCell className="max-w-40 truncate" title={label}>
                          {label}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtInt(c)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtInt(p)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Duplicate groups</CardTitle>
              <CardDescription>{mode === "manual_review" ? "Choose what to keep for each group." : "Switch to “Review duplicates manually” to decide group by group."} Phone and email are masked.</CardDescription>
            </div>
            <Tabs
              value={kind}
              onValueChange={(v) => {
                setKind(v as typeof kind);
                setOffset(0);
              }}
            >
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="confirmed">Confirmed</TabsTrigger>
                <TabsTrigger value="possible">Possible</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent className="space-y-3">
            {error && <p className="text-sm text-destructive">{error}</p>}
            {data && data.total === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No duplicate groups found.</p>}
            {data?.groups.map((g) => <GroupCard key={g.id} g={g} manual={mode === "manual_review"} onDecide={(d) => decide(g.id, d)} />)}
            {data && data.total > PAGE && (
              <div className="flex items-center justify-end gap-2 text-sm">
                <span className="text-muted-foreground">
                  {offset + 1}–{Math.min(offset + PAGE, data.total)} of {data.total}
                </span>
                <Button size="icon-sm" variant="outline" aria-label="Previous page" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                  <ChevronLeft />
                </Button>
                <Button size="icon-sm" variant="outline" aria-label="Next page" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>
                  <ChevronRight />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
