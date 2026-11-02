"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { SessionFile, ValidationIssue } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorMessage, useSession } from "../session-provider";

export function IssuesTable({ issues }: { issues: ValidationIssue[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>File</TableHead>
          <TableHead className="text-right">Row</TableHead>
          <TableHead>Field</TableHead>
          <TableHead>Severity</TableHead>
          <TableHead>Issue</TableHead>
          <TableHead>Value</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {issues.map((i, n) => (
          <TableRow key={`${i.fileId}-${i.rowNumber}-${i.code}-${n}`}>
            <TableCell className="max-w-40 truncate">{i.fileName}</TableCell>
            <TableCell className="text-right tabular-nums">{i.rowNumber ?? "—"}</TableCell>
            <TableCell>{i.field || "—"}</TableCell>
            <TableCell>
              <Badge variant={i.severity === "error" ? "destructive" : "outline"}>{i.severity}</Badge>
            </TableCell>
            <TableCell className="min-w-64 whitespace-normal">{i.message}</TableCell>
            <TableCell className="max-w-40 truncate font-mono text-xs">{i.value}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function IssuesDialog({ file, onClose }: { file: SessionFile; onClose: () => void }) {
  const { session } = useSession();
  const [data, setData] = useState<{ total: number; issues: ValidationIssue[]; truncated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!session) return;
    api.fileIssues(session.id, file.id, 500).then(setData).catch((e) => setError(errorMessage(e)));
  }, [session, file.id]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Validation issues — {file.name}</DialogTitle>
          <DialogDescription>
            Personal data (phone, email, name) is masked. Download the full list from Data Quality.
            {data && ` Showing ${data.issues.length} of ${data.total}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!data && !error && <Skeleton className="h-40 w-full" />}
          {data && data.issues.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No validation issues in this file.</p>}
          {data && data.issues.length > 0 && <IssuesTable issues={data.issues} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
