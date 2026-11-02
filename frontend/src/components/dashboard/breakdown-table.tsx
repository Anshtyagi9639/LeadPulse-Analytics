"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import { fmtInt, fmtMoney, fmtNum, fmtPct } from "@/lib/format";
import type { BreakdownRow } from "@/lib/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type ColKind = "int" | "pct" | "money" | "num" | "text";
export interface Col<T> {
  key: keyof T & string;
  label: string;
  kind: ColKind;
  title?: string;
}

export function fmtCell(v: unknown, kind: ColKind, currency: string): string {
  if (kind === "text") return v === null || v === undefined ? "—" : String(v);
  const n = v as number | null;
  if (kind === "int") return fmtInt(n);
  if (kind === "pct") return fmtPct(n);
  if (kind === "money") return fmtMoney(n, currency);
  return fmtNum(n);
}

export function SortableTable<T extends object>({ rows, cols, currency, initialSort, caption, rowKey }: { rows: T[]; cols: Col<T>[]; currency: string; initialSort?: keyof T & string; caption?: string; rowKey: (r: T) => string }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: initialSort ?? cols[1]?.key ?? cols[0].key, dir: -1 });
  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => {
      const av = (a as Record<string, unknown>)[sort.key];
      const bv = (b as Record<string, unknown>)[sort.key];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1; // N/A always last
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * sort.dir;
      return String(av).localeCompare(String(bv)) * sort.dir;
    });
    return out;
  }, [rows, sort]);

  return (
    <div className="overflow-x-auto">
      <Table>
        {caption && <caption className="sr-only">{caption}</caption>}
        <TableHeader>
          <TableRow>
            {cols.map((c, i) => {
              const active = sort.key === c.key;
              const Icon = active ? (sort.dir === 1 ? ArrowUp : ArrowDown) : ArrowUpDown;
              return (
                <TableHead key={c.key} className={cn(c.kind !== "text" && "text-right", i === 0 && "sticky left-0 z-10 bg-background")} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"} title={c.title}>
                  <button
                    type="button"
                    className={cn("inline-flex items-center gap-1 whitespace-nowrap hover:text-foreground", c.kind !== "text" && "flex-row-reverse")}
                    onClick={() => setSort({ key: c.key, dir: active ? (sort.dir === 1 ? -1 : 1) : c.kind === "text" ? 1 : -1 })}
                  >
                    {c.label}
                    <Icon className={cn("size-3", !active && "opacity-40")} aria-hidden />
                  </button>
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r) => (
            <TableRow key={rowKey(r)}>
              {cols.map((c, i) => {
                const v = (r as Record<string, unknown>)[c.key];
                const text = fmtCell(v, c.kind, currency);
                return (
                  <TableCell key={c.key} className={cn(c.kind !== "text" && "text-right tabular-nums", i === 0 && "sticky left-0 max-w-64 truncate bg-background font-medium", text === "N/A" && "text-muted-foreground")} title={i === 0 ? String(v) : undefined}>
                    {text}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export const CAMPAIGN_COLS = (first: string, withAds: boolean): Col<BreakdownRow>[] => [
  { key: "label", label: first, kind: "text" },
  { key: "leads", label: "Leads", kind: "int", title: "Rows in the report (after the selected duplicate option)" },
  { key: "uniqueLeads", label: "Unique", kind: "int" },
  { key: "share", label: "Share", kind: "pct" },
  { key: "qualified", label: "Qualified", kind: "int" },
  { key: "qualificationRate", label: "Qual. rate", kind: "pct", title: "Qualified ÷ (qualified + unqualified)" },
  { key: "contactRate", label: "Contact rate", kind: "pct" },
  { key: "spend", label: "Spend", kind: "money" },
  { key: "cpl", label: "CPL", kind: "money" },
  { key: "costPerQualified", label: "Cost / qualified", kind: "money" },
  { key: "applications", label: "Applications", kind: "int" },
  { key: "applicationRate", label: "App. conv.", kind: "pct" },
  { key: "enrolments", label: "Enrolments", kind: "int" },
  { key: "enrolmentRate", label: "Enrol. conv.", kind: "pct" },
  { key: "targetLeads", label: "Target", kind: "int" },
  { key: "targetAchievement", label: "Target ach.", kind: "pct" },
  ...(withAds
    ? ([
        { key: "budgetUtilisation", label: "Budget used", kind: "pct" },
        { key: "ctr", label: "CTR", kind: "pct" },
        { key: "cpc", label: "CPC", kind: "money" },
        { key: "cpm", label: "CPM", kind: "money" },
        { key: "cplChange", label: "CPL vs baseline", kind: "pct" },
      ] as Col<BreakdownRow>[])
    : []),
  { key: "duplicateRows", label: "Dupes excl.", kind: "int" },
];
