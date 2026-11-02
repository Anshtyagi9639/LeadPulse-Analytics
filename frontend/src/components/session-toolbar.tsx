"use client";

import { AlertTriangle, CalendarDays, Clock, Download, FilePlus2, FlaskConical, Loader2, Play, RefreshCw, RotateCcw, ShieldAlert, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtDateTime, fmtDay, fmtInt, fmtTimeOrDate } from "@/lib/format";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSession } from "./session-provider";

export const ADD_FILES_EVENT = "leadpulse:add-files";

function useCountdown(iso: string | undefined) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  if (!iso || now === null) return null;
  const ms = Date.parse(iso) - now;
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  const body = (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
  if (!hint) return body;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div tabIndex={0} className="cursor-help rounded outline-none focus-visible:ring-2 focus-visible:ring-ring">{body}</div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{hint}</TooltipContent>
    </Tooltip>
  );
}

export function SessionToolbar() {
  const { session, busy, run, clear, resetTestSession } = useSession();
  const router = useRouter();
  const remaining = useCountdown(session?.expiresAt);
  if (!session) return null;

  const s = session.settings;
  const period = s.dateRange ? `${fmtDay(s.dateRange.from)} – ${fmtDay(s.dateRange.to)}` : fmtDay(s.reportingDate);
  const readyFiles = session.files.filter((f) => f.status === "ready").length;
  const addFiles = () => {
    router.push("/");
    setTimeout(() => window.dispatchEvent(new Event(ADD_FILES_EVENT)), 50);
  };

  return (
    <div className="border-t px-4 py-2.5 lg:border-t-0 lg:px-8">
      <div className="flex flex-col gap-x-6 gap-y-2 2xl:flex-row 2xl:items-center">
        <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 xl:grid-cols-6">
          <Stat label="Reporting date" value={<span className="inline-flex items-center gap-1"><CalendarDays className="size-3.5 text-muted-foreground" aria-hidden />{period}</span>} hint={s.dateRange ? "Custom date range selected explicitly." : "Single reporting day. Change it on the Upload page."} />
          <Stat label="Files" value={`${session.totals.files} · ${session.report.fileIds.length} in report`} hint="Uploaded files · files included in the current report." />
          <Stat label="Raw rows" value={fmtInt(session.totals.rawRows)} hint="Non-blank data rows across all uploaded lead files." />
          <Stat label="Unique leads" value={session.totals.uniqueLeads === null ? "—" : fmtInt(session.totals.uniqueLeads)} hint="Leads in the current report after collapsing confirmed duplicates." />
          <Stat label="Last processed" value={fmtTimeOrDate(session.report.lastProcessedAt)} hint={session.report.lastProcessedAt ? fmtDateTime(session.report.lastProcessedAt) : "Not processed yet."} />
          <Stat
            label="Session expires"
            value={<span className="inline-flex items-center gap-1"><Clock className="size-3.5 text-muted-foreground" aria-hidden />{remaining === null ? "—" : remaining === "expired" ? "Expired" : `in ${remaining}`}</span>}
            hint={`At ${fmtDateTime(session.expiresAt)}. All uploaded files and lead data are then deleted automatically.`}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {session.mode === "test" && (
            <>
              <Badge className="bg-[color:var(--status-warning)] text-white" data-testid="test-badge">
                <FlaskConical className="size-3" aria-hidden /> TEST SESSION
              </Badge>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="outline" disabled={Boolean(busy)}>
                    <RotateCcw data-icon="inline-start" />
                    Reset test
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset the test session?</AlertDialogTitle>
                    <AlertDialogDescription>All test files, settings and test reports in this session are deleted and a fresh test session starts. Production sessions and your original files are not affected.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => resetTestSession()}>Reset test session</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
          {busy && (
            <span className="mr-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status" aria-live="polite">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {busy}…
            </span>
          )}
          <Button size="sm" variant="outline" onClick={addFiles} disabled={Boolean(busy)}>
            <FilePlus2 data-icon="inline-start" />
            Add files
          </Button>
          <Button size="sm" onClick={() => run("Processing all files", (id) => api.process(id), "Report generated from all ready files.")} disabled={Boolean(busy) || !readyFiles}>
            <Play data-icon="inline-start" />
            Process all
          </Button>
          <Button size="sm" variant="outline" onClick={() => run("Recalculating", (id) => api.recalculate(id), "Report recalculated.")} disabled={Boolean(busy) || !session.report.available}>
            <RefreshCw data-icon="inline-start" />
            Recalculate
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link href="/quality">
              <ShieldAlert data-icon="inline-start" />
              Errors
            </Link>
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link href="/exports">
              <Download data-icon="inline-start" />
              Download
            </Link>
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="destructive" disabled={Boolean(busy)}>
                <Trash2 data-icon="inline-start" />
                Clear session
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear session & delete temporary data?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes all {session.totals.files} uploaded file(s), the calculated report and all lead data held for this session on the server. Download any reports you need first. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep session</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-white hover:bg-destructive/90"
                  onClick={async () => {
                    await clear();
                    router.push("/");
                  }}
                >
                  Delete everything
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      {session.report.stale && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-[color:var(--status-warning)]" role="status">
          <AlertTriangle className="size-3.5" aria-hidden />
          {session.report.stale}
        </p>
      )}
    </div>
  );
}
