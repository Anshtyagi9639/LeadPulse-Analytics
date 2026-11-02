// Mirrors the Express API responses (backend/src/session/serialize.ts, backend/src/domain/kpi.ts).

export type FileKind = "leads" | "ad_spend";
export type DuplicateMode = "count_all" | "exclude_duplicates" | "keep_latest" | "manual_review";
export type DateOrder = "auto" | "DMY" | "MDY" | "YMD";

export interface FieldMeta {
  key: string;
  label: string;
  group: "student" | "marketing" | "sales" | "conversion" | "advertising";
  type: string;
  pii: boolean;
}

export interface KpiDefinition {
  key: string;
  name: string;
  category: string;
  formula: string;
  notes: string;
}

export interface Meta {
  fields: Record<FileKind, FieldMeta[]>;
  definitions: KpiDefinition[];
  limits: { maxFileSizeMb: number; maxFilesPerSession: number; maxRowsPerSheet: number; maxRowsPerSession: number; sessionTtlHours: number };
  currency: string;
  aiEnabled: boolean;
}

export interface FileValidationSummary {
  dataRows: number;
  blankRows: number;
  accepted: number;
  rejected: number;
  rowsWithWarnings: number;
  issueCount: number;
  errorCount: number;
  mappedFields: string[];
  missingFields: string[];
  unmappedColumns: string[];
  dateOrders: Record<string, { order: string; ambiguous: boolean }>;
  validatedAt: string | null;
}

export interface SessionFile {
  id: string;
  name: string;
  ext: string;
  size: number;
  uploadedAt: string;
  uploadStartedAt: string;
  uploadCompletedAt: string | null;
  processingMs: number | null;
  processedAt: string | null;
  status: "ready" | "needs_mapping" | "error";
  error: { code: string; message: string } | null;
  kind: FileKind;
  sheetName: string | null;
  sheetCount: number;
  headerRow: number;
  headerRowNumber: number | null;
  headers: string[];
  mapping: Record<string, string>;
  mappingConfidence: Record<string, number>;
  mappingProblems: string[];
  templateApplied: string | null;
  dateOrder: DateOrder;
  inReport: boolean;
  validation: FileValidationSummary | null;
}

export interface SessionSettings {
  reportingDate: string;
  dateRange: { from: string; to: string } | null;
  dateFilter: "include_all" | "restrict";
  duplicateMode: DuplicateMode;
  cautiousMatching: boolean;
  overallTargetLeads: number | null;
  overallBudget: number | null;
  filters: { campaigns: string[]; sources: string[] };
  matchRules: { leadId: boolean; phone: boolean; email: boolean };
}

export interface CampaignInput {
  id?: string;
  campaignName: string | null;
  source: string | null;
  spend: number | null;
  budget: number | null;
  targetLeads: number | null;
  impressions: number | null;
  clicks: number | null;
  baselineCpl: number | null;
}

export interface Session {
  id: string;
  createdAt: string;
  expiresAt: string;
  settings: SessionSettings;
  campaignInputs: CampaignInput[];
  duplicateDecisionCount: number;
  files: SessionFile[];
  totals: { files: number; rawRows: number; uniqueLeads: number | null; reportedLeads: number | null };
  report: { available: boolean; fileIds: string[]; stale: string | null; lastProcessedAt: string | null; lastProcessingStartedAt: string | null; lastProcessingMs: number | null; generatedAt: string | null };
  ai: { enabled: boolean; requestsUsed: number; requestsLimit: number };
  mode: "production" | "test";
  generatedReports: number;
}

export interface Preview {
  fileId: string;
  sheets: { index: number; name: string; hidden: boolean; rows: number }[];
  sheetIndex: number;
  headerRow: number;
  headerRowNumber: number;
  topRows: (string | number | boolean | null)[][];
  headers: string[];
  rows: (string | number | boolean | null)[][];
  totalRows: number;
  mapping: Record<string, string>;
  confidence: Record<string, number>;
  kind: FileKind;
}

