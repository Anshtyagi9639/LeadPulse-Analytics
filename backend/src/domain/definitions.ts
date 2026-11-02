/** Human-readable KPI/KPM definitions. Shown in the UI, exported to Excel/PDF, and mirrored in docs/KPI_DEFINITIONS.md. */
export interface KpiDefinition {
  key: string;
  name: string;
  category: 'Lead' | 'Marketing' | 'Sales' | 'Conversion' | 'Data quality';
  formula: string;
  notes: string;
}

export const KPI_DEFINITIONS: KpiDefinition[] = [
  { key: 'rawRows', name: 'Total raw rows', category: 'Lead', formula: 'Non-blank data rows in the processed lead files', notes: 'Includes rows later rejected. Blank rows are counted separately and never included.' },
  { key: 'totalLeads', name: 'Total leads (reported)', category: 'Lead', formula: 'Accepted rows in scope after the selected duplicate option is applied', notes: 'With "Count all rows as submitted" this equals the accepted row count. All lead-based rates use this as the cohort.' },
  { key: 'uniqueLeads', name: 'Unique leads', category: 'Lead', formula: 'Accepted rows in scope with confirmed duplicates collapsed', notes: 'Confirmed duplicates share a Lead ID, or a normalised phone/email without conflicting Lead IDs. Possible duplicates are still counted separately.' },
  { key: 'qualifiedLeads', name: 'Qualified / unqualified leads', category: 'Lead', formula: 'Rows whose Qualification Status (else Lead Quality, else Lead Status) explicitly says qualified / unqualified', notes: '"Pending", "New" and blank values are counted as pending, not as unqualified. A filled Unqualified Reason marks a lead unqualified.' },
  { key: 'qualificationRate', name: 'Qualification rate', category: 'Lead', formula: 'Qualified leads ÷ eligible leads × 100', notes: 'Eligible leads = leads with an assessed outcome (qualified + unqualified). Pending leads are excluded from the denominator.' },
  { key: 'duplicateRate', name: 'Duplicate rate', category: 'Data quality', formula: 'Duplicate rows ÷ total raw rows in scope × 100', notes: 'Duplicate rows = confirmed duplicate rows beyond the first in each group.' },
  { key: 'totalSpend', name: 'Total advertising spend', category: 'Marketing', formula: 'Sum of spend from ad-spend files and manually entered campaign spend for the reporting period', notes: 'Ad rows dated outside the reporting period are excluded. Undated ad rows are assumed to belong to the period (a note is shown).' },
  { key: 'cpl', name: 'CPL (cost per lead)', category: 'Marketing', formula: 'Attributable spend ÷ attributable leads', notes: 'Spend is attributed by matching campaign name (or source for source-level spend). Spend with no matching leads is excluded from CPL and reported as unattributed.' },
  { key: 'costPerQualified', name: 'Cost per qualified lead', category: 'Marketing', formula: 'Attributable spend ÷ qualified attributable leads', notes: '' },
  { key: 'targetAchievement', name: 'Target achievement', category: 'Marketing', formula: 'Actual leads ÷ target leads × 100', notes: 'Uses the session-level target when entered; otherwise the sum of campaign targets compared with leads from those campaigns.' },
  { key: 'budgetUtilisation', name: 'Budget utilisation', category: 'Marketing', formula: 'Spend ÷ budget × 100', notes: 'Only spend that has a budget entered is compared with that budget.' },
  { key: 'ctr', name: 'CTR', category: 'Marketing', formula: 'Clicks ÷ impressions × 100', notes: 'Available only when advertising data includes impressions and clicks.' },
  { key: 'cpc', name: 'CPC', category: 'Marketing', formula: 'Spend ÷ clicks', notes: '' },
  { key: 'cpm', name: 'CPM', category: 'Marketing', formula: 'Spend ÷ impressions × 1,000', notes: '' },
  { key: 'cplChange', name: 'CPL change vs baseline', category: 'Marketing', formula: '(CPL − baseline CPL) ÷ baseline CPL × 100', notes: 'The portal keeps no history; enter a baseline CPL per campaign to enable this.' },
  { key: 'assigned', name: 'Leads assigned', category: 'Sales', formula: 'Rows with an Assigned Counsellor or Assigned Date & Time', notes: '' },
  { key: 'contacted', name: 'Leads contacted', category: 'Sales', formula: 'Rows with a First Contact or Last Contact date, or a Lead Status indicating contact', notes: 'Statuses such as "Not contacted", "DNP", "Ringing", "Busy" are not counted as contacted.' },
  { key: 'contactRate', name: 'Contact rate', category: 'Sales', formula: 'Contacted assigned leads ÷ assigned leads × 100', notes: 'Counsellor-level contact rate uses the counsellor\'s leads as the denominator.' },
  { key: 'firstResponse', name: 'First-response time', category: 'Sales', formula: 'First Contact timestamp − Lead Created timestamp', notes: 'Computed only when both values include a time of day. Negative values are excluded and reported as a data-quality issue. Median and average are shown in minutes.' },
  { key: 'followUpsDue', name: 'Follow-ups due', category: 'Sales', formula: 'Rows whose Next Follow-up Date is on or before the end of the reporting period', notes: '"Due in period" counts only dates inside the period.' },
  { key: 'followUpsCompleted', name: 'Follow-ups completed', category: 'Sales', formula: 'Due follow-ups where Last Contact Date ≥ Next Follow-up Date (or Follow-up Outcome shows completion when Last Contact Date is not mapped)', notes: '' },
  { key: 'followUpsOverdue', name: 'Overdue follow-ups', category: 'Sales', formula: 'Due follow-ups dated before the end of the period that are not completed and not closed', notes: 'Closed = Lead Status lost/junk/not interested/enrolled, or a Lost Reason is filled.' },
  { key: 'followUpCompletion', name: 'Follow-up completion', category: 'Sales', formula: 'Completed follow-ups ÷ follow-ups due × 100', notes: '' },
  { key: 'counselling', name: 'Counselling booked / attended', category: 'Sales', formula: 'Counselling Status indicating booked/scheduled/attended; attended = attended/completed/held', notes: '' },
  { key: 'applications', name: 'Applications submitted', category: 'Conversion', formula: 'Rows with an Application Date, or Application Status submitted/applied/lodged', notes: 'Statuses such as "Not applied", "Pending", "Draft", "In progress" are not counted.' },
  { key: 'applicationRate', name: 'Application conversion', category: 'Conversion', formula: 'Applications ÷ reported leads × 100', notes: 'Cohort = the leads in this report (same file scope, period and duplicate option).' },
  { key: 'offers', name: 'Offers received', category: 'Conversion', formula: 'Offer Status indicating an offer was received/issued/accepted', notes: '' },
  { key: 'enrolments', name: 'Enrolments', category: 'Conversion', formula: 'Rows with an Enrolment Date, or Enrolment Status enrolled/confirmed/joined/paid', notes: '' },
  { key: 'enrolmentRate', name: 'Enrolment conversion', category: 'Conversion', formula: 'Enrolments ÷ reported leads × 100', notes: 'Same cohort as application conversion.' },
  { key: 'costPerApplication', name: 'Cost per application', category: 'Conversion', formula: 'Attributable spend ÷ applications from attributable leads', notes: '' },
  { key: 'costPerEnrolment', name: 'Cost per enrolment', category: 'Conversion', formula: 'Attributable spend ÷ enrolments from attributable leads', notes: '' },
  { key: 'missingFields', name: 'Missing phone / email / campaign / counsellor', category: 'Data quality', formula: 'Rows in scope with no value in the field', notes: 'Invalid phone/email values are counted separately from missing ones.' },
  { key: 'missingFollowUpDate', name: 'Missing follow-up dates', category: 'Data quality', formula: 'Open (not closed, not enrolled) rows without a Next Follow-up Date', notes: '' },
  { key: 'missingConversionStatus', name: 'Missing conversion status', category: 'Data quality', formula: 'Rows with no Application Status/Date and no Enrolment Status/Date', notes: '' },
  { key: 'invalidRecords', name: 'Invalid (rejected) records', category: 'Data quality', formula: 'Rows rejected during validation', notes: 'Lead rows are rejected only when they have no Lead ID, valid phone, valid email or name. Rows with invalid values are accepted with warnings.' },
  { key: 'conflictingRecords', name: 'Conflicting records', category: 'Data quality', formula: 'Rows in duplicate groups whose identifiers disagree', notes: 'E.g. the same Lead ID with different phone numbers, or different Lead IDs sharing one phone number.' },
  { key: 'recordStatus', name: 'Record status (lead table)', category: 'Data quality', formula: 'Valid = accepted and kept; Duplicate = later copy in a confirmed duplicate group; Possible duplicate = shares a phone/email with a different Lead ID (or name + city when enabled); Invalid = rejected row', notes: 'Rows are flagged, never deleted. The kept copy follows the duplicate option (first occurrence or latest activity).' },
  { key: 'validLeads', name: 'Valid leads', category: 'Data quality', formula: 'Accepted rows with confirmed duplicates collapsed (= unique leads)', notes: 'Possible duplicates are still counted until reviewed.' },
  { key: 'validationSuccessRate', name: 'Validation success rate', category: 'Data quality', formula: 'Accepted rows ÷ total data rows × 100', notes: 'Processing success vs failure: accepted vs rejected rows.' },
  { key: 'qualityScore', name: 'File quality score', category: 'Data quality', formula: '40% × accepted-record rate + 30% × rows with a valid phone or email + 20% × (1 − within-file duplicate rate) + 10% × rows with campaign attribution', notes: 'Used on the Compare Files page to rank files (0–100).' },
  { key: 'na', name: 'N/A values', category: 'Data quality', formula: '—', notes: 'A metric is shown as N/A when its source columns are not mapped or its denominator is zero. Values are never estimated.' },
];
