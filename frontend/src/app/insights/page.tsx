"use client";

import { AlertCircle, Copy, Loader2, Send, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { AiInsight, AiTask } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { errorMessage, useSession } from "@/components/session-provider";
import { RequireReport } from "@/components/states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

const TASKS: { task: Exclude<AiTask, "question">; label: string; help: string }[] = [
  { task: "summary", label: "Summarise today", help: "Overall volume, quality, cost and conversion" },
  { task: "campaigns", label: "Explain campaign differences", help: "Strongest and weakest campaigns and sources" },
  { task: "cpl", label: "Unusual CPL", help: "Outliers versus overall CPL and baselines" },
  { task: "data_quality", label: "Data-quality problems", help: "What affects the reliability of the figures" },
  { task: "recommendations", label: "Suggest improvements", help: "Follow-up and campaign actions" },
  { task: "eod", label: "Draft EOD summary", help: "Email-ready management summary" },
];

function InsightView({ insight }: { insight: AiInsight }) {
  const text = [insight.summary, "", "Observed facts:", ...insight.observations.map((o) => `- ${o}`), "", "Recommendations:", ...insight.recommendations.map((o) => `- ${o}`), ...(insight.dataGaps.length ? ["", "Data gaps:", ...insight.dataGaps.map((o) => `- ${o}`)] : [])].join("\n");
  return (
    <Card data-testid="ai-insight">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">{TASKS.find((t) => t.task === insight.task)?.label ?? "Answer"}</CardTitle>
          <CardDescription>
            Generated {new Date(insight.generatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} by {insight.model} from the calculated report figures only.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(text).then(() => toast.success("Copied to clipboard."))}>
          <Copy data-icon="inline-start" />
          Copy
        </Button>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <p className="whitespace-pre-line leading-relaxed">{insight.summary}</p>
        {insight.observations.length > 0 && (
          <section>
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Observed facts</h3>
            <ul className="list-disc space-y-1 pl-5">
              {insight.observations.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          </section>
        )}
        {insight.recommendations.length > 0 && (
          <section>
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Recommendations</h3>
            <ul className="list-disc space-y-1 pl-5">
              {insight.recommendations.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          </section>
        )}
        {insight.dataGaps.length > 0 && (
          <section>
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Insufficient data</h3>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {insight.dataGaps.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          </section>
        )}
        {insight.counsellorLegend && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Counsellor names were pseudonymised for the AI — show legend</summary>
            <ul className="mt-1 space-y-0.5">
              {Object.entries(insight.counsellorLegend).map(([a, n]) => (
                <li key={a}>
                  {a} = {n}
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

export default function InsightsPage() {
  const { session, meta } = useSession();
  const [pending, setPending] = useState<AiTask | null>(null);
  const [insight, setInsight] = useState<AiInsight | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [used, setUsed] = useState<{ used: number; limit: number } | null>(null);
  const enabled = meta?.aiEnabled ?? session?.ai.enabled ?? false;

  const ask = async (task: AiTask) => {
    if (!session) return;
    setPending(task);
    setError(null);
    try {
      const r = await api.ai(session.id, task, task === "question" ? question : undefined);
      setInsight(r.insight);
      setUsed({ used: r.requestsUsed, limit: r.requestsLimit });
    } catch (e) {
      setError(e instanceof ApiError && e.code === "AI_NOT_CONFIGURED" ? e.message : errorMessage(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <RequireReport>
      <PageHeader title="AI insights" description="Ask ChatGPT to explain the calculated report. It receives aggregated statistics only and cannot change the figures." />
      <div className="space-y-6">
        <Alert>
          <ShieldCheck />
          <AlertTitle>What is sent to the AI</AlertTitle>
          <AlertDescription>
            Only the calculated totals, rates and campaign/source/counsellor summaries. No student names, phone numbers, email addresses or individual rows. Counsellor names are replaced with labels. AI output is advisory — always check it against the dashboard.
          </AlertDescription>
        </Alert>
        {!enabled && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>AI insights are not configured</AlertTitle>
            <AlertDescription>The server has no OPENAI_API_KEY. Dashboards and exports work without it; ask your administrator to configure the key to enable this page.</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {TASKS.map((t) => (
            <button
              key={t.task}
              type="button"
              disabled={!enabled || pending !== null}
              onClick={() => ask(t.task)}
              className="flex items-start gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary hover:bg-primary/5 disabled:pointer-events-none disabled:opacity-50"
            >
              {pending === t.task ? <Loader2 className="mt-0.5 size-4 animate-spin text-primary" aria-hidden /> : <Sparkles className="mt-0.5 size-4 text-primary" aria-hidden />}
              <span>
                <span className="block text-sm font-medium">{t.label}</span>
                <span className="block text-xs text-muted-foreground">{t.help}</span>
              </span>
            </button>
          ))}
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ask about this report</CardTitle>
            <CardDescription>e.g. “Which source gave the cheapest qualified leads?” {used && `· ${used.used}/${used.limit} AI requests used this session`}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Textarea value={question} onChange={(e) => setQuestion(e.target.value.slice(0, 500))} placeholder="Type a question…" className="min-h-16 flex-1" aria-label="Question" />
            <Button onClick={() => ask("question")} disabled={!enabled || !question.trim() || pending !== null}>
              {pending === "question" ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Send data-icon="inline-start" />}
              Ask
            </Button>
          </CardContent>
        </Card>
        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>The AI request did not complete</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {insight && <InsightView insight={insight} />}
      </div>
    </RequireReport>
  );
}
