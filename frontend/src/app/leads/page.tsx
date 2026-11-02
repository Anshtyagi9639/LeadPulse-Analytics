"use client";

import { LeadsTable } from "@/components/leads/leads-table";
import { PageHeader } from "@/components/page-header";
import { useSession } from "@/components/session-provider";
import { EmptyState, PageSkeleton } from "@/components/states";

export default function LeadsPage() {
  const { session, loading } = useSession();
  if (loading) return <PageSkeleton />;
  if (!session) return <EmptyState title="No reporting session yet">Upload files first.</EmptyState>;
  return (
    <>
      <PageHeader
        title="Lead table"
        description="Every uploaded row with its validation and duplicate status. Nothing is hidden or deleted: duplicates and invalid rows are flagged so you can review and export them. Click a row for full details."
      />
      <LeadsTable />
    </>
  );
}
