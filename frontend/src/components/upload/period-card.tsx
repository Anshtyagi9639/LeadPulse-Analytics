"use client";

import { CalendarDays } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSession } from "../session-provider";

export function PeriodCard() {
  const { session, pendingDate, setPendingDate, pendingMode, setPendingMode, run, busy } = useSession();
  const s = session?.settings;
  const [rangeOn, setRangeOn] = useState(Boolean(s?.dateRange));
  const [from, setFrom] = useState(s?.dateRange?.from ?? s?.reportingDate ?? pendingDate);
  const [to, setTo] = useState(s?.dateRange?.to ?? s?.reportingDate ?? pendingDate);

  const date = s?.reportingDate ?? pendingDate;
  const setDate = (d: string) => {
    if (!d) return;
    if (!session) setPendingDate(d);
    else void run("Updating reporting date", (id) => api.updateSettings(id, { reportingDate: d }), "Reporting date updated.");
  };
  const applyRange = (on: boolean, f = from, t = to) => {
    setRangeOn(on);
    if (!session) return;
    if (on && f && t) void run("Updating date range", (id) => api.updateSettings(id, { dateRange: { from: f, to: t } }));
    if (!on && s?.dateRange) void run("Removing date range", (id) => api.updateSettings(id, { dateRange: null }));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarDays className="size-4 text-primary" aria-hidden />
          Reporting period
        </CardTitle>
        <CardDescription>Leads and ad spend are compared against this date. Rows from other dates are flagged.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="reporting-date">Reporting date</Label>
          <Input id="reporting-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={Boolean(busy) || rangeOn} className="max-w-48" />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="range" checked={rangeOn} onCheckedChange={(v) => applyRange(v)} disabled={!session || Boolean(busy)} />
          <Label htmlFor="range" className="font-normal">
            Use a custom date range instead
          </Label>
        </div>
        {rangeOn && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="from">From</Label>
              <Input id="from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} onBlur={() => applyRange(true)} className="w-40" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">To</Label>
              <Input id="to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} onBlur={() => applyRange(true)} className="w-40" />
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="date-filter">Rows created on other dates</Label>
          <Select
            value={s?.dateFilter ?? "include_all"}
            disabled={!session || Boolean(busy)}
            onValueChange={(v) => run("Updating date filter", (id) => api.updateSettings(id, { dateFilter: v as "include_all" | "restrict" }))}
          >
            <SelectTrigger id="date-filter" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="include_all">Include them and show a warning</SelectItem>
              <SelectItem value="restrict">Exclude them (reporting period only)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {!session ? (
          <div className="space-y-1.5 rounded-lg border p-3">
            <Label className="font-medium">Session type</Label>
            <div className="flex items-center gap-2">
              <Switch id="test-mode" checked={pendingMode === "test"} onCheckedChange={(v) => setPendingMode(v ? "test" : "production")} />
              <Label htmlFor="test-mode" className="font-normal">
                Testing mode — try files, mappings and duplicate rules
              </Label>
            </div>
            <p className="text-xs text-muted-foreground">Test reports are labelled TEST and can be reset at any time. The session starts when you upload the first file.</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
