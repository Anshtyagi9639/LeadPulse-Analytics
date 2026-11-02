# Verification report

## Update — 2026-11-02: SalesMax Lead Contact Report

Reference workbook: `Lead_Contact_Report_24Oct2026 (1).xlsx` (Summary Report + Full Data, 99 leads × 16 columns,
81 formulas, 4 charts). It contains real lead data, so it was read in place and never copied into the repository;
verification scripts print aggregates only.

| Test | How | Result |
|---|---|---|
| 1 Reference report | `scripts/verify-reference.ts` — reference uploaded through the normal pipeline, every Summary figure compared | **All figures match**: 12 KPIs, 15 owner cells, 8 stage cells, 13 dispositions, 10 last-worked days, order of owners/stages, notes. All 16 columns auto-mapped. |
| 1b Evaluator check | Formula evaluator run on the reference's own 81 formulas | 81 / 81 equal Excel's cached values |
| 2 One file | API test on `08_salesmax_contact_export.xlsx` — KPIs vs an independent calculation from the workbook | Pass |
| 3 Multiple files | 08 + 09 + 10 combined; duplicates across files; comparison, individual reports + ZIP | Pass |
| 4 Different columns | `09_salesmax_team_b.csv` (Name/Owner/Stage/Follow Up Date…) mapped; missing CALLS TODAY → N/A | Pass |
| 5 Data quality | Invalid dates, empty rows, repeated phone, duplicate email, incomplete and invalid rows flagged, none dropped | Pass |
| 6 Graphs & filters | Owner + follow-up filter: KPIs = lead table count = downloaded Full Data rows; column selection & rename | Pass (API + browser) |
| 7 Reporting time | Upload / processing / generation start, end and duration stored per report, shown in History with download times | Pass |
| 8 File integrity | Generated files re-opened: sheets, headers, row counts, formats; every Summary formula recalculated from Full Data; charts parsed by openpyxl | Reference data: 87 formulas OK, 5 charts, Full Data 1,600 / 1,600 cells identical to the reference. Synthetic multi-file: all workbooks open with charts. |
| 9 Regression | Backend 138 / 138 tests, e2e 5 / 5, lint, type-check, builds; AI "Summarise today" with the configured key | Pass |

Defects found and fixed in this round: "Being Qualified" was counted as qualified (now pending, matching the reference);
LEAD STAGE / LEAD DISPOSITION shared one field; "NEXT FOLLOWUP" header not auto-mapped; Excel export escaped a
lead value starting with "-" (Excel text cells are now written exactly as uploaded; CSV keeps formula protection);
Processing Details did not list figures written as values when a column was excluded.

Not verified / limitations:
- The generated workbooks were **not opened in Microsoft Excel** (not installed here). They were checked with ExcelJS,
  an independent formula recalculation and openpyxl's schema-based parser (including charts). Please open one
  `Lead_Contact_Report_*.xlsx` in Excel once to confirm.
- Generated report files contain lead data, so they are kept only in the session (12 h) — re-download after that is
  limited to the processed summary. This follows the no-lead-database rule from the original brief.
- Excel recalculates formulas on open; a figure is written as a value (and listed) when its column is not exported.
- The e2e test servers now use ports 4180/3180 because 3100 is used by another local app.

---

## Update — 2026-11-02: multi-file testing, lead table, comparison, exports, history

| Check | Result |
|---|---|
| Backend unit + API tests (`npm test`) | **129 / 129 passed** (6 files; 11 new in `test/upgrade.test.ts`) |
| End-to-end (`npm run test:e2e`) | **4 / 4 passed** (3 existing + new `e2e/upgrade.spec.ts`) |
| Lint / type-check / production builds | **Clean** |
| AI "Summarise today" with the configured OpenAI key (`gpt-5-mini`) | **Passed** — structured answer in ~22 s using only the calculated figures |

Acceptance tests from the upgrade brief:

