# LeadPulse — Daily Lead KPI & KPM Reporting Portal

Upload the day's lead exports (SalesMax CRM and other providers, `.xlsx` / `.xls` / `.csv`), map their columns,
handle duplicates across files, and download a daily KPI/KPM report as Excel, CSV and PDF. Optional AI insights use
the OpenAI API with aggregated, non-identifying statistics only.

**This is a temporary reporting tool, not a CRM.** There is no lead database. Uploaded files and parsed rows live in a
reporting session (server memory + a restricted temp directory) and are deleted when the user clears the session,
when it expires (default 12 hours), or when the server shuts down.

```
frontend/  Next.js 16 (App Router) + React 19 + TypeScript + Tailwind 4 + shadcn/ui + Recharts
backend/   Express 5 + TypeScript + SheetJS (read) + ExcelJS (write) + pdfkit + Zod + OpenAI SDK
samples/   Synthetic sample files (multi-file test set, SalesMax exports 08–10, blank templates)
docs/      KPI_DEFINITIONS.md, DEPLOYMENT.md, VERIFICATION.md
e2e/       Playwright end-to-end tests
```

## Quick start (local)

Requirements: Node.js ≥ 20.9 and npm 10.

```bash
npm install                          # installs both workspaces
cp backend/.env.example backend/.env # optional; defaults work locally
cp frontend/.env.example frontend/.env.local
npm run dev                          # backend http://localhost:4000, frontend http://localhost:3000
```

Or run them separately: `npm run dev -w backend` and `npm run dev -w frontend`.

Open http://localhost:3000, pick the reporting date, and drop the files from `samples/` (use reporting date
**2026-10-30** for the samples).

### Production build

```bash
npm run build                        # backend (tsc → backend/dist) and frontend (next build)
npm run start                        # node backend/dist/index.js + next start
```

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Backend (tsx watch) + frontend (next dev) |
| `npm run build` / `npm run start` | Production build / start of both apps |
| `npm test` | Backend unit + API tests (Vitest + Supertest) |
| `npm run test:e2e` | Builds both apps, then runs Playwright against ports 4100/3100 |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript for both apps |
| `npm run samples` | Regenerates the synthetic sample files |

## Environment variables

Backend (`backend/.env`, all optional locally — see `backend/.env.example` for the full list):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | API port |
| `CORS_ORIGINS` | `http://localhost:3000` | Allowed frontend origin(s), comma-separated |
| `SESSION_TTL_HOURS` | `12` | Session expiry; temp data deleted afterwards |
| `TEMP_DIR` | OS temp `/leadpulse-sessions` | Restricted upload directory (never web-served) |
| `MAX_FILE_SIZE_MB` / `MAX_FILES_PER_SESSION` / `MAX_ROWS_PER_SHEET` | `15` / `20` / `50000` | Upload limits |
| `OPENAI_API_KEY` | — | Enables AI insights. Server-side only. |
| `OPENAI_MODEL` | `gpt-5-mini` | Model used for insights |

Frontend: `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`), baked in at build time.

## Workflow

1. **Upload & Files** — choose the reporting date (or explicitly switch to a custom range), drop one or more files.
   Each file is parsed in a sandboxed worker, its lead worksheet and header row are detected, columns are mapped
   automatically (or from a saved template), and every row is validated. Fix mappings with **Map columns**.
2. **Process** a single file, the selected files, or all files. Add or remove files at any time; removing a file
   recalculates immediately, adding one marks the report as needing reprocessing.
3. **Duplicates** — choose how duplicates are counted and review groups (Lead ID → phone → email; names never merge).
4. **Data Quality** — rejected rows, warnings, missing fields, unmapped columns; download the validation-error CSV.
5. **Spend & Targets** — enter spend/budget/targets per campaign (or upload an ad-spend export).
6. **Dashboard** — executive overview, campaigns, sources, sales/counsellors, funnel, country/course/level.
7. **AI Insights** (optional) — summaries, CPL outliers, data-quality notes, EOD draft, questions.
8. **Download Reports** — Excel workbook (9 sheets), CSV per table, PDF management report.
9. **Clear session** — deletes all temporary data on the server.

## Multi-file testing, lead table and history

- **Compare Files** — side-by-side results per file (records, valid, duplicates, invalid, contact completeness,
  quality score, failures, processing time), matching leads between files, field-mapping and column differences, and a
  read-only **testing mode** that previews the report per file and combined without changing the main report.
