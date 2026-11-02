"use client";

import { FileQuestion, Play, Upload } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "./session-provider";

export function EmptyState({ icon: Icon = FileQuestion, title, children }: { icon?: React.ElementType; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <h2 className="font-medium">{title}</h2>
      {children && <div className="max-w-md space-y-3 text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}

/** Renders children only when a report exists; otherwise explains what to do next. */
export function RequireReport({ children }: { children: React.ReactNode }) {
  const { session, report, loading, run, busy } = useSession();
  if (loading) return <PageSkeleton />;
  if (!session)
    return (
      <EmptyState icon={Upload} title="No reporting session yet">
        <p>Upload today&apos;s lead files to start a reporting session.</p>
        <Button asChild>
          <Link href="/">Go to Upload</Link>
        </Button>
      </EmptyState>
    );
  if (!report) {
    const ready = session.files.filter((f) => f.status === "ready").length;
    return (
      <EmptyState icon={Play} title="No report generated yet">
        <p>{ready ? `${ready} file(s) are ready. Process them to calculate the KPIs.` : "Upload files and complete their column mapping first."}</p>
        {ready > 0 ? (
          <Button onClick={() => run("Processing all files", (id) => api.process(id), "Report generated.")} disabled={Boolean(busy)}>
            Process all files
          </Button>
        ) : (
          <Button asChild variant="outline">
            <Link href="/">Go to Upload</Link>
          </Button>
        )}
      </EmptyState>
    );
  }
  return <>{children}</>;
}
