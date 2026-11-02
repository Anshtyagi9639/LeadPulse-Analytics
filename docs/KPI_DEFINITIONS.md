# KPI & KPM definitions

All figures are calculated on the backend (`backend/src/domain/kpi.ts`) and covered by unit tests in
`backend/test/kpi.test.ts`. The same definitions appear in the portal (**KPI Definitions** page), the Excel
workbook (**KPI Definitions** sheet) and the PDF (**Calculation notes**). The source of truth is
`backend/src/domain/definitions.ts`.

## General rules

- **N/A instead of guesses.** A metric is `null` / "N/A" when the columns it needs are not mapped in any processed
  file, or its denominator is zero. The report lists the reason under `unavailable`.
- **Partial coverage is disclosed.** If a field is mapped in some files but not others, the metric covers only those
  rows and a calculation note says so (e.g. "Enrolment is mapped for only 51% of report rows").
- **Rows vs unique leads.** *Total leads* counts rows after the selected duplicate option. *Unique leads* always
  collapses confirmed duplicates. Both are always shown.
- **Cohort.** Lead-based rates use the *reported leads* in the current scope (processed files, reporting period,
  filters and duplicate option).
- **Periods are never mixed silently.** Lead rows created outside the reporting date/range are flagged (or excluded,
  if "Reporting period only" is selected). Ad-spend rows dated outside the period are always excluded from spend.
  Undated ad rows are assumed to belong to the period and a note is shown.
- Percentages are rounded to 2 decimal places; money to 2 decimal places.

## Lead KPIs

| KPI | Formula | Notes |
|---|---|---|
| Total raw rows | Non-blank data rows in processed lead files | Includes rows later rejected. Blank rows are counted separately. |
| Total leads (reported) | Accepted, in-scope rows after the duplicate option | |
| Unique leads | In-scope rows with confirmed duplicates collapsed | |
| Leads by file / campaign / source / medium / country / course / study level | Row counts per value | Campaign = Campaign Name, else UTM Campaign. Sources are canonicalised (Facebook/Instagram/Meta → *Meta Ads*; Google/AdWords → *Google Ads*; etc.). Unknown sources keep their own label. |
| Qualified / unqualified | Qualification Status, else Lead Quality, else Lead Status, explicitly saying qualified / unqualified | "Pending", "New", blank → pending. A filled Unqualified Reason → unqualified. |
| Qualification rate | qualified ÷ (qualified + unqualified) × 100 | Eligible = leads with an assessed outcome. |
| Invalid records | Rows rejected in validation | Lead rows are rejected only when they have no Lead ID, valid phone, valid email or name. |
| Duplicate rate | duplicate rows ÷ total in-scope rows × 100 | Duplicate rows = rows beyond the first in each confirmed group. |

## Marketing KPIs

| KPI | Formula | Notes |
|---|---|---|
| Total ad spend | Σ spend from ad-spend files + manual campaign entries in the period | |
| Attributable spend | Spend whose campaign (or, for source-level entries, source) has leads in the report | Unmatched spend is reported separately as *unattributed*. |
| CPL | attributable spend ÷ attributable leads | Attributable leads = leads in campaigns/sources that have spend. |
| Cost per qualified lead | attributable spend ÷ qualified attributable leads | |
| Target achievement | actual leads ÷ target leads × 100 | Session target if entered, else Σ campaign targets vs leads of those campaigns. |
| Budget utilisation | spend ÷ budget × 100 | Only spend that has a budget is compared. |
| CTR | clicks ÷ impressions × 100 | Only when advertising data includes them. |
| CPC | spend ÷ clicks | |
| CPM | spend ÷ impressions × 1,000 | |
| CPL change | (CPL − baseline CPL) ÷ baseline CPL × 100 | No history is stored; the baseline is entered by the user. |

## Sales KPIs

| KPI | Formula | Notes |
|---|---|---|
| Leads assigned | rows with Assigned Counsellor or Assigned Date & Time | |
| Leads contacted | First Contact or Last Contact date present, or a Lead Status indicating contact | "Not contacted", "DNP", "Ringing", "Busy", "New" are not contact. |
| Contact rate | contacted assigned leads ÷ assigned leads × 100 | Per counsellor: contacted ÷ that counsellor's leads. |
| First-response time | First Contact timestamp − Lead Created timestamp | Only when both include a time of day. Negative values are excluded and counted as a data-quality issue. Median, average and % within 1 hour are reported. |
| Follow-ups due | Next Follow-up Date ≤ end of period | "Due in period" = date inside the period. |
| Follow-ups completed | due and Last Contact Date ≥ Next Follow-up Date (or a completed Follow-up Outcome when Last Contact Date is not mapped) | |
| Overdue follow-ups | due before the end of the period, not completed, lead not closed | Closed = lost / junk / not interested / unqualified / enrolled status, or a Lost Reason. |
| Follow-up completion | completed ÷ due × 100 | |
| Counselling booked / attended | Counselling Status booked/scheduled/attended; attended = attended/completed/held | |

