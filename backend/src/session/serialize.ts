import type { AppConfig } from '../config.js';
import type { Session, SessionFile } from './store.js';

/** Public view of a file. Excludes cell data and temp paths. */
export function fileSummary(f: SessionFile, session: Session) {
  const v = f.validation;
  const sheet = f.workbook?.sheets[f.sheetIndex];
  return {
    id: f.id,
    name: f.name,
    ext: f.ext,
    size: f.size,
    uploadedAt: f.uploadedAt,
    uploadStartedAt: f.uploadStartedAt,
    uploadCompletedAt: f.uploadCompletedAt,
    processingMs: f.processingMs,
    processedAt: f.processedAt,
    status: f.status,
    error: f.error,
    kind: f.kind,
    sheetName: sheet?.name ?? null,
    sheetCount: f.workbook?.sheets.length ?? 0,
    headerRow: f.headerRow,
    headerRowNumber: sheet ? sheet.firstRow + f.headerRow : null,
    headers: f.headers,
    mapping: f.mapping,
    mappingConfidence: f.mappingConfidence,
    mappingProblems: f.mappingProblems,
    templateApplied: f.templateApplied,
    dateOrder: f.dateOrder,
    inReport: session.reportFileIds.includes(f.id),
    validation: v
      ? {
          dataRows: v.dataRows,
          blankRows: v.blankRows,
          accepted: v.accepted,
          rejected: v.rejected,
          rowsWithWarnings: v.rowsWithWarnings,
          issueCount: v.issueCount,
          errorCount: v.issues.filter((i) => i.severity === 'error').length,
          mappedFields: v.mappedFields,
          missingFields: v.missingFields,
          unmappedColumns: v.unmappedColumns,
          dateOrders: v.dateOrders,
          validatedAt: f.validatedAt,
        }
      : null,
  };
}

export function sessionSummary(s: Session, config: AppConfig) {
  const files = [...s.files.values()].sort((a, b) => a.order - b.order);
  return {
    id: s.id,
    createdAt: new Date(s.createdAt).toISOString(),
    expiresAt: new Date(s.expiresAt).toISOString(),
    settings: s.settings,
    campaignInputs: s.campaignInputs,
    duplicateDecisionCount: Object.keys(s.duplicateDecisions).length,
    files: files.map((f) => fileSummary(f, s)),
    totals: {
      files: files.length,
      rawRows: files.reduce((n, f) => n + (f.kind === 'leads' ? (f.validation?.dataRows ?? 0) : 0), 0),
      uniqueLeads: s.report?.counts.uniqueLeads ?? null,
      reportedLeads: s.report?.counts.reportedLeads ?? null,
    },
    report: {
      available: Boolean(s.report),
      fileIds: s.reportFileIds,
      stale: s.reportStale,
      lastProcessedAt: s.lastProcessedAt ? new Date(s.lastProcessedAt).toISOString() : null,
      lastProcessingStartedAt: s.lastProcessingStartedAt ? new Date(s.lastProcessingStartedAt).toISOString() : null,
      lastProcessingMs: s.lastProcessingMs,
      generatedAt: s.report?.generatedAt ?? null,
    },
    mode: s.mode,
    generatedReports: s.generatedReports.length,
    ai: {
      enabled: Boolean(config.OPENAI_API_KEY),
      requestsUsed: s.aiRequests,
      requestsLimit: config.AI_MAX_REQUESTS_PER_SESSION,
    },
  };
}
