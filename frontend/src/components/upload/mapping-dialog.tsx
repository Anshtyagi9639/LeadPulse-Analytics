"use client";

import { AlertTriangle, Loader2, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { DateOrder, FieldMeta, FileKind, MappingTemplate, Preview, SessionFile } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorMessage, useSession } from "../session-provider";

const IGNORE = "__ignore";
const GROUP_LABEL: Record<string, string> = { student: "Student information", marketing: "Marketing attribution", sales: "Sales & lead handling", conversion: "Conversion", advertising: "Advertising" };
const IDENTITY = ["leadId", "phone", "email", "name"];

const cell = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function MappingDialog({ file, onClose }: { file: SessionFile; onClose: () => void }) {
  const { session, meta, run } = useSession();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState<number | undefined>(undefined);
  const [headerRow, setHeaderRow] = useState<number | undefined>(undefined);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [dateOrder, setDateOrder] = useState<DateOrder>(file.dateOrder);
  const [templates, setTemplates] = useState<MappingTemplate[]>([]);
  const [templateName, setTemplateName] = useState("");

  const kind: FileKind = preview?.kind ?? file.kind;
  const fields = useMemo(() => meta?.fields[kind] ?? [], [meta, kind]);
  const fieldByKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);

  const load = useCallback(
    async (q: { sheet?: number; headerRow?: number } = {}) => {
      if (!session) return;
      setLoading(true);
      try {
        const p = await api.preview(session.id, file.id, q);
        setPreview(p);
        setSheet(p.sheetIndex);
        setHeaderRow(p.headerRow);
        setDraft(p.mapping);
      } catch (e) {
        toast.error(errorMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [session, file.id],
  );

  useEffect(() => {
    if (!session) return;
    api
      .preview(session.id, file.id)
      .then((p) => {
        setPreview(p);
        setSheet(p.sheetIndex);
        setHeaderRow(p.headerRow);
        setDraft(p.mapping);
      })
      .catch((e) => toast.error(errorMessage(e)))
      .finally(() => setLoading(false));
    api.templates().then((t) => setTemplates(t.templates)).catch(() => undefined);
  }, [session, file.id]);

  const used = useMemo(() => {
    const m = new Map<string, number>();
    for (const k of Object.values(draft)) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  }, [draft]);
  const duplicates = [...used.entries()].filter(([, n]) => n > 1).map(([k]) => fieldByKey.get(k)?.label ?? k);
  const hasIdentity = kind === "leads" ? IDENTITY.some((k) => used.has(k)) : used.has("spend") && (used.has("campaignName") || used.has("source"));

  const grouped = useMemo(() => {
    const g = new Map<string, FieldMeta[]>();
    for (const f of fields) g.set(f.group, [...(g.get(f.group) ?? []), f]);
    return [...g.entries()];
  }, [fields]);

  const save = async () => {
    if (!session || !preview) return;
    setSaving(true);
    const ok = await run(
      "Saving mapping",
      async (id) => (await api.configureFile(id, file.id, { sheetIndex: sheet, headerRow, dateOrder, mapping: draft })).session,
      `Mapping saved for ${file.name}.`,
    );
    setSaving(false);
    if (ok) onClose();
  };

  const changeKind = async (k: FileKind) => {
    if (!session) return;
    await run("Changing file type", async (id) => (await api.configureFile(id, file.id, { kind: k })).session);
    await load({ sheet, headerRow });
  };

  const applyTemplate = async (tid: string) => {
    if (!session) return;
    await run("Applying template", async (id) => (await api.configureFile(id, file.id, { templateId: tid })).session, "Template applied.");
    await load({ sheet, headerRow });
  };

  const saveTemplate = async () => {
    if (!session || !templateName.trim()) return;
    try {
      await api.configureFile(session.id, file.id, { sheetIndex: sheet, headerRow, dateOrder, mapping: draft });
      const t = await api.saveTemplate(session.id, file.id, templateName.trim());
      setTemplates((ts) => [...ts.filter((x) => x.id !== t.template.id), t.template]);
      setTemplateName("");
      toast.success(`Template “${t.template.name}” saved. It will be applied automatically to files with matching columns.`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const samples = (col: number) =>
    (preview?.rows ?? [])
      .map((r) => cell(r[col]))
      .filter(Boolean)
      .slice(0, 3);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[92vh] flex-col overflow-hidden sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Map columns — {file.name}</DialogTitle>
          <DialogDescription>
            Match each spreadsheet column to a standard reporting field. Columns you don&apos;t need can be ignored. Missing fields make the related KPIs show N/A — nothing is estimated.
          </DialogDescription>
        </DialogHeader>

        {loading && !preview ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : preview ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label>Worksheet</Label>
                <Select value={String(sheet ?? 0)} onValueChange={(v) => load({ sheet: Number(v) })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {preview.sheets.map((s) => (
                      <SelectItem key={s.index} value={String(s.index)}>
                        {s.name} ({s.rows} rows){s.hidden ? " · hidden" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Header row</Label>
                <Select value={String(headerRow ?? 0)} onValueChange={(v) => load({ sheet, headerRow: Number(v) })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {preview.topRows.map((r, i) => (
                      <SelectItem key={i} value={String(i)}>
                        Row {preview.headerRowNumber - preview.headerRow + i}: {r.map(cell).filter(Boolean).slice(0, 3).join(", ").slice(0, 40) || "(empty)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>File type</Label>
                <Select value={kind} onValueChange={(v) => changeKind(v as FileKind)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="leads">Lead export</SelectItem>
                    <SelectItem value="ad_spend">Advertising spend</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Date format</Label>
                <Select value={dateOrder} onValueChange={(v) => setDateOrder(v as DateOrder)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Detect automatically</SelectItem>
                    <SelectItem value="DMY">Day / Month / Year</SelectItem>
                    <SelectItem value="MDY">Month / Day / Year</SelectItem>
                    <SelectItem value="YMD">Year-Month-Day</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {(!hasIdentity || duplicates.length > 0) && (
              <div className="flex items-start gap-2 rounded-lg border border-[color:var(--status-warning)]/40 bg-[color:var(--status-warning)]/10 px-3 py-2 text-sm" role="alert">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[color:var(--status-warning)]" aria-hidden />
                <div>
                  {!hasIdentity && <p>{kind === "leads" ? "Map at least one of Lead ID, Phone Number, Email or Name." : "Map Spend and either Campaign Name or Source."}</p>}
                  {duplicates.length > 0 && <p>Mapped more than once: {duplicates.join(", ")}. Map each field to a single column.</p>}
                </div>
              </div>
            )}

            <Tabs defaultValue="mapping" className="flex min-h-0 flex-1 flex-col">
              <TabsList>
                <TabsTrigger value="mapping">Column mapping</TabsTrigger>
                <TabsTrigger value="preview">Data preview ({preview.totalRows} rows)</TabsTrigger>
              </TabsList>
              <TabsContent value="mapping" className="min-h-0 flex-1 overflow-auto rounded-lg border">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead>Spreadsheet column</TableHead>
                      <TableHead>Sample values</TableHead>
                      <TableHead className="w-72">Reporting field</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.headers.map((h, i) => {
                      const key = draft[String(i)];
                      const f = key ? fieldByKey.get(key) : undefined;
                      const conf = preview.confidence[String(i)];
                      return (
                        <TableRow key={i}>
                          <TableCell className="font-medium">
                            {h}
                            {key && conf !== undefined && conf < 1 && (
                              <Badge variant="outline" className="ml-2 text-[10px]">
                                check
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
                            {f?.pii ? <span className="italic">personal data — hidden</span> : samples(i).join(" · ") || "—"}
                          </TableCell>
                          <TableCell>
                            <Select
                              value={key ?? IGNORE}
                              onValueChange={(v) => {
                                const next = { ...draft };
                                if (v === IGNORE) delete next[String(i)];
                                else next[String(i)] = v;
                                setDraft(next);
                              }}
                            >
                              <SelectTrigger className="w-full" aria-label={`Field for column ${h}`} aria-invalid={key ? (used.get(key) ?? 0) > 1 : undefined}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="max-h-80">
                                <SelectItem value={IGNORE}>— Ignore this column —</SelectItem>
                                {grouped.map(([group, fs]) => (
                                  <SelectGroup key={group}>
                                    <SelectLabel>{GROUP_LABEL[group] ?? group}</SelectLabel>
                                    {fs.map((fd) => (
                                      <SelectItem key={fd.key} value={fd.key}>
                                        {fd.label}
                                        {used.has(fd.key) && fd.key !== key ? " (in use)" : ""}
                                      </SelectItem>
                                    ))}
                                  </SelectGroup>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TabsContent>
              <TabsContent value="preview" className="min-h-0 flex-1 overflow-auto rounded-lg border">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      {preview.headers.map((h, i) => (
                        <TableHead key={i} className="whitespace-nowrap">
                          {h}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rows.map((r, ri) => (
                      <TableRow key={ri}>
                        {preview.headers.map((_, ci) => (
                          <TableCell key={ci} className="max-w-48 truncate text-xs">
                            {cell(r[ci])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TabsContent>
            </Tabs>

            <div className="flex flex-wrap items-end gap-3 border-t pt-3">
              {templates.filter((t) => t.kind === kind).length > 0 && (
                <div className="space-y-1.5">
                  <Label>Apply saved template</Label>
                  <Select onValueChange={applyTemplate}>
                    <SelectTrigger className="w-56">
                      <SelectValue placeholder="Choose a template" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates
                        .filter((t) => t.kind === kind)
                        .map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="tpl-name">Save this mapping as a template</Label>
                <div className="flex gap-2">
                  <Input id="tpl-name" placeholder="e.g. SalesMax standard export" value={templateName} onChange={(e) => setTemplateName(e.target.value)} className="w-64" maxLength={80} />
                  <Button variant="outline" onClick={saveTemplate} disabled={!templateName.trim()}>
                    <Save data-icon="inline-start" />
                    Save template
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Templates store column names only — never lead data.</p>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || loading || !preview}>
            {saving && <Loader2 className="animate-spin" data-icon="inline-start" />}
            Save mapping & validate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
