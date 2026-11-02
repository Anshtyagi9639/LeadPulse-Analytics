"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { fmtDuration, fmtStamp } from "@/lib/format";
import { useSession } from "../session-provider";

/** Upload → Preview → Map → Process → Compare → Review → Download, with each step's state derived from the session. */
export function WorkflowSteps() {
  const { session } = useSession();
  const files = session?.files ?? [];
  const ready = files.filter((f) => f.status === "ready");
  const hasReport = Boolean(session?.report.available);
  const steps = [
    { label: "Upload files", href: "/", done: files.length > 0 },
    { label: "Preview columns", href: "/", done: ready.length > 0 },
    { label: "Configure mapping", href: "/", done: files.length > 0 && files.every((f) => f.status !== "needs_mapping") && ready.length > 0 },
    { label: "Process data", href: "/", done: hasReport },
    { label: "Compare files", href: "/compare", done: hasReport && ready.length > 1 },
    { label: "Review report", href: "/contact-report", done: (session?.generatedReports ?? 0) > 0 },
    { label: "Download", href: "/contact-report", done: false },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <div className="space-y-2">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-sm" aria-label="Reporting workflow">
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-center gap-1">
            <Link
              href={s.href}
              aria-current={i === current ? "step" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors",
                s.done ? "border-transparent bg-primary/10 text-primary" : i === current ? "border-primary font-medium" : "text-muted-foreground",
              )}
            >
              <span className={cn("flex size-4 items-center justify-center rounded-full text-[10px] tabular-nums", s.done ? "bg-primary text-primary-foreground" : "border")}>{s.done ? <Check className="size-3" aria-hidden /> : i + 1}</span>
              {s.label}
            </Link>
            {i < steps.length - 1 && <span className="text-muted-foreground" aria-hidden>→</span>}
          </li>
        ))}
      </ol>
      {session?.report.generatedAt && (
        <p className="text-xs text-muted-foreground">
          Report generated {fmtStamp(session.report.generatedAt)}
          {session.report.lastProcessingStartedAt && ` · processing started ${fmtStamp(session.report.lastProcessingStartedAt)}`}
          {session.report.lastProcessingMs !== null && ` · took ${fmtDuration(session.report.lastProcessingMs)}`}
        </p>
      )}
    </div>
  );
}
