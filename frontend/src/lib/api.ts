import type {
  ContactFilters,
  ContactView,
  DuplicateRuleResult,
  GeneratedReport,
  GenerateRequest,
  AuditEntry,
  FileComparison,
  HistoryEntry,
  LeadExportRequest,
  LeadQuery,
  LeadsResponse,
  AiInsight,
  AiTask,
  CampaignInput,
  DuplicatesResponse,
  Meta,
  MappingTemplate,
  Preview,
  Recommendation,
  Report,
  Session,
  SessionFile,
  SessionSettings,
  ValidationIssue,
} from "./types";

/**
 * Base URL of the Express API. Set NEXT_PUBLIC_API_URL at build time (e.g. on Vercel). The localhost default
 * applies to `next dev` only — a production build without the variable reports a configuration error instead of
 * silently calling the visitor's own machine.
 */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "development" ? "http://localhost:4000" : "")).trim().replace(/\/$/, "");
export const API_CONFIGURED = API_URL !== "";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

const NOT_CONFIGURED = "The reporting server is not configured for this deployment (NEXT_PUBLIC_API_URL is not set). Ask the administrator to set it and redeploy.";

/**
 * A failed fetch looks the same to the page whether the server is down, still waking up, or refused this site's
 * origin (CORS), so the message names the server and all three causes instead of guessing one.
 */
function unreachable(action = "Cannot reach"): ApiError {
  let host = API_URL;
  try {
    host = new URL(API_URL).host;
  } catch {
    /* keep the raw value */
  }
  return new ApiError(
    0,
    "NETWORK_ERROR",
    `${action} the reporting server (${host}). It may be offline or starting up, or it may not allow this site's address (CORS). Try again in a minute; if it persists, ask the administrator.`,
  );
}

function assertConfigured() {
  if (!API_CONFIGURED) throw new ApiError(0, "API_NOT_CONFIGURED", NOT_CONFIGURED);
}

const CLIENT_KEY = "leadpulse.clientId";
let clientIdCache: string | null = null;

/**
 * Random id for this browser, sent as X-Client-Id so the server keeps each browser's sessions and
 * report history separate. It identifies the browser only — no lead data is stored in the browser.
 */
export function clientId(): string {
  if (clientIdCache) return clientIdCache;
  let id: string | null = null;
  try {
    id = localStorage.getItem(CLIENT_KEY);
  } catch {
    /* storage unavailable */
  }
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    id = crypto.randomUUID();
    try {
      localStorage.setItem(CLIENT_KEY, id);
    } catch {
      /* the id then lasts for this page only */
    }
  }
  clientIdCache = id;
  return id;
}

function qs(params: Record<string, string | number | string[] | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      if (v.length) p.set(k, v.join(","));
    } else p.set(k, String(v));
  }
  const out = p.toString();
  return out ? `?${out}` : "";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  assertConfigured();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      ...init,
      headers: init.body instanceof FormData ? { "X-Client-Id": clientId(), ...init.headers } : { "Content-Type": "application/json", "X-Client-Id": clientId(), ...init.headers },
      cache: "no-store",
    });
  } catch {
    throw unreachable();
  }
  const text = await res.text();
  const body = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = (body as { error?: { code: string; message: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? "HTTP_ERROR", err?.message ?? `Request failed (${res.status}).`, err?.details);
  }
  return body as T;
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });
const s = (id: string) => `/sessions/${id}`;

