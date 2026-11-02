"use client";

import { PageHeader } from "@/components/page-header";
import { useSession } from "@/components/session-provider";
import { PageSkeleton } from "@/components/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function DefinitionsPage() {
  const { meta } = useSession();
  if (!meta) return <PageSkeleton />;
  const groups = [...new Set(meta.definitions.map((d) => d.category))];
  return (
    <>
      <PageHeader title="KPI & KPM definitions" description="Every figure in the dashboard and exports is calculated on the server with these formulas. When data is missing or a denominator is zero, the metric shows N/A — values are never estimated." />
      <div className="space-y-6">
        {groups.map((g) => (
          <Card key={g}>
            <CardHeader>
              <CardTitle className="text-base">{g}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                {meta.definitions
                  .filter((d) => d.category === g)
                  .map((d) => (
                    <div key={d.key} className="grid gap-1 py-3 md:grid-cols-[220px_minmax(0,1fr)] md:gap-6">
                      <dt className="text-sm font-medium">{d.name}</dt>
                      <dd className="space-y-1 text-sm">
                        <p className="font-mono text-[13px]">{d.formula}</p>
                        {d.notes && <p className="text-muted-foreground">{d.notes}</p>}
                      </dd>
                    </div>
                  ))}
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
