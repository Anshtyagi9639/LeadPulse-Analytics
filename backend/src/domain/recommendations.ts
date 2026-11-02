import type { Report } from './kpi.js';

/**
 * Deterministic, rule-based recommendations derived only from the calculated report.
 * Used in the PDF and dashboard; independent of the optional AI insights.
 */
export interface Recommendation {
  area: 'Marketing' | 'Sales' | 'Data quality';
  finding: string;
  action: string;
}

const money = (currency: string, v: number) => `${currency} ${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export function buildRecommendations(r: Report): Recommendation[] {
  const out: Recommendation[] = [];
  const d = r.dataQuality;
  const leads = r.counts.reportedLeads;

  if (d.duplicateRate !== null && d.duplicateRate >= 5) {
    out.push({ area: 'Data quality', finding: `Duplicate rate is ${d.duplicateRate}% (${r.counts.duplicateRows} rows).`, action: 'Check whether the same leads are being exported from several sources or forms, and de-duplicate at capture.' });
  }
  if (leads && d.missingCampaign / leads >= 0.1) {
    out.push({ area: 'Data quality', finding: `${d.missingCampaign} of ${leads} leads (${Math.round((d.missingCampaign / leads) * 100)}%) have no campaign attribution.`, action: 'Ensure UTM parameters / campaign names are passed into the CRM for every lead form.' });
  }
  if (r.counts.rejectedRows > 0) {
    out.push({ area: 'Data quality', finding: `${r.counts.rejectedRows} row(s) were rejected during validation.`, action: 'Download the validation-error report and correct the source rows.' });
  }
  if (leads && r.sales.assigned !== null && r.sales.assigned < leads) {
    const un = leads - r.sales.assigned;
    if (un / leads >= 0.05) out.push({ area: 'Sales', finding: `${un} lead(s) are not assigned to a counsellor.`, action: 'Assign the remaining leads so that first contact can happen promptly.' });
  }
  if (r.sales.contactRate !== null && r.sales.contactRate < 70) {
    out.push({ area: 'Sales', finding: `Contact rate is ${r.sales.contactRate}% of assigned leads.`, action: 'Prioritise first calls for uncontacted leads and review counsellor workloads.' });
  }
  if (r.sales.firstResponse?.medianMinutes !== null && r.sales.firstResponse?.medianMinutes !== undefined && r.sales.firstResponse.medianMinutes > 60) {
    out.push({ area: 'Sales', finding: `Median first-response time is ${r.sales.firstResponse.medianMinutes} minutes.`, action: 'Aim for first contact within one hour of lead creation.' });
  }
  if (r.sales.followUpsOverdue) {
    out.push({ area: 'Sales', finding: `${r.sales.followUpsOverdue} follow-up(s) are overdue.`, action: 'Clear overdue follow-ups before taking on new leads; reschedule where appropriate.' });
  }
  const withCpl = r.campaigns.filter((c) => c.cpl !== null && c.leads >= 3);
  if (r.marketing.cpl !== null && withCpl.length >= 2) {
    for (const c of withCpl.filter((x) => x.cpl! >= r.marketing.cpl! * 1.5).slice(0, 3)) {
      out.push({ area: 'Marketing', finding: `${c.label} CPL (${money(r.currency, c.cpl!)}) is ${Math.round((c.cpl! / r.marketing.cpl!) * 100) - 100}% above the overall CPL.`, action: 'Review targeting, creative and lead-form quality for this campaign before increasing budget.' });
    }
  }
  for (const c of r.campaigns.filter((x) => x.spend && x.leads === 0).slice(0, 3)) {
    out.push({ area: 'Marketing', finding: `${c.label} has spend (${money(r.currency, c.spend!)}) but no matching leads in this report.`, action: 'Check the campaign name matches between the ad platform and the CRM, or whether leads are missing from the export.' });
  }
  for (const c of r.campaigns.filter((x) => x.cplChange !== null && Math.abs(x.cplChange) >= 25).slice(0, 3)) {
    out.push({ area: 'Marketing', finding: `${c.label} CPL changed ${c.cplChange! > 0 ? '+' : ''}${c.cplChange}% against the entered baseline.`, action: c.cplChange! > 0 ? 'Investigate the cost increase (audience fatigue, bid changes, form issues).' : 'Consider whether this efficiency can be scaled.' });
  }
  const lowQual = r.campaigns.filter((x) => x.qualificationRate !== null && x.leads >= 5 && x.qualificationRate < 20).slice(0, 3);
  for (const c of lowQual) {
    out.push({ area: 'Marketing', finding: `${c.label} qualification rate is ${c.qualificationRate}%.`, action: 'Tighten audience or form questions to improve lead quality.' });
  }
  if (r.overview.targetAchievement !== null && r.overview.targetAchievement < 80) {
    out.push({ area: 'Marketing', finding: `Lead target achievement is ${r.overview.targetAchievement}%.`, action: 'Review pacing and budget allocation for under-delivering campaigns.' });
  }
  return out;
}