## Conversion KPIs

| KPI | Formula | Notes |
|---|---|---|
| Applications submitted | Application Date present, or Application Status submitted/applied/lodged | "Not applied", "Pending", "Draft", "In progress" do not count. |
| Application conversion | applications ÷ reported leads × 100 | |
| Offers received | Offer Status offer/received/conditional/unconditional/accepted | "Offer pending", "Rejected" do not count. |
| Enrolments | Enrolment Date present, or Enrolment Status enrolled/confirmed/joined/paid | |
| Enrolment conversion | enrolments ÷ reported leads × 100 | |
| Revenue | Σ Revenue / Fee Value | |
| Cost per application / enrolment | attributable spend ÷ applications (enrolments) from attributable leads | |

## Data-quality KPMs

Missing phone, invalid phone, missing email, invalid email, missing campaign attribution, missing source, missing
counsellor assignment, missing follow-up date (open leads only), missing lead status, missing conversion status
(no application/enrolment status or date), missing lead-created date, negative response times, conflicting records,
rows without Lead ID, rows without any identifier, unmapped columns per file, rejected rows and rows with warnings.

## Duplicate detection

1. Rows with the same external **Lead ID** (case-insensitive) are the same lead.
2. Groups are then linked by **normalised phone** (digits only; `+91`/`0` prefixes removed) and **normalised email**
   (lower-case).
3. If a linked cluster contains **different Lead IDs**, it is a *possible* duplicate (conflict) and is never merged
   automatically. Same-ID rows inside it are still confirmed duplicates.
4. Same Lead ID with different phones/emails is a confirmed duplicate flagged as *conflicting*.
5. **Name alone never merges.** Optional *cautious matching* flags identical name + city as *possible* only.

Duplicate options: *Count all rows as submitted*, *Exclude confirmed duplicates* (keep first occurrence by upload
order), *Keep latest record* (most recent activity date), *Review manually* (per-group decision; undecided groups
count all rows). Options apply to the temporary working dataset only; source files are never modified.

## Lead Contact Report (SalesMax)

Reproduces the `Summary Report` sheet of the SalesMax reference workbook (`Lead_Contact_Report_24Oct2026.xlsx`).
One implementation (`backend/src/domain/contact-report.ts`) feeds the Contact Report page, the Excel/CSV/PDF exports
and the tests. In the Excel export every figure is a live formula on the `Full Data` sheet (verified before it is
written); a figure whose source column was not exported is written as a verified value and listed in Processing Details.

| Metric | Rule (reference formula) | Blank / missing handling |
|---|---|---|
| Total leads | Leads in the report (`COUNTA(LEAD NAME)`) | Rows without a name are still counted if they have a phone/email/Lead ID |
| Leads not yet worked | AWAITING FIRST TOUCH = `NOT_WORKED` | Blank = worked/unknown |
| Leads worked at least once | Leads whose ATTEMPTS is a number (`COUNT(ATTEMPTS)`) | Blank or text attempts are not counted |
| Qualified leads | LEAD STAGE = `Qualified Lead` (any explicit "qualified" value) | "Being Qualified", "To be qualified" are **not** qualified |
| Qualification rate | Qualified ÷ total leads | N/A when there are no leads |
| Total attempts / calls / calls today | `SUM` of ATTEMPTS / TOTAL CALLS / CALLS TODAY | Blanks count as 0 |
| Leads marked INTERESTED | LEAD DISPOSITION = `INTERESTED` | |
| Overdue follow-ups | NEXT FOLLOWUP **before** 00:00 of the report date | |
| Follow-ups on/after report date | NEXT FOLLOWUP on or after 00:00 of the report date | |
| Leads with no follow-up date | Total − overdue − on/after | Blank or unreadable dates (flagged as `INVALID_DATE`) |
| Performance by Lead Owner | Per LEAD OWNER: leads, not worked, qualified, total calls, calls today | Blank owner → "(No owner)" |
| Leads by Stage / Disposition | Count and % of total leads per value | Blank disposition → "(No disposition recorded)" |
| Leads last worked per day | Count per calendar day of LAST WORKED | |

Report date: the session's reporting date (or the end of a custom range); it can be changed on the Contact Report page,
and in the Excel export it is the yellow input cell `B3`. A column that is not in any uploaded file makes its metrics
**N/A** — values are never invented. Duplicates across files are handled by the session's duplicate option before
counting (default: confirmed duplicates by Lead ID / phone / email are counted once).