export interface ValidationIssue {
  fileId: string;
  fileName: string;
  sheet: string;
  rowNumber: number | null;
  field: string;
  severity: "error" | "warning";
  code: string;
  message: string;
  value: string;
}

export interface BreakdownRow {
  key: string;
  label: string;
  leads: number;
  uniqueLeads: number;
  share: number | null;
  assigned: number;
  contacted: number;
  contactRate: number | null;
  qualified: number;
  unqualified: number;
  qualificationRate: number | null;
  applications: number;
  applicationRate: number | null;
  offers: number;
  enrolments: number;
  enrolmentRate: number | null;
  revenue: number | null;
  spend: number | null;
  cpl: number | null;
  costPerQualified: number | null;
  costPerApplication: number | null;
  costPerEnrolment: number | null;
  targetLeads: number | null;
  targetAchievement: number | null;
  budget: number | null;
  budgetUtilisation: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  baselineCpl: number | null;
  cplChange: number | null;
  duplicateRows: number;
}

export interface CounsellorRow {
  counsellor: string;
  leads: number;
  contacted: number;
  contactRate: number | null;
  qualified: number;
  qualificationRate: number | null;
  medianFirstResponseMinutes: number | null;
  followUpsDue: number;
  followUpsCompleted: number;
  followUpsOverdue: number;
  followUpCompletion: number | null;
  counsellingBooked: number;
  counsellingAttended: number;
  applications: number;
  enrolments: number;
}

export interface FunnelStage {
  key: string;
  label: string;
  count: number | null;
  available: boolean;
  coverage: number;
  pctOfReceived: number | null;
  pctOfPrevious: number | null;
  note?: string;
}

export interface Report {
  generatedAt: string;
  reportingDate: string;
  period: { from: string; to: string; isRange: boolean };
  currency: string;
  settings: Pick<SessionSettings, "dateFilter" | "duplicateMode" | "cautiousMatching" | "filters">;
  scope: { fileIds: string[]; fileNames: string[]; leadFiles: number; adFiles: number };
  filterOptions: { campaigns: string[]; sources: string[] };
  counts: Record<
    | "rawRows" | "blankRows" | "acceptedRows" | "rejectedRows" | "rowsWithWarnings" | "leadsOutsidePeriod" | "excludedOutsidePeriod"
    | "missingCreatedDate" | "filteredOut" | "inScopeRows" | "uniqueLeads" | "reportedLeads" | "duplicateRows" | "duplicateRowsExcluded"
    | "possibleDuplicateRows" | "pendingReviewGroups",
    number
  >;
  overview: {
    totalLeads: number;
    uniqueLeads: number;
    qualifiedLeads: number | null;
    totalSpend: number | null;
    cpl: number | null;
    applications: number | null;
    enrolments: number | null;
    targetAchievement: number | null;
  };
  marketing: Record<string, number | null>;
  sales: {
    assigned: number | null;
    contacted: number | null;
    contactRate: number | null;
    qualified: number | null;
    unqualified: number | null;
    pendingQualification: number | null;
    qualificationRate: number | null;
    firstResponse: { count: number; medianMinutes: number | null; averageMinutes: number | null; within1hPct: number | null } | null;
    followUpsDue: number | null;
    followUpsDueInPeriod: number | null;
    followUpsCompleted: number | null;
    followUpsOverdue: number | null;
    followUpCompletion: number | null;
    counsellingBooked: number | null;
    counsellingAttended: number | null;
  };
  conversion: Record<string, number | null>;
  dataQuality: Record<string, number | null> & { unmappedColumns: { fileName: string; columns: string[] }[] };
  files: (Record<string, unknown> & { fileId: string; fileName: string; kind: FileKind; sheet: string; dataRows: number; accepted: number; rejected: number; blankRows: number; inReport: number; uniqueLeads: number; duplicateRows: number; outOfPeriod: number; qualified: number; applications: number; enrolments: number })[];
  campaigns: BreakdownRow[];
  sources: BreakdownRow[];
  dimensions: { medium: BreakdownRow[]; country: BreakdownRow[]; course: BreakdownRow[]; studyLevel: BreakdownRow[] };
  counsellors: CounsellorRow[];
  funnel: FunnelStage[];
  quality: { totalRecords: number; validLeads: number; duplicateLeads: number; possibleDuplicates: number; invalidLeads: number; leadsWithWarnings: number; validationSuccessRate: number | null };
  trend: { granularity: "hour" | "day"; points: { bucket: string; leads: number; qualified: number }[]; undated: number };
  statusDistribution: { status: string; leads: number }[];
  duplicates: {
    byFile: { fileName: string; duplicateRows: number; possibleDuplicateRows: number }[];
    byCampaign: { campaign: string; duplicateRows: number; possibleDuplicateRows: number }[];
    confirmedGroups: number;
    possibleGroups: number;
  };
  unavailable: Record<string, string>;
  notes: { level: "info" | "warning"; message: string }[];
}