export const api = {
  meta: () => request<Meta>("/meta"),
  createSession: (reportingDate: string, mode: "production" | "test" = "production") => request<Session>("/sessions", json("POST", { reportingDate, mode })),
  getSession: (id: string) => request<Session>(s(id)),
  clearSession: (id: string) => request<{ deleted: boolean }>(s(id), json("DELETE")),
  updateSettings: (id: string, patch: Partial<SessionSettings>) => request<Session>(`${s(id)}/settings`, json("PATCH", patch)),

  /** Upload with progress (fetch has no upload progress events). */
  uploadFiles: (id: string, files: File[], onProgress?: (pct: number) => void, replaceFileId?: string) =>
    new Promise<{ session: Session; added: string[] }>((resolve, reject) => {
      if (!API_CONFIGURED) return reject(new ApiError(0, "API_NOT_CONFIGURED", NOT_CONFIGURED));
      const form = new FormData();
      for (const f of files) form.append("files", f, f.name);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_URL}/api${s(id)}/files${replaceFileId ? `?replace=${replaceFileId}` : ""}`);
      xhr.setRequestHeader("X-Client-Id", clientId());
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
      xhr.onerror = () => reject(unreachable("Upload failed: cannot reach"));
      xhr.onload = () => {
        const body = safeJson(xhr.responseText) as { error?: { code: string; message: string } } | null;
        if (xhr.status >= 200 && xhr.status < 300) resolve(body as { session: Session; added: string[] });
        else reject(new ApiError(xhr.status, body?.error?.code ?? "HTTP_ERROR", body?.error?.message ?? `Upload failed (${xhr.status}).`));
      };
      xhr.send(form);
    }),
  preview: (id: string, fileId: string, q: { sheet?: number; headerRow?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.sheet !== undefined) p.set("sheet", String(q.sheet));
    if (q.headerRow !== undefined) p.set("headerRow", String(q.headerRow));
    return request<Preview>(`${s(id)}/files/${fileId}/preview?${p}`);
  },
  configureFile: (id: string, fileId: string, body: Partial<{ sheetIndex: number; headerRow: number; kind: string; mapping: Record<string, string>; dateOrder: string; templateId: string }>) =>
    request<{ file: SessionFile; session: Session }>(`${s(id)}/files/${fileId}/config`, json("PUT", body)),
  fileIssues: (id: string, fileId: string, limit = 200) => request<{ total: number; stored: number; truncated: boolean; issues: ValidationIssue[] }>(`${s(id)}/files/${fileId}/issues?limit=${limit}`),
  removeFile: (id: string, fileId: string) => request<Session>(`${s(id)}/files/${fileId}`, json("DELETE")),
  process: (id: string, fileIds?: string[]) => request<Session>(`${s(id)}/process`, json("POST", fileIds ? { fileIds } : {})),
  recalculate: (id: string) => request<Session>(`${s(id)}/recalculate`, json("POST", {})),
  report: (id: string) => request<{ report: Report; recommendations: Recommendation[]; stale: string | null }>(`${s(id)}/report`),
  setCampaignInputs: (id: string, inputs: CampaignInput[]) => request<Session>(`${s(id)}/campaign-inputs`, json("PUT", { inputs })),
  duplicates: (id: string, q: { kind?: "confirmed" | "possible"; limit?: number; offset?: number }) => {
    const p = new URLSearchParams({ limit: String(q.limit ?? 25), offset: String(q.offset ?? 0) });
    if (q.kind) p.set("kind", q.kind);
    return request<DuplicatesResponse>(`${s(id)}/duplicates?${p}`);
  },
  setDecisions: (id: string, decisions: Record<string, string | null>) => request<Session>(`${s(id)}/duplicates/decisions`, json("PUT", { decisions })),
  ai: (id: string, task: AiTask, question?: string) => request<{ insight: AiInsight; requestsUsed: number; requestsLimit: number }>(`${s(id)}/ai`, json("POST", { task, question })),
  leads: (id: string, q: LeadQuery & { page: number; pageSize: number }) =>
    request<LeadsResponse>(
      `${s(id)}/leads${qs({
        page: q.page,
        pageSize: q.pageSize,
        search: q.search,
        fileIds: q.fileIds,
        statuses: q.statuses,
        flags: q.flags,
        sources: q.sources,
        campaigns: q.campaigns,
        leadStatuses: q.leadStatuses,
        dateFrom: q.dateFrom,
        dateTo: q.dateTo,
        presence: q.presence,
        owners: q.owners,
        stages: q.stages,
        dispositions: q.dispositions,
        followUp: q.followUp,
        sort: q.sort,
        dir: q.dir,
      })}`,
    ),
  comparison: (id: string, fileIds?: string[]) => request<FileComparison>(`${s(id)}/comparison${qs({ fileIds })}`),
  previewReport: (id: string, fileIds: string[]) => request<{ report: Report }>(`${s(id)}/report/preview${qs({ fileIds })}`),
  audit: (id: string) => request<{ entries: AuditEntry[] }>(`${s(id)}/audit`),
  contactReport: (id: string, q: { fileIds?: string[]; reportDate?: string } & ContactFilters) =>
    request<ContactView>(`${s(id)}/contact-report${qs({ fileIds: q.fileIds, reportDate: q.reportDate, owners: q.owners, stages: q.stages, dispositions: q.dispositions, followUp: q.followUp })}`),
  duplicateRules: (id: string, fileIds?: string[]) => request<{ rules: DuplicateRuleResult[] }>(`${s(id)}/duplicate-rules${qs({ fileIds })}`),
  generateReport: (id: string, body: GenerateRequest) => request<{ reports: GeneratedReport[] }>(`${s(id)}/reports`, json("POST", body)),
  listReports: (id: string) => request<{ reports: GeneratedReport[] }>(`${s(id)}/reports`),
  history: () => request<{ entries: HistoryEntry[] }>("/history"),
  deleteHistory: (hid: string) => request<{ deleted: boolean }>(`/history/${hid}`, json("DELETE")),
  templates: () => request<{ templates: MappingTemplate[] }>("/mapping-templates"),
  saveTemplate: (sessionId: string, fileId: string, name: string) => request<{ template: MappingTemplate }>("/mapping-templates", json("POST", { sessionId, fileId, name })),
  deleteTemplate: (tid: string) => request<{ deleted: boolean }>(`/mapping-templates/${tid}`, json("DELETE")),
};

/** Downloads a file from the API, surfacing API errors instead of navigating to a JSON error page. */
/** Local timezone label shown next to timestamps and written into exports. */
export function timezoneLabel(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const short = new Date().toLocaleTimeString("en-US", { timeZoneName: "short" }).split(" ").pop();
    return short && tz ? `${short}, ${tz}` : tz || "local time";
  } catch {
    return "local time";
  }
}

/** POSTs an export request and saves the generated file. Resolves with the filename only after it was saved. */
export function downloadPost(path: string, body: LeadExportRequest): Promise<string> {
  return download(path, { method: "POST", body: JSON.stringify(body) });
}

export async function download(path: string, init?: RequestInit): Promise<string> {
  assertConfigured();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, { cache: "no-store", ...init, headers: { "X-Client-Id": clientId(), ...(init?.body ? { "Content-Type": "application/json" } : {}) } });
  } catch {
    throw unreachable();
  }
  if (!res.ok) {
    const body = safeJson(await res.text()) as { error?: { code: string; message: string } } | null;
    throw new ApiError(res.status, body?.error?.code ?? "HTTP_ERROR", body?.error?.message ?? "Download failed.");
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") ?? "";
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? "report";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}