| Test | Verified by |
|---|---|
| A — one file → report | `upgrade.test.ts` Test A (every data row in the lead table, rejected rows kept as *Invalid*) |
| B — two files with overlapping leads | cross-file presence filters, overlap matrix, duplicates flagged not removed |
| C — three files, different columns / missing values / overlaps | comparison: field matrix, column differences, missing %, quality score; e2e uploads 01 + 02 + 07 |
| D — combined, individual and comparison reports | read-only previews per file vs combined; session report unchanged |
| E — filtered download matches the filtered table | API test and e2e (CSV row count = table count) |
| F — CSV/XLSX headers, counts, phones, dates, Unicode | leading zeros (`007100`), `+91 …` phones intact, Hindi/accents, quotes + commas round-trip, XLSX text cells |
| G — corrupted / empty / unsupported / repeated uploads / failed export | existing safety tests + `DUPLICATE_FILE`, replace-file, `NOTHING_TO_EXPORT` with retry in UI |
| H — backend restart | history entries survive (new app instance, same `CONFIG_DIR`); lead data does not; summary PDF/Excel still downloadable |
| I — AI Insights | live call above; mocked failure/timeout tests still pass |
| J — health, uploads and existing features | all original tests pass unchanged except two count/selector updates for the new KPI row |

Defects found and fixed during this round: "Ref No", "Applicant" and "Telecaller" headers were not auto-mapped;
the History page evaluated the timezone at build time; several ambiguous test selectors.

Design notes and limits for this round:
- **History persistence** stores metadata and the aggregate report snapshot only (`CONFIG_DIR/report-history.json`,
  30-day retention). Lead rows are never persisted, so lead-level tables/exports for past reports are available only
  while their session is alive; summaries can always be re-downloaded.
- **Isolation** is per browser (random `X-Client-Id`), not per user account — the portal has no login. Anyone using the
  same browser profile sees the same history.
- CSV exports start with a short information block (title, filters, KPIs) before the table, as required by the brief;
  tools that expect a bare header row should use the XLSX "Leads" sheet.
- Column resizing is drag-to-resize per session view and is not remembered.

---

## Original build — 2026-10-31

Date: 2026-10-31 · Environment: Windows 11, Node.js 20.20.0, npm 10.8.2, Chromium (Playwright 1.64.1).
All results below were executed locally. Nothing has been deployed.

## Summary

| Check | Command | Result |
|---|---|---|
| Backend unit + API tests | `npm test` | **118 / 118 passed** (5 files) |
| End-to-end (real browser, production builds) | `npm run test:e2e` | **3 / 3 passed** |
| Lint (backend + frontend) | `npm run lint` | **0 problems** |
| Type-check (backend + frontend) | `npm run typecheck` | **0 errors** |
| Production builds | `npm run build` | **Both succeed** (backend `tsc` → `dist/`; Next.js: 9 static routes) |
| Compiled backend smoke test | `node dist/index.js` + curl | Health, xls/xlsx upload via worker thread, process, PDF, Excel, delete: **all OK** |
| Visual check | Playwright screenshots (light, dark, 390 px mobile, mapping dialog), PDF render | Reviewed. Defects found were fixed (see below) |

## What the tests cover (spec §17)

