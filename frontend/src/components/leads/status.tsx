"use client";

import { AlertTriangle, CheckCircle2, CopyX, Copy, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { LeadFlag, LeadStatus } from "@/lib/types";

export const STATUS_LABEL: Record<LeadStatus, string> = {
  valid: "Valid",
  duplicate: "Duplicate",
  possible_duplicate: "Possible duplicate",
  invalid: "Invalid",
};

export const FLAG_LABEL: Record<LeadFlag, string> = {
  missing_phone: "Missing phone",
  invalid_phone: "Invalid phone",
  missing_email: "Missing email",
  invalid_email: "Invalid email",
  missing_name: "Missing name",
  missing_campaign: "Missing campaign",
  missing_source: "Missing source",
  missing_created_date: "Missing created date",
  outside_period: "Outside reporting period",
  no_identifier: "No identifier",
};

/** Status always shows an icon + label, never colour alone. */
export function StatusBadge({ status }: { status: LeadStatus }) {
  const cfg = {
    valid: { icon: CheckCircle2, cls: "border-[color:var(--status-good)] text-[color:var(--status-good)]" },
    duplicate: { icon: Copy, cls: "border-[color:var(--status-warning)] text-[color:var(--status-warning)]" },
    possible_duplicate: { icon: CopyX, cls: "border-dashed border-[color:var(--status-warning)] text-[color:var(--status-warning)]" },
    invalid: { icon: XCircle, cls: "border-[color:var(--status-critical)] text-[color:var(--status-critical)]" },
  }[status];
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`gap-1 whitespace-nowrap ${cfg.cls}`}>
      <Icon className="size-3" aria-hidden />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function FlagList({ flags }: { flags: LeadFlag[] }) {
  if (!flags.length) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-[color:var(--status-warning)]" title={flags.map((f) => FLAG_LABEL[f]).join(", ")}>
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{flags.map((f) => FLAG_LABEL[f]).join(", ")}</span>
    </span>
  );
}
