"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { todayIso } from "@/lib/format";
import type { LeadQuery, Meta, Recommendation, Report, Session } from "@/lib/types";

// Only the opaque session id is kept in the browser (sessionStorage, cleared when the tab closes).
// Lead data is never written to browser storage.
const STORAGE_KEY = "leadpulse.sessionId";

interface Ctx {
  meta: Meta | null;
  session: Session | null;
  report: Report | null;
  recommendations: Recommendation[];
  loading: boolean;
  busy: string | null;
  pendingDate: string;
  setPendingDate: (d: string) => void;
  /** Session type chosen before the first upload. */
  pendingMode: "production" | "test";
  setPendingMode: (m: "production" | "test") => void;
  /** Deletes the current test session and starts a fresh one (production data is never touched). */
  resetTestSession: () => Promise<void>;
  ensureSession: () => Promise<Session>;
  upload: (files: File[]) => Promise<void>;
  uploadProgress: number | null;
  /** Runs a session mutation with a busy label; refreshes the session and report afterwards. */
  run: (label: string, fn: (id: string) => Promise<Session | void>, success?: string) => Promise<boolean>;
  refresh: () => Promise<void>;
  clear: () => Promise<void>;
  /** Replaces one uploaded file with a new version. */
  replaceFile: (fileId: string, file: File) => Promise<void>;
  /** Re-opens a session from report history (if it has not expired). */
  openSession: (id: string) => Promise<boolean>;
  /** Filter handed from a chart click to the lead table. */
  leadFilter: LeadQuery | null;
  setLeadFilter: (q: LeadQuery | null) => void;
}

const SessionContext = createContext<Ctx | null>(null);

export function useSession(): Ctx {
  const c = useContext(SessionContext);
  if (!c) throw new Error("useSession must be used inside SessionProvider");
  return c;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const details = Array.isArray(e.details)
      ? (e.details as { fileName?: string; problems?: string[]; message?: string; path?: string }[])
          .map((d) => (d.fileName ? `${d.fileName}: ${(d.problems ?? []).join(" ")}` : d.path ? `${d.path}: ${d.message}` : ""))
          .filter(Boolean)
          .join("\n")
      : "";
    return details ? `${e.message}\n${details}` : e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}

