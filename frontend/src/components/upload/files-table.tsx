"use client";

import { AlertCircle, CheckCircle2, CircleDashed, Columns3, ListChecks, Play, RefreshCcw, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { fmtBytes, fmtDuration, fmtInt, fmtStamp } from "@/lib/format";
import type { SessionFile } from "@/lib/types";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSession } from "../session-provider";
import { IssuesDialog } from "./issues-dialog";
import { MappingDialog } from "./mapping-dialog";

function StatusBadge({ f }: { f: SessionFile }) {
  if (f.status === "error")
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertCircle className="size-3" aria-hidden /> Error
      </Badge>
    );
  if (f.status === "needs_mapping")
    return (
      <Badge variant="outline" className="gap-1 border-[color:var(--status-warning)] text-[color:var(--status-warning)]">
        <CircleDashed className="size-3" aria-hidden /> Needs mapping
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1 border-[color:var(--status-good)] text-[color:var(--status-good)]">
      <CheckCircle2 className="size-3" aria-hidden /> Ready
    </Badge>
  );
}

export function FilesTable() {
  const { session, run, busy, replaceFile } = useSession();
  const replaceInput = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mapping, setMapping] = useState<SessionFile | null>(null);
  const [issues, setIssues] = useState<SessionFile | null>(null);
  if (!session) return null;
  const files = session.files;
  const selectable = files.filter((f) => f.status === "ready");
  const selectedReady = [...selected].filter((id) => selectable.some((f) => f.id === id));
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">Uploaded files</CardTitle>
          <CardDescription>
            Check each file&apos;s worksheet and column mapping, then process the files you want in the report — one at a time or all together.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!selectedReady.length || Boolean(busy)}
            onClick={() => run("Processing selected files", (id) => api.process(id, selectedReady), `Report generated from ${selectedReady.length} selected file(s).`)}
          >
            <Play data-icon="inline-start" />
            Process selected ({selectedReady.length})
          </Button>
          <Button disabled={!selectable.length || Boolean(busy)} onClick={() => run("Processing all files", (id) => api.process(id), "Report generated from all ready files.")}>
            <Play data-icon="inline-start" />
            Process all files
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-0">
        {files.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-muted-foreground">No files uploaded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-6">
                    <Checkbox
                      aria-label="Select all ready files"
                      checked={selectable.length > 0 && selectedReady.length === selectable.length}
                      onCheckedChange={(v) => setSelected(v ? new Set(selectable.map((f) => f.id)) : new Set())}
                    />
                  </TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Worksheet</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead className="text-right">Accepted</TableHead>
                  <TableHead className="text-right">Rejected</TableHead>
                  <TableHead className="text-right">Warnings</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-6 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((f) => {
                  const v = f.validation;
                  return (
                    <TableRow key={f.id} data-testid="file-row">
                      <TableCell className="pl-6">
                        <Checkbox aria-label={`Select ${f.name}`} disabled={f.status !== "ready"} checked={selected.has(f.id)} onCheckedChange={(on) => toggle(f.id, Boolean(on))} />
                      </TableCell>
                      <TableCell className="max-w-72">
                        <div className="truncate font-medium" title={f.name}>
                          {f.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {fmtBytes(f.size)} · uploaded {fmtStamp(f.uploadCompletedAt ?? f.uploadStartedAt)} · read & validated in {fmtDuration(f.processingMs)}
                          {f.processedAt && ` · in report since ${fmtStamp(f.processedAt)}`}
                          {f.templateApplied && ` · template “${f.templateApplied}”`}
                          {f.inReport && (
                            <Badge variant="secondary" className="ml-2 h-4 px-1.5 text-[10px]">
                              In report
                            </Badge>
                          )}
                        </div>
                        {f.status === "error" && <div className="mt-1 text-xs whitespace-normal text-destructive">{f.error?.message}</div>}
                        {f.status === "needs_mapping" && <div className="mt-1 text-xs whitespace-normal text-[color:var(--status-warning)]">{f.mappingProblems.join(" ")}</div>}
                      </TableCell>
                      <TableCell>{f.status === "error" ? "—" : f.kind === "leads" ? "Leads" : "Ad spend"}</TableCell>
                      <TableCell className="max-w-40 truncate">
                        {f.sheetName ?? "—"}
                        {f.sheetCount > 1 && <span className="text-xs text-muted-foreground"> (1 of {f.sheetCount})</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{v ? fmtInt(v.dataRows) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{v ? fmtInt(v.accepted) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {v ? <span className={v.rejected ? "font-medium text-destructive" : ""}>{fmtInt(v.rejected)}</span> : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {v ? (
                          <Tooltip>
                            <TooltipTrigger className="tabular-nums">{fmtInt(v.rowsWithWarnings)}</TooltipTrigger>
                            <TooltipContent>{fmtInt(v.blankRows)} blank row(s) skipped · {fmtInt(v.issueCount)} issue(s) recorded</TooltipContent>
                          </Tooltip>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge f={f} />
                      </TableCell>
                      <TableCell className="pr-6">
                        <div className="flex justify-end gap-1">
                          {f.status !== "error" && (
                            <Button size="sm" variant="outline" onClick={() => setMapping(f)}>
                              <Columns3 data-icon="inline-start" />
                              Map columns
                            </Button>
                          )}
                          {f.status === "ready" && (
                            <Button size="sm" variant="ghost" onClick={() => run("Processing file", (id) => api.process(id, [f.id]), `Report generated from ${f.name} only.`)} disabled={Boolean(busy)}>
                              Process
                            </Button>
                          )}
                          {f.status !== "error" && (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Replace ${f.name} with a new version`}
                              title="Replace with a new version"
                              disabled={Boolean(busy)}
                              onClick={() => {
                                setReplacing(f.id);
                                replaceInput.current?.click();
                              }}
                            >
                              <RefreshCcw />
                            </Button>
                          )}
                          {f.status !== "error" && (
                            <Button size="icon-sm" variant="ghost" aria-label={`Validation issues for ${f.name}`} onClick={() => setIssues(f)}>
                              <ListChecks />
                            </Button>
                          )}
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="icon-sm" variant="ghost" aria-label={`Remove ${f.name}`} disabled={Boolean(busy)}>
                                <Trash2 />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remove {f.name}?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  The file and its rows are deleted from this session{f.inReport ? " and the report is recalculated without it" : ""}. Your original file is not affected.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => run("Removing file", (id) => api.removeFile(id, f.id), `${f.name} removed.`)}>Remove file</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      <input
        ref={replaceInput}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="sr-only"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file && replacing) void replaceFile(replacing, file);
          setReplacing(null);
        }}
      />
      {mapping && <MappingDialog file={session.files.find((f) => f.id === mapping.id) ?? mapping} onClose={() => setMapping(null)} />}
      {issues && <IssuesDialog file={issues} onClose={() => setIssues(null)} />}
    </Card>
  );
}