| Requirement | Where verified |
|---|---|
| Single-file upload & processing an individual file | `api.test.ts` "processes a single file individually"; e2e step 3 |
| Multiple uploads in one session | `api.test.ts`; e2e step 1 (3 files at once) |
| Adding files after an initial report | `api.test.ts` "adds files later…"; e2e step 4 |
| Different worksheets and column names | Dubai file (title rows + 2nd sheet), ANZ file (different headers, text dates), XLS, CSV — auto-mapped in `api.test.ts` and `normalize.test.ts` |
| Missing optional fields → N/A | `kpi.test.ts` "missing data -> N/A"; partial-coverage notes |
| Missing required fields | `NO_IDENTIFIER` row rejection; `FILES_NOT_READY` when mapping lacks identity columns |
| Duplicate leads across files | `kpi.test.ts` duplicate detection; `api.test.ts` cross-file duplicates, conflicts, manual decisions; e2e step 7 |
| Corrupted / renamed / unsupported / empty files | `api.test.ts` upload-safety block; `spreadsheet.test.ts`; e2e test 2 |
| Archive bombs, oversize uploads, row limits, parse timeout | `spreadsheet.test.ts` (fake ZIP central directories), 413 test, truncation test, timeout test |
| Large files | 20,000-row workbook parsed + validated well under 20 s |
| Incorrect / ambiguous date formats | `normalize.test.ts` date suite; `INVALID_DATE`, `AMBIGUOUS_DATE_ORDER` |
| Empty files / empty worksheets | `EMPTY_FILE`; empty-sheet test |
| Recalculation after file removal | `api.test.ts`; e2e step 11 |
| Session expiry and cleanup | `api.test.ts` "Session expiry and cleanup" (sweep, 410, orphaned temp dirs) |
| Session clearing | `api.test.ts` (temp dir deleted, 404 after); e2e step 12 (confirm dialog, browser storage holds no lead data) |
| Concurrency | concurrent uploads + process serialised by the per-session mutex |
| KPI formulas | `kpi.test.ts`: CPL, cost/qualified, qualification/contact/duplicate rates, target, budget, CTR/CPC/CPM, conversions, follow-ups, response time, period handling, zero denominators |
| Excel / CSV / PDF exports | sheet names, no formulas, formula-injection escaping (incl. a `=CMD|…` and `+SUM(…)` sample row), PDF header/size; e2e downloads |
| Missing / invalid OpenAI key; timeout and failure | `ai.test.ts`: `AI_NOT_CONFIGURED`, `AI_TIMEOUT`, invalid output, auth/rate-limit/model error mapping, per-session & per-minute limits; real SDK call with an invalid key → `AI_AUTH_FAILED` |
| AI receives no PII | `ai.test.ts` asserts the prompt contains no emails, phones, student names, or counsellor names |
| Frontend & backend production builds | `npm run build`; e2e runs against `next start` + `node dist` |

Test data is synthetic only (`samples/`, generated by `npm run samples`: `example.com` emails and `90000xxxxx` phone numbers).

## Defects found during verification and fixed

1. Date cells in XLSX arrived as serial numbers in previews (SheetJS needs `cellNF: true`). Fixed; KPIs were already correct.
2. Rejected uploads for an unknown session produced a connection reset instead of a 404. The body is now drained first.
3. Filter popover **Apply** button did not apply filters (Radix doesn't fire `onOpenChange` for programmatic closes). Fixed; caught by e2e.
4. Toast notifications covered the toolbar's **Clear session** button. Moved to bottom-right; caught by e2e.
5. Build-time `new Date()` would have baked the build date into the default reporting date. Now computed in the browser.
6. PDF: wrapped column headers, `—` rendered as `?`, unformatted amounts in recommendations. Fixed.
7. Toolbar values truncated at 1440 px. Layout adjusted.

## Not verified / remaining limitations

- **AI insights with a real, valid OpenAI key were not exercised** (no key available). The integration is covered
  with a mocked client and one live call using an invalid key. Run one "Summarise today" after setting `OPENAI_API_KEY`.
- **Not deployed**; HTTPS, production CORS and host compatibility are documented in `DEPLOYMENT.md` but untested.
- Sessions are in-memory: a backend restart ends active sessions, and the backend must run as a single instance.
- Dates are timezone-naive (`Z`/offset suffixes ignored). PDF fonts are Latin-1 (non-Latin text shows as `?` in PDF only).
- Status keywords (qualified/contacted/applied/…) are rule-based; unusual CRM vocabularies appear as pending rather than guessed.
- Only Chromium was used for e2e; Firefox/Safari were not tested.
- `npm audit` reports a moderate `uuid` advisory via ExcelJS. ExcelJS only calls `uuid.v4()`, while the advisory affects
  `v3/v5/v6` with a caller-supplied buffer, so it is not reachable. Left unpatched rather than forcing a major-version override.
- Local note: another app on this machine already listens on port 3000; `npm run dev` here will then start Next.js on
  3001, so set `CORS_ORIGINS=http://localhost:3001` in `backend/.env` (or stop the other app).