function storedId(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function storeId(id: string | null) {
  try {
    if (id) sessionStorage.setItem(STORAGE_KEY, id);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: session lasts for this page only */
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  // Today is resolved in the browser after mount, never at build/prerender time.
  const [pendingDate, setPendingDate] = useState<string>("");
  const [pendingMode, setPendingMode] = useState<"production" | "test">("production");
  const lastReportKey = useRef<string | null>(null);

  const lostSession = useCallback((e: unknown) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 410)) {
      storeId(null);
      setSession(null);
      setReport(null);
      lastReportKey.current = null;
      toast.warning(e.status === 410 ? "Your reporting session expired and its temporary data was deleted." : "The reporting session is no longer available (it may have expired or the server restarted).");
      return true;
    }
    return false;
  }, []);

  const loadReport = useCallback(async (s: Session | null) => {
    if (!s?.report.available) {
      setReport(null);
      setRecommendations([]);
      lastReportKey.current = null;
      return;
    }
    const key = `${s.id}:${s.report.lastProcessedAt}`;
    if (key === lastReportKey.current) return;
    const r = await api.report(s.id);
    lastReportKey.current = key;
    setReport(r.report);
    setRecommendations(r.recommendations);
  }, []);

  const applySession = useCallback(
    async (s: Session) => {
      setSession(s);
      setPendingDate(s.settings.reportingDate);
      await loadReport(s);
    },
    [loadReport],
  );

  useEffect(() => {
    api.meta().then(setMeta).catch(() => toast.error("Cannot reach the reporting server. Start the backend and reload."));
    const id = storedId();
    (id ? api.getSession(id).then(applySession) : Promise.resolve())
      .catch((e) => {
        if (!lostSession(e)) toast.error(errorMessage(e));
      })
      .finally(() => {
        setPendingDate((d) => d || todayIso());
        setLoading(false);
      });
  }, [applySession, lostSession]);

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      await applySession(await api.getSession(session.id));
    } catch (e) {
      if (!lostSession(e)) toast.error(errorMessage(e));
    }
  }, [session, applySession, lostSession]);

  const ensureSession = useCallback(async () => {
    if (session) return session;
    const s = await api.createSession(pendingDate, pendingMode);
    storeId(s.id);
    setSession(s);
    return s;
  }, [session, pendingDate, pendingMode]);

  const run = useCallback<Ctx["run"]>(
    async (label, fn, success) => {
      if (!session) return false;
      setBusy(label);
      try {
        const out = await fn(session.id);
        await applySession(out ?? (await api.getSession(session.id)));
        if (success) toast.success(success);
        return true;
      } catch (e) {
        if (!lostSession(e)) toast.error(errorMessage(e), { duration: 8000 });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [session, applySession, lostSession],
  );

  const upload = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setBusy("Uploading files");
      setUploadProgress(0);
      try {
        const s = await ensureSession();
        const res = await api.uploadFiles(s.id, files, setUploadProgress);
        await applySession(res.session);
        const added = res.session.files.filter((f) => res.added.includes(f.id));
        const failed = added.filter((f) => f.status === "error");
        const needs = added.filter((f) => f.status === "needs_mapping");
        if (failed.length) toast.error(`${failed.length} file(s) could not be read: ${failed.map((f) => f.name).join(", ")}`);
        if (needs.length) toast.warning(`${needs.length} file(s) need column mapping before processing.`);
        const ok = added.length - failed.length - needs.length;
        if (ok) toast.success(`${ok} file(s) uploaded and validated.`);
      } catch (e) {
        if (!lostSession(e)) toast.error(errorMessage(e));
      } finally {
        setBusy(null);
        setUploadProgress(null);
      }
    },
    [ensureSession, applySession, lostSession],
  );

  const [leadFilter, setLeadFilter] = useState<LeadQuery | null>(null);

  const replaceFile = useCallback(
    async (fileId: string, file: File) => {
      if (!session) return;
      setBusy("Replacing file");
      setUploadProgress(0);
      try {
        const res = await api.uploadFiles(session.id, [file], setUploadProgress, fileId);
        await applySession(res.session);
        const added = res.session.files.find((f) => res.added.includes(f.id));
        if (added?.status === "error") toast.error(`${file.name} could not be used: ${added.error?.message ?? "unknown error"}. The original file was kept.`);
        else toast.success(`File replaced with ${file.name}.`);
      } catch (e) {
        if (!lostSession(e)) toast.error(errorMessage(e));
      } finally {
        setBusy(null);
        setUploadProgress(null);
      }
    },
    [session, applySession, lostSession],
  );

  const openSession = useCallback(
    async (id: string) => {
      try {
        const s = await api.getSession(id);
        storeId(s.id);
        lastReportKey.current = null;
        await applySession(s);
        return true;
      } catch (e) {
        if (!lostSession(e)) toast.error(errorMessage(e));
        return false;
      }
    },
    [applySession, lostSession],
  );

  const clear = useCallback(async () => {
    if (!session) return;
    setBusy("Clearing session");
    try {
      await api.clearSession(session.id);
      toast.success("Session cleared. All temporary files and lead data were deleted from the server.");
    } catch (e) {
      if (!(e instanceof ApiError && (e.status === 404 || e.status === 410))) {
        toast.error(errorMessage(e));
        setBusy(null);
        return;
      }
    }
    storeId(null);
    setSession(null);
    setReport(null);
    setRecommendations([]);
    lastReportKey.current = null;
    setBusy(null);
  }, [session]);

  const resetTestSession = useCallback(async () => {
    if (!session || session.mode !== "test") return;
    setBusy("Resetting test session");
    try {
      await api.clearSession(session.id).catch(() => undefined);
      const fresh = await api.createSession(session.settings.reportingDate, "test");
      storeId(fresh.id);
      lastReportKey.current = null;
      await applySession(fresh);
      toast.success("Test session reset. All test files and reports were deleted.");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }, [session, applySession]);

  const value = useMemo<Ctx>(
    () => ({ meta, session, report, recommendations, loading, busy, pendingDate, setPendingDate, pendingMode, setPendingMode, resetTestSession, ensureSession, upload, uploadProgress, run, refresh, clear, replaceFile, openSession, leadFilter, setLeadFilter }),
    [meta, session, report, recommendations, loading, busy, pendingDate, pendingMode, resetTestSession, ensureSession, upload, uploadProgress, run, refresh, clear, replaceFile, openSession, leadFilter],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