export interface Recommendation {
  area: string;
  finding: string;
  action: string;
}

export interface DuplicateMember {
  uid: string;
  fileName: string;
  rowNumber: number;
  leadId: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  campaign: string;
  source: string;
  leadStatus: string | null;
  createdAt: string | null;
  counsellor: string | null;
}

export interface DuplicateGroup {
  id: string;
  kind: "confirmed" | "possible";
  matchedOn: string[];
  conflict: boolean;
  conflictReasons: string[];
  firstUid: string;
  latestUid: string;
  decision: "keep_all" | "keep_first" | "keep_latest" | null;
  members: DuplicateMember[];
}

export interface DuplicatesResponse {
  summary: {
    totalRows: number;
    uniqueLeads: number;
    duplicateRows: number;
    possibleDuplicateRows: number;
    missingIdRows: number;
    unidentifiableRows: number;
    conflictingRecords: number;
    confirmedGroups: number;
    possibleGroups: number;
    byFile: { fileName: string; duplicateRows: number; possibleDuplicateRows: number }[];
    byCampaign: { campaign: string; duplicateRows: number; possibleDuplicateRows: number }[];
  };
  total: number;
  groups: DuplicateGroup[];
}

export interface MappingTemplate {
  id: string;
  name: string;
  kind: FileKind;
  columns: Record<string, string>;
  createdAt: string;
}

export type AiTask = "summary" | "campaigns" | "cpl" | "data_quality" | "recommendations" | "eod" | "question";

export interface AiInsight {
  task: AiTask;
  summary: string;
  observations: string[];
  recommendations: string[];
  dataGaps: string[];
  model: string;
  generatedAt: string;
  counsellorLegend: Record<string, string> | null;
}

// --- Lead table, comparison, history (upgrade) ---------------------------------------------

export type LeadStatus = "valid" | "duplicate" | "possible_duplicate" | "invalid";
export type LeadFlag =
  | "missing_phone"
  | "invalid_phone"
  | "missing_email"
  | "invalid_email"
  | "missing_name"
  | "missing_campaign"
  | "missing_source"
  | "missing_created_date"
  | "outside_period"
  | "no_identifier";

export interface LeadRow {
  uid: string;
  fileId: string;
  fileName: string;
  rowNumber: number;
  status: LeadStatus;
  excludedFromReport: boolean;
  flags: LeadFlag[];
  rejectReason: string | null;
  duplicateGroupId: string | null;
  matchedOn: string[];
  alsoIn: string[];
  std: Record<string, string>;
  original: Record<string, string>;
}