- **Lead Table** — every uploaded row (valid, duplicate, possible duplicate, invalid) with search, sorting, paging,
  filters (file, date, source, campaign, lead status, data quality, found-in-other-files), column visibility, resizable
  columns, row details (cleaned vs original values), row selection and export of filtered or selected rows.
  Combined or file-by-file view. Dashboard charts click through to the matching rows.
- **Reports & Downloads** — combined, per-file, comparison and data-quality reports; valid / duplicates / invalid only;
  date range; column selection; cleaned and/or original values; CSV or XLSX. Filenames such as
  `combined_lead_report_2026-10-30.xlsx`, `file_comparison_report_2026-10-30.xlsx`, `lead_data_quality_report_2026-10-30.xlsx`.
- **Report History** — survives restarts; keeps summaries only (see Data protection). Reopen a live session or
  re-download its summary PDF/Excel.
- **Audit trail** — uploads, mappings, replacements, settings, duplicate decisions and exports (no lead values),
  included in the data-quality export.

New API endpoints: `GET /api/sessions/:id/leads`, `/comparison`, `/report/preview`, `/audit`,
`POST /api/sessions/:id/export/leads`, `GET /api/sessions/:id/export/comparison`, `/export/quality`,
`POST /api/sessions/:id/files?replace=<fileId>`, `GET|DELETE /api/history`, `GET /api/history/:id/export/pdf|excel`.

## Lead Contact Report (SalesMax)

The **Contact Report** page recreates the SalesMax `Lead_Contact_Report` workbook from any uploaded SalesMax-style
exports (column names are mapped automatically to the 16-column schema; missing columns show N/A).

- KPIs, owner performance, stages, follow-up analysis, dispositions and "last worked per day", with filters for file,
  report date, owner, stage, disposition and follow-up status. Charts and tables update together; clicks filter.
- **Generate report** — A individual file reports (+ ZIP), B combined report (`Lead_Contact_Report_YYYY-MM-DD.xlsx` /
  `Combined_Lead_Report_YYYY-MM-DD.xlsx`), C file comparison (`Lead_File_Comparison_YYYY-MM-DD.xlsx`), data quality.
  Excel, CSV or PDF; choose, exclude and rename columns; **Preview report** before generating.
- Excel output: *Summary Report* (live formulas, yellow report-date cell, 5 native charts), *Full Data* (original
  values and formats), *Duplicate Leads*, *Invalid or Incomplete Leads*, *File Comparison*, *Processing Details*.
- Every report records upload, processing and generation start/end times and durations; files stay downloadable for
  the session and appear in **Report History**.
- **Testing mode** (switch on the Upload page before the first file): reports are labelled TEST and the session can be
  reset from the toolbar.

Verification against your own reference workbook (prints aggregates only, never lead data):

```bash
cd backend
npx tsx scripts/verify-reference.ts "path/to/Lead_Contact_Report_24Oct2026.xlsx"     # Test 1: figures vs reference
npx tsx scripts/verify-export.ts out-folder 2026-10-24 "path/to/Lead_Contact_Report_24Oct2026.xlsx"  # Test 8: export
```

## Data protection

- No lead database; no lead data in logs, analytics, browser storage or permanent files. The browser stores only the
  opaque session id in `sessionStorage`.
- Phone/email values are masked in validation reports and duplicate review; logs record ids, counts and timings only.
- Only column-mapping templates (header names → field keys) and report history (metadata + aggregate KPIs, never lead
  rows; `HISTORY_RETENTION_DAYS`, default 30) are persisted, in `CONFIG_DIR`.
- Each browser sends a random `X-Client-Id`; sessions and history are visible only to the browser that created them.
- AI requests contain aggregated statistics only (no names, phones, emails or rows); counsellor names are
  pseudonymised by default.
- Upload hardening: extension + magic-byte checks, ZIP-bomb inspection before parsing, worker thread with memory and
  time limits, row/column caps, formulas never evaluated, formula-injection escaping in all exports, rate limits,
  Helmet headers, strict CORS, Zod-validated inputs.

More: [KPI definitions](docs/KPI_DEFINITIONS.md) · [Deployment](docs/DEPLOYMENT.md) · [Verification report](docs/VERIFICATION.md)