export interface LeadQuery {
  search?: string;
  fileIds?: string[];
  statuses?: LeadStatus[];
  flags?: LeadFlag[];
  sources?: string[];
  campaigns?: string[];
  leadStatuses?: string[];
  dateFrom?: string;
  dateTo?: string;
  presence?: "all" | "unique_to_file" | "in_multiple_files";
  owners?: string[];
  stages?: string[];
  dispositions?: string[];
  followUp?: ("overdue" | "upcoming" | "none")[];
  sort?: string;
  dir?: "asc" | "desc";
}

export interface Facet {
  value: string;
  count: number;
}

export interface LeadsResponse {
  total: number;
  totalUnfiltered: number;
  page: number;
  pageSize: number;
  rows: LeadRow[];
  facets: { statuses: Facet[]; flags: Facet[]; files: Facet[]; sources: Facet[]; campaigns: Facet[]; leadStatuses: Facet[]; owners: Facet[]; stages: Facet[]; dispositions: Facet[]; followUp: Facet[] };
  columns: { standard: { key: string; label: string }[]; original: string[] };
  files: { id: string; name: string }[];
  labels: { statuses: Record<LeadStatus, string>; flags: Record<LeadFlag, string> };
}

export interface LeadExportRequest {
  format: "csv" | "xlsx";
  variant: "cleaned" | "original" | "both";
  query: LeadQuery;
  uids?: string[];
  stdColumns?: string[];
  originalColumns?: string[];
  timezoneLabel?: string;
}

export interface FileComparisonRow {
  fileId: string;
  fileName: string;
  sheet: string;
  totalRecords: number;
  blankRows: number;
  processedLeads: number;
  validLeads: number;
  duplicateRecords: number;
  withinFileDuplicates: number;
  duplicatePct: number | null;
  invalidRecords: number;
  incompleteRecords: number;
  failures: { reason: string; count: number }[];
  contact: { validPhonePct: number | null; validEmailPct: number | null; anyContactPct: number | null; namePct: number | null };
  attributionPct: number | null;
  qualityScore: number | null;
  uniqueToFile: number;
  sharedWithOtherFiles: number;
  timing: { uploadStartedAt: string | null; uploadCompletedAt: string | null; processingMs: number | null; processedAt: string | null };
}

export interface FileComparison {
  generatedAt: string;
  files: FileComparisonRow[];
  highlights: Record<"mostValidLeads" | "highestDuplicatePct" | "mostCompleteContact" | "bestQuality", { fileName: string; value: number } | null>;
  fieldMatrix: { key: string; label: string; columns: Record<string, string | null>; missingPct: Record<string, number | null> }[];
  columnDifferences: { header: string; presentIn: string[]; missingFrom: string[] }[];
  overlaps: { a: string; b: string; matchingLeads: number; byLeadId: number; byPhone: number; byEmail: number }[];
  qualityScoreDefinition: string;
}

export interface AuditEntry {
  at: string;
  action: string;
  detail: string;
}

export interface HistoryEntry {
  id: string;
  createdAt: string;
  updatedAt: string;
  reportingPeriod: { from: string; to: string };
  fileNames: string[];
  recordsProcessed: number;
  uniqueLeads: number;
  status: string;
  generations: number;
  lastGeneratedAt: string;
  processingMs: number | null;
  sessionExpiresAt: string;
  sessionAvailable: boolean;
  summaryAvailable: boolean;
  mode: "production" | "test";
  summary: { totalLeads: number; qualifiedLeads: number | null; totalSpend: number | null; cpl: number | null; currency: string } | null;
  reports: HistoryReport[];
}

// --- Lead Contact Report (SalesMax) ----------------------------------------------------------

export type FollowUpStatus = "overdue" | "upcoming" | "none";

export interface ContactReport {
  reportDate: string;
  kpis: {
    totalLeads: number;
    notWorked: number | null;
    workedAtLeastOnce: number | null;
    qualified: number | null;
    qualificationRate: number | null;
    totalAttempts: number | null;
    totalCalls: number | null;
    callsToday: number | null;
    interested: number | null;
    overdueFollowUps: number | null;
    upcomingFollowUps: number | null;
    noFollowUpDate: number | null;
  };
  owners: { owner: string; leads: number; notWorked: number; qualified: number; notQualified: number; totalCalls: number; callsToday: number }[];
  stages: { stage: string; leads: number; pct: number | null }[];
  dispositions: { disposition: string; leads: number; pct: number | null }[];
  lastWorkedByDate: { date: string; leads: number }[];
  missingFields: string[];
  notes: string[];
}

export interface ContactFilters {
  owners?: string[];
  stages?: string[];
  dispositions?: string[];
  followUp?: FollowUpStatus[];
}

export interface ReportColumn {
  key: string;
  header: string;
  kind: "text" | "number" | "date" | "phone";
  salesmax: boolean;
  presentIn: string[];
  missingIn: string[];
}

export interface ContactFileInfo {
  fileId: string;
  fileName: string;
  ext: string;
  size: number;
  sheetName: string;
  sheetNames: string[];
  rows: number;
  detectedColumns: number;
  leadsInReport: number;
  qualified: number;
  valid: number;
  duplicate: number;
  invalid: number;
  incomplete: number;
  mappedSalesmax: { header: string; source: string }[];
  missingSalesmax: string[];
  additionalColumns: string[];
  uploadStartedAt: string;
  uploadCompletedAt: string | null;
  processingMs: number | null;
}

export interface ContactView {
  reportDate: string;
  mode: "production" | "test";
  report: ContactReport;
  counts: { rawRows: number; accepted: number; rejected: number; uniqueLeads: number; duplicateRowsExcluded: number; possibleDuplicates: number; reportedLeads: number; filteredLeads: number };
  facets: { owners: Facet[]; stages: Facet[]; dispositions: Facet[]; followUp: Facet[] };
  files: ContactFileInfo[];
  columns: ReportColumn[];
  defaultColumns: string[];
  duplicateMode: DuplicateMode;
  matchRules: { leadId: boolean; phone: boolean; email: boolean };
}

export interface DuplicateRuleResult {
  label: string;
  mode: DuplicateMode;
  rules: { leadId: boolean; phone: boolean; email: boolean };
  current: boolean;
  acceptedRows: number;
  leadsInReport: number;
  uniqueLeads: number;
  duplicateRows: number;
  excludedRows: number;
  possibleDuplicates: number;
}

export interface GeneratedReport {
  id: string;
  type: "contact" | "combined" | "individual" | "comparison" | "quality";
  format: "xlsx" | "csv" | "pdf";
  test: boolean;
  status: "completed" | "failed";
  error: string | null;
  filename: string;
  size: number;
  fileIds: string[];
  fileNames: string[];
  totalLeads: number | null;
  reportDate: string;
  filters: string;
  uploadStartedAt: string | null;
  uploadCompletedAt: string | null;
  processingStartedAt: string | null;
  processingCompletedAt: string | null;
  processingMs: number | null;
  generationStartedAt: string;
  generationCompletedAt: string;
  generationMs: number;
  downloads: string[];
  fileAvailable: boolean;
}

export interface GenerateRequest {
  type: "contact" | "individual" | "comparison" | "quality";
  fileIds?: string[];
  format: "xlsx" | "csv" | "pdf";
  columns?: { key: string; header: string }[];
  filters?: ContactFilters;
  reportDate?: string;
  includeStatus?: boolean;
  timezoneLabel?: string;
}

export interface HistoryReport {
  id: string;
  type: string;
  format: string;
  filename: string;
  status: string;
  test: boolean;
  fileNames: string[];
  totalLeads: number | null;
  reportDate: string;
  processingMs: number | null;
  generationMs: number;
  generationStartedAt: string;
  generationCompletedAt: string;
  downloads: string[];
  fileAvailable: boolean;
}
