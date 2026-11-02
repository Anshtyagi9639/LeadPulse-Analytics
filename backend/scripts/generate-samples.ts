/**
 * Generates SYNTHETIC sample files for testing multi-file uploads. No real personal data:
 * names are drawn from a small fictional list, emails use the reserved example.com domain and
 * phone numbers come from a synthetic 90000xxxxx range.
 *
 * Usage: npm run samples [-- <outputDir> <reportingDate>]
 */
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { LEAD_FIELDS } from '../src/domain/fields.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(process.argv[2] ?? path.join(here, '..', '..', 'samples'));
const REPORT_DATE = process.argv[3] ?? '2026-10-30';
fs.mkdirSync(outDir, { recursive: true });

// Seeded PRNG so samples (and the tests that use them) are reproducible.
let seed = 20261030;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
const chance = (p: number) => rand() < p;

const FIRST = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Ananya', 'Vihaan', 'Isha', 'Arjun', 'Sara', 'Dev', 'Nisha', 'Kunal', 'Tara', 'Yash', 'Riya', 'Neel', 'Zoya', 'Om', 'Pia'];
const LAST = ['Testwala', 'Samplekar', 'Demoji', 'Fictiona', 'Mockerjee', 'Dummyram', 'Placeholderan', 'Synthetica'];
const CITIES = ['Delhi', 'Mumbai', 'Pune', 'Jaipur', 'Lucknow', 'Chandigarh', 'Ahmedabad', 'Kochi'];
const STATES: Record<string, string> = { Delhi: 'Delhi', Mumbai: 'Maharashtra', Pune: 'Maharashtra', Jaipur: 'Rajasthan', Lucknow: 'Uttar Pradesh', Chandigarh: 'Chandigarh', Ahmedabad: 'Gujarat', Kochi: 'Kerala' };
const COUNSELLORS = ['Priya Counsellor', 'Rahul Advisor', 'Sneha Mentor', 'Vikram Guide'];
const STATUSES = ['New', 'Contacted', 'Interested', 'Follow Up', 'Not Interested', 'DNP', 'Counselling Done', 'Applied'];
const QUAL = ['Qualified', 'Unqualified', 'Pending', 'Qualified', 'Qualified'];

let phoneSeq = 9000010000;
let leadSeq = 50000;
const usedPeople: { phone: string; email: string; name: string; city: string }[] = [];

function person(reuse = 0) {
  if (reuse && usedPeople.length && chance(reuse)) return pick(usedPeople);
  const first = pick(FIRST);
  const last = pick(LAST);
  const p = { name: `${first} ${last}`, phone: String(phoneSeq++), email: `${first}.${last}.${leadSeq}@example.com`.toLowerCase(), city: pick(CITIES) };
  usedPeople.push(p);
  return p;
}

const pad = (n: number) => String(n).padStart(2, '0');
function at(dayOffset: number, hour: number, minute: number): Date {
  const [y, m, d] = REPORT_DATE.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + dayOffset, hour, minute));
}
const dmy = (dt: Date, withTime = true) => `${pad(dt.getUTCDate())}/${pad(dt.getUTCMonth() + 1)}/${dt.getUTCFullYear()}${withTime ? ` ${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}` : ''}`;
const iso = (dt: Date) => `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())} ${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}`;
const addMin = (dt: Date, m: number) => new Date(dt.getTime() + m * 60000);

interface Lead {
  leadId: string;
  name: string;
  phone: string;
  email: string;
  city: string;
  state: string;
  qualification: string;
  studyLevel: string;
  course: string;
  country: string;
  intakeYear: string;
  intakeSeason: string;
  ielts: string;
  source: string;
  medium: string;
  campaign: string;
  adSet: string;
  created: Date;
  counsellor: string;
  assigned: Date | null;
  firstContact: Date | null;
  status: string;
  quality: string;
  qualStatus: string;
  lastContact: Date | null;
  nextFollowUp: Date | null;
  counselling: string;
  application: string;
  offer: string;
  enrolment: string;
  revenue: number | null;
}

function makeLead(opts: { campaign: string; source: string; medium: string; country: string; course: string; studyLevel: string; reuse?: number; dayOffset?: number }): Lead {
  const p = person(opts.reuse ?? 0);
  const created = at(opts.dayOffset ?? 0, 8 + Math.floor(rand() * 11), Math.floor(rand() * 60));
  const assigned = chance(0.9) ? addMin(created, 5 + Math.floor(rand() * 30)) : null;
  const contacted = assigned && chance(0.75);
  const firstContact = contacted ? addMin(created, 10 + Math.floor(rand() * 240)) : null;
  const qualStatus = contacted ? pick(QUAL) : 'Pending';
  const status = contacted ? pick(STATUSES.slice(1)) : pick(['New', 'DNP', 'Ringing']);
  const applied = qualStatus === 'Qualified' && chance(0.25);
  const enrolled = applied && chance(0.3);
  leadSeq++;
  return {
    leadId: `SMX-${leadSeq}`,
    name: p.name,
    phone: p.phone,
    email: p.email,
    city: p.city,
    state: STATES[p.city],
    qualification: pick(['12th', 'B.Com', 'B.Tech', 'BBA', 'B.Sc', 'MBA']),
    studyLevel: opts.studyLevel,
    course: opts.course,
    country: opts.country,
    intakeYear: pick(['2027', '2027', '2028']),
    intakeSeason: pick(['January', 'May', 'September']),
    ielts: pick(['Not Taken', 'Booked', '6.5', '7.0', 'Preparing']),
    source: opts.source,
    medium: opts.medium,
    campaign: opts.campaign,
    adSet: `${opts.campaign} - ${pick(['Lookalike', 'Interest', 'Retargeting'])}`,
    created,
    counsellor: assigned ? pick(COUNSELLORS) : '',
    assigned,
    firstContact,
    status,
    quality: pick(['Hot', 'Warm', 'Cold']),
    qualStatus,
    lastContact: firstContact ? addMin(firstContact, Math.floor(rand() * 300)) : null,
    nextFollowUp: contacted && !['Not Interested'].includes(status) ? at(Math.floor(rand() * 4) - 2, 11, 0) : null,
    counselling: qualStatus === 'Qualified' ? pick(['Booked', 'Attended', 'Not Booked']) : '',
    application: applied ? 'Submitted' : qualStatus === 'Qualified' ? pick(['Not Applied', 'In Progress']) : '',
    offer: applied && chance(0.4) ? 'Conditional Offer' : '',
    enrolment: enrolled ? 'Enrolled' : '',
    revenue: enrolled ? 25000 + Math.floor(rand() * 4) * 5000 : null,
  };
}

// ---------------------------------------------------------------------------------------------
// File 1: Study Abroad Dubai — SalesMax-style export with title rows and a second sheet.
// ---------------------------------------------------------------------------------------------
async function dubai() {
  const leads: Lead[] = [];
  for (let i = 0; i < 60; i++) leads.push(makeLead({ campaign: 'SA Dubai Oct Lead Gen', source: 'Facebook', medium: 'Paid Social', country: 'UAE', course: pick(['BBA', 'MBA', 'Computer Science']), studyLevel: pick(['UG', 'PG']) }));
  for (let i = 0; i < 25; i++) leads.push(makeLead({ campaign: 'SA Dubai Search', source: 'Google Ads', medium: 'CPC', country: 'UAE', course: 'MBA', studyLevel: 'PG' }));
  for (let i = 0; i < 4; i++) leads.push(makeLead({ campaign: 'SA Dubai Oct Lead Gen', source: 'Facebook', medium: 'Paid Social', country: 'UAE', course: 'BBA', studyLevel: 'UG', dayOffset: -1 }));
  // Exact duplicate rows (same Lead ID) re-exported.
  leads.push({ ...leads[3] }, { ...leads[7] });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Leads Export');
  ws.addRow(['SalesMax CRM — Lead Export']);
  ws.addRow([`Generated: ${REPORT_DATE} 19:00 (synthetic sample data)`]);
  ws.addRow([]);
  const headers = ['Lead ID', 'Name', 'Mobile Number', 'Email', 'Qualification', 'City', 'State', 'Study Level', 'Preferred Course', 'Preferred Country', 'Intake Year', 'Intake Season', 'IELTS Status', 'Source', 'Medium', 'Campaign Name', 'Ad Set Name', 'Lead Created Date', 'Assigned Counsellor', 'Assigned Date & Time', 'First Contact Date & Time', 'Lead Status', 'Lead Quality', 'Qualification Status', 'Last Contact Date', 'Next Follow-up Date', 'Counselling Status', 'Application Status', 'Offer Status', 'Enrolment Status', 'Fee Value', 'Internal Notes'];
  ws.addRow(headers).font = { bold: true };
  for (const l of leads) {
    ws.addRow([l.leadId, l.name, Number(l.phone), l.email, l.qualification, l.city, l.state, l.studyLevel, l.course, l.country, l.intakeYear, l.intakeSeason, l.ielts, l.source, l.medium, l.campaign, l.adSet, l.created, l.counsellor, l.assigned, l.firstContact, l.status, l.quality, l.qualStatus, l.lastContact, l.nextFollowUp, l.counselling, l.application, l.offer, l.enrolment, l.revenue, chance(0.1) ? '=HYPERLINK("http://example.com","click")' : '']);
  }
  for (const col of [18, 20, 21, 25, 26]) ws.getColumn(col).numFmt = 'dd-mm-yyyy hh:mm';
  const summary = wb.addWorksheet('Summary');
  summary.addRow(['This sheet is not lead data.']);
  summary.addRow(['Total', leads.length]);
  await wb.xlsx.writeFile(path.join(outDir, '01_study-abroad-dubai_leads.xlsx'));
  return leads;
}

// ---------------------------------------------------------------------------------------------
// File 2: Australia & NZ — different column names, text dates in DD/MM/YYYY.
// ---------------------------------------------------------------------------------------------
async function ausNz() {
  const leads: Lead[] = [];
  for (let i = 0; i < 45; i++) leads.push(makeLead({ campaign: 'ANZ Masters Intake 2027', source: 'Meta', medium: 'Lead Form', country: pick(['Australia', 'New Zealand']), course: pick(['Data Science', 'Nursing', 'MBA']), studyLevel: 'PG', reuse: 0.08 }));
  for (let i = 0; i < 15; i++) leads.push(makeLead({ campaign: 'ANZ Referral Drive', source: 'Referral', medium: 'Offline', country: 'Australia', course: 'Nursing', studyLevel: 'UG' }));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ANZ');
  ws.addRow(['Enquiry No', 'Student Name', 'Contact No', 'Email ID', 'Destination', 'Course Interested', 'Level', 'Lead Source', 'Campaign', 'Created On', 'Counselor', 'Status', 'Qualified?', 'Next Follow Up', 'Last Contacted On', 'App Status', 'Remarks']).font = { bold: true };
  for (const l of leads) {
    ws.addRow([l.leadId.replace('SMX', 'ENQ'), l.name, `+91 ${l.phone.slice(0, 5)} ${l.phone.slice(5)}`, chance(0.05) ? l.email.replace('@', ' at ') : l.email, l.country, l.course, l.studyLevel, l.source, l.campaign, dmy(l.created), l.counsellor, l.status, l.qualStatus === 'Qualified' ? 'Yes' : l.qualStatus === 'Unqualified' ? 'No' : '', l.nextFollowUp ? dmy(l.nextFollowUp, false) : '', l.lastContact ? dmy(l.lastContact, false) : '', l.application, '']);
  }
  await wb.xlsx.writeFile(path.join(outDir, '02_australia-nz_leads.xlsx'));
  return leads;
}

// ---------------------------------------------------------------------------------------------
// File 3: IELTS — CSV with blank rows, invalid emails/phones and a formula-injection attempt.
// ---------------------------------------------------------------------------------------------
function ielts() {
  const rows: string[][] = [['Lead ID', 'Full Name', 'Phone', 'E-mail', 'City', 'Source', 'UTM Campaign', 'Lead Date', 'Owner', 'Lead Status', 'Qualification Status', 'First Contact']];
  for (let i = 0; i < 40; i++) {
    const l = makeLead({ campaign: 'IELTS Weekend Batch', source: pick(['Google', 'Collegedunia', 'Organic']), medium: 'CPC', country: '', course: 'IELTS', studyLevel: 'Test Prep', reuse: 0.1 });
    rows.push([l.leadId, l.name, chance(0.05) ? '12345' : `0${l.phone}`, chance(0.05) ? 'not-an-email' : l.email, l.city, l.source, l.campaign, iso(l.created), l.counsellor, l.status, l.qualStatus, l.firstContact ? iso(l.firstContact) : '']);
    if (i % 13 === 0) rows.push(['', '', '', '', '', '', '', '', '', '', '', '']);
  }
  rows.push(['', '', '', '', 'Pune', 'Organic', 'IELTS Weekend Batch', iso(at(0, 10, 0)), '', 'New', '', '']); // no identifier -> rejected
  rows.push(['SMX-INJ-1', '=CMD|"/C calc"!A0', '9000099999', 'inj@example.com', 'Delhi', 'Organic', '+SUM(1,2)', iso(at(0, 11, 0)), '', 'New', '', '']);
  const csv = rows.map((r) => r.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\r\n');
  fs.writeFileSync(path.join(outDir, '03_ielts_leads.csv'), `\ufeff${csv}\r\n`, 'utf8');
}

// ---------------------------------------------------------------------------------------------
// File 4: BBA/MBA — legacy .xls (BIFF8) via SheetJS.
// ---------------------------------------------------------------------------------------------
function bbaMba() {
  const aoa: (string | number)[][] = [['Lead ID', 'Name', 'Phone Number', 'Email', 'Preferred Course', 'Study Level', 'Source', 'Campaign Name', 'Lead Created Date', 'Assigned Counsellor', 'Lead Status', 'Qualification Status', 'Counselling Status', 'Application Status', 'Enrolment Status']];
  for (let i = 0; i < 50; i++) {
    const l = makeLead({ campaign: pick(['BBA Admissions Oct', 'MBA Admissions Oct']), source: pick(['Google Ads', 'Collegedunia', 'Facebook']), medium: 'CPC', country: 'India', course: pick(['BBA', 'MBA']), studyLevel: pick(['UG', 'PG']), reuse: 0.06 });
    aoa.push([l.leadId, l.name, l.phone, l.email, l.course, l.studyLevel, l.source, l.campaign, iso(l.created), l.counsellor, l.status, l.qualStatus, l.counselling, l.application, l.enrolment]);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'BBA MBA');
  fs.writeFileSync(path.join(outDir, '04_bba-mba_leads.xls'), XLSX.write(wb, { bookType: 'xls', type: 'buffer' }));
}

// ---------------------------------------------------------------------------------------------
// File 5: CWITP — includes cross-file duplicates (same phone/email) and a conflicting Lead ID.
// ---------------------------------------------------------------------------------------------
async function cwitp(dubaiLeads: Lead[]) {
  const leads: Lead[] = [];
  for (let i = 0; i < 30; i++) leads.push(makeLead({ campaign: 'CWITP Webinar Oct', source: pick(['Facebook', 'Instagram', 'Website']), medium: 'Paid Social', country: 'Canada', course: 'CWITP', studyLevel: 'Diploma', reuse: 0.1 }));
  // Same person as in the Dubai file, re-submitted with a new CRM Lead ID (possible duplicate / conflict).
  const d = dubaiLeads[10];
  leads.push({ ...makeLead({ campaign: 'CWITP Webinar Oct', source: 'Facebook', medium: 'Paid Social', country: 'Canada', course: 'CWITP', studyLevel: 'Diploma' }), phone: d.phone, email: d.email, name: d.name });
  // Same person, no Lead ID in this export (confirmed duplicate via phone).
  const d2 = dubaiLeads[20];
  leads.push({ ...makeLead({ campaign: 'CWITP Webinar Oct', source: 'Facebook', medium: 'Paid Social', country: 'Canada', course: 'CWITP', studyLevel: 'Diploma' }), leadId: '', phone: d2.phone, email: d2.email, name: d2.name });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('CWITP Leads');
  ws.addRow(['Lead ID', 'Name', 'Phone Number', 'Email', 'Source', 'Campaign Name', 'Lead Created Date', 'Assigned Counsellor', 'First Contact Date & Time', 'Lead Status', 'Qualification Status', 'Next Follow-up Date', 'Last Contact Date']).font = { bold: true };
  for (const l of leads) ws.addRow([l.leadId, l.name, l.phone, l.email, l.source, l.campaign, l.created, l.counsellor, l.firstContact, l.status, l.qualStatus, l.nextFollowUp, l.lastContact]);
  for (const col of [7, 9, 12, 13]) ws.getColumn(col).numFmt = 'yyyy-mm-dd hh:mm';
  await wb.xlsx.writeFile(path.join(outDir, '05_cwitp_leads.xlsx'));
}

// ---------------------------------------------------------------------------------------------
// Ad spend file.
// ---------------------------------------------------------------------------------------------
async function adSpend() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Ad Spend');
  ws.addRow(['Date', 'Platform', 'Campaign Name', 'Amount Spent (INR)', 'Impressions', 'Clicks', 'Daily Budget', 'Target Leads']).font = { bold: true };
  const d = new Date(`${REPORT_DATE}T00:00:00Z`);
  const rows: [string, string, number, number, number, number, number][] = [
    ['Meta', 'SA Dubai Oct Lead Gen', 18500, 52000, 940, 20000, 55],
    ['Google Ads', 'SA Dubai Search', 14200, 9100, 610, 15000, 25],
    ['Meta', 'ANZ Masters Intake 2027', 16800, 47000, 820, 18000, 50],
    ['Google Ads', 'IELTS Weekend Batch', 6400, 12000, 410, 7000, 40],
    ['Google Ads', 'BBA Admissions Oct', 9100, 15000, 520, 10000, 30],
    ['Google Ads', 'MBA Admissions Oct', 11200, 13500, 480, 12000, 25],
    ['Meta', 'CWITP Webinar Oct', 7300, 30000, 560, 8000, 30],
    ['Meta', 'Diwali Brand Awareness', 5000, 90000, 300, 5000, 0],
  ];
  for (const r of rows) ws.addRow([d, ...r]);
  ws.addRow([new Date(d.getTime() - 86400000), 'Meta', 'SA Dubai Oct Lead Gen', 17900, 50000, 900, 20000, 55]); // previous day -> excluded
  ws.getColumn(1).numFmt = 'yyyy-mm-dd';
  await wb.xlsx.writeFile(path.join(outDir, '06_ad-spend.xlsx'));
}

// ---------------------------------------------------------------------------------------------
// Template with every standard column + instructions.
// ---------------------------------------------------------------------------------------------
async function template() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Leads');
  ws.addRow(LEAD_FIELDS.map((f) => f.label)).font = { bold: true };
  ws.addRow(['SMX-00001', 'Sample Student', '9000000001', 'sample.student@example.com', 'B.Com', 'Delhi', 'Delhi', 'PG', 'MBA', 'UK', '2027', 'September', 'Booked', '5000', '0-2 years', 'Meta Ads', 'Paid Social', 'Sample Campaign', 'CMP-1', 'Sample Ad Set', 'Sample Ad', 'Lead Form A', 'sample_campaign', 'carousel', 'mba uk', 'Meta', `${REPORT_DATE} 10:15`, 'Sample Counsellor', `${REPORT_DATE} 10:20`, `${REPORT_DATE} 10:45`, 'Contacted', 'Warm', 'Qualified', REPORT_DATE, REPORT_DATE, 'Interested', 'Booked', '', '', 'Not Applied', '', '', '', '', '', '']);
  ws.columns.forEach((c) => (c.width = 20));
  const help = wb.addWorksheet('Instructions');
  help.addRow(['Column', 'Group', 'Notes']).font = { bold: true };
  for (const f of LEAD_FIELDS) help.addRow([f.label, f.group, f.type === 'datetime' || f.type === 'date' ? 'Date; YYYY-MM-DD or DD/MM/YYYY, time optional (HH:MM)' : f.type === 'phone' ? '10-digit mobile; +91 prefix allowed' : '']);
  help.addRow([]);
  help.addRow(['Only Lead ID, Phone, Email or Name is required per row. Missing columns make the related KPIs show N/A.']);
  help.columns.forEach((c) => (c.width = 34));
  await wb.xlsx.writeFile(path.join(outDir, 'lead-report-template.xlsx'));

  const ad = new ExcelJS.Workbook();
  const aws = ad.addWorksheet('Ad Spend');
  aws.addRow(['Date', 'Source', 'Campaign Name', 'Spend', 'Impressions', 'Clicks', 'Budget', 'Target Leads']).font = { bold: true };
  aws.addRow([REPORT_DATE, 'Meta Ads', 'Sample Campaign', 10000, 25000, 500, 12000, 40]);
  aws.columns.forEach((c) => (c.width = 18));
  await ad.xlsx.writeFile(path.join(outDir, 'ad-spend-template.xlsx'));
}

// ---------------------------------------------------------------------------------------------
// File 7: Partner referrals — different column names, Unicode names, Lead IDs with leading zeros,
// commas/quotes inside values, missing values, an in-file duplicate and contacts shared with files 1 and 2.
// Generated last so files 1–6 stay identical for a given seed.
// ---------------------------------------------------------------------------------------------
function partnerReferrals() {
  const header = ['Ref No', 'Applicant', 'Mobile', 'E-Mail Address', 'Course', 'Partner', 'Campaign', 'Enquiry Date', 'Telecaller', 'Stage'];
  const unicodeNames = ['Ånanya Ñúñez', 'आरव Testwala', 'Zoë O’Brien-Sample', '李 Synthetic', 'Émile Démo', 'Søren Placeholder'];
  const rows: string[][] = [header];
  const shared = usedPeople.slice(0, 40);
  for (let i = 0; i < 24; i++) {
    const reuse = i % 3 === 0 && shared.length ? shared[Math.floor(rand() * shared.length)] : null;
    const p = reuse ?? person();
    const name = !reuse && i < unicodeNames.length ? unicodeNames[i] : p.name;
    const created = at(0, 9 + (i % 9), (i * 7) % 60);
    rows.push([
      `00${String(7100 + i).padStart(4, '0')}`,
      name,
      i % 5 === 1 ? '' : `0${p.phone}`,
      i % 4 === 2 ? '' : p.email,
      pick(['MBA', 'MSc Data Science', 'BBA']),
      'Partner Network',
      i % 2 ? 'Spring "Fast-Track", UK' : 'Partner Referrals Oct',
      iso(created),
      i % 6 === 0 ? '' : pick(COUNSELLORS),
      pick(['New', 'Contacted', 'Qualified', 'Not Interested']),
    ]);
  }
  rows.push([...rows[3]]); // exact duplicate row inside this file
  rows.push(['', '', '', '', 'MBA', 'Partner Network', 'Partner Referrals Oct', iso(at(0, 12, 0)), '', 'New']); // no identifier
  const csv = rows.map((r) => r.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\r\n');
  fs.writeFileSync(path.join(outDir, '07_partner-referrals_leads.csv'), `\ufeff${csv}\r\n`, 'utf8');
}

// ---------------------------------------------------------------------------------------------
// Files 8–10: SalesMax contact exports (Lead Contact Report format). Synthetic owners and leads only.
// Generated after every other file so files 1–7 stay identical for a given seed.
// ---------------------------------------------------------------------------------------------
const SM_OWNERS = ['Owner Alpha', 'Owner Bravo', 'Owner Charlie'];
const SM_STAGES = ['New Inquiry Lead', 'Being Qualified', 'Being Qualified', 'Qualified Lead', 'Reactivated Lead'];
const SM_DISP = ['RNR', 'INTERESTED', 'BUSY', 'NO_ANSWER', 'CALL_BACK_LATER', 'UNREACHABLE', 'SWITCHED_OFF'];

interface SmLead {
  name: string;
  owner: string;
  stage: string;
  notWorked: boolean;
  attempts: number | null;
  totalCalls: number | null;
  callsToday: number | null;
  lastWorked: Date;
  startedWork: Date | null;
  nextFollowUp: Date | null;
  disposition: string;
  dispositionOn: Date | null;
  mobile: string;
  email: string;
  calledBy: string;
}

let smSeq = 0;
function smLead(reuse?: SmLead): SmLead {
  smSeq++;
  const owner = pick(SM_OWNERS);
  const notWorked = chance(0.12);
  const attempts = notWorked ? null : 1 + Math.floor(rand() * 3);
  const totalCalls = attempts === null ? null : attempts + Math.floor(rand() * 3);
  const disposition = notWorked || chance(0.5) ? '' : pick(SM_DISP);
  const worked = at(-Math.floor(rand() * 10), 9 + Math.floor(rand() * 9), Math.floor(rand() * 60));
  return {
    name: reuse?.name ?? `Lead Sample ${smSeq}`,
    owner,
    stage: notWorked ? 'New Inquiry Lead' : pick(SM_STAGES),
    notWorked,
    attempts,
    totalCalls,
    callsToday: totalCalls === null ? null : Math.min(totalCalls, 1 + Math.floor(rand() * 2)),
    lastWorked: worked,
    startedWork: notWorked ? null : addMin(worked, -30),
    nextFollowUp: chance(0.12) ? null : at(Math.floor(rand() * 8) - 6, 10 + Math.floor(rand() * 6), 0),
    disposition,
    dispositionOn: disposition ? worked : null,
    mobile: reuse?.mobile ?? `91${9000200000 + smSeq}`,
    email: reuse?.email ?? `lead.sample.${smSeq}@example.com`,
    calledBy: notWorked ? '' : owner,
  };
}

const SM_HEADERS = ['LEAD NAME', 'LEAD OWNER', 'LEAD STAGE', 'AWAITING FIRST TOUCH', 'ATTEMPTS', 'TOTAL CALLS', 'CALLS TODAY', 'LAST WORKED', 'STARTED WORK ON', 'NEXT FOLLOWUP', 'LEAD DISPOSITION', 'LAST DISPOSITION ON', 'MOBILE NUMBER', 'EMAIL', 'LAST CALL OUTCOME', 'LAST CALLED BY'];
const smRow = (l: SmLead) => [l.name, l.owner, l.stage, l.notWorked ? 'NOT_WORKED' : null, l.attempts, l.totalCalls, l.callsToday, l.lastWorked, l.startedWork, l.nextFollowUp, l.disposition || null, l.dispositionOn, Number(l.mobile), l.email, l.disposition || null, l.calledBy || null];

async function salesmaxSamples() {
  // 08: exact SalesMax layout (Full Data sheet, 16 columns, dates and numbers typed like the CRM export)
  const a: SmLead[] = [];
  for (let i = 0; i < 60; i++) a.push(smLead());
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Full Data');
  ws.addRow(SM_HEADERS).font = { bold: true };
  for (const l of a) ws.addRow(smRow(l));
  for (const c of [8, 9, 10, 12]) ws.getColumn(c).numFmt = 'dd-mmm-yyyy hh:mm';
  ws.getColumn(13).numFmt = '0';
  await wb.xlsx.writeFile(path.join(outDir, '08_salesmax_contact_export.xlsx'));

  // 09: different column names, no CALLS TODAY column, overlapping contacts with file 08,
  // invalid dates, empty rows, a repeated phone and a duplicate email.
  const b: SmLead[] = [];
  for (let i = 0; i < 30; i++) b.push(i % 6 === 0 ? smLead(a[i]) : smLead());
  b.push({ ...smLead(), mobile: b[1].mobile }); // same phone, different name/email
  b.push({ ...smLead(), email: b[2].email }); // same email
  const dmyT = (d: Date | null) => (d ? dmy(d) : '');
  const rows: string[][] = [['Name', 'Owner', 'Stage', 'First Touch', 'Attempts', 'Calls', 'Last Worked On', 'Work Started On', 'Follow Up Date', 'Disposition', 'Disposition Date', 'Phone', 'Email ID', 'Call Outcome', 'Called By']];
  b.forEach((l, i) => {
    rows.push([l.name, l.owner, l.stage, l.notWorked ? 'NOT_WORKED' : '', l.attempts === null ? '' : String(l.attempts), l.totalCalls === null ? '' : String(l.totalCalls), dmyT(l.lastWorked), dmyT(l.startedWork), i === 4 ? 'next week' : i === 5 ? '31/02/2026' : dmyT(l.nextFollowUp), l.disposition, dmyT(l.dispositionOn), `+${l.mobile.slice(0, 2)} ${l.mobile.slice(2)}`, l.email, l.disposition, l.calledBy]);
    if (i % 10 === 3) rows.push(new Array(15).fill(''));
  });
  // Incomplete (no phone, no email) and invalid (no identifier at all) rows
  rows.push(['Lead Sample Incomplete', 'Owner Bravo', 'New Inquiry Lead', 'NOT_WORKED', '', '', '', '', '', '', '', '', '', '', '']);
  rows.push(['', 'Owner Charlie', 'New Inquiry Lead', 'NOT_WORKED', '', '', '', '', '', '', '', '', '', '', '']);
  const csv = rows.map((r) => r.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\r\n');
  fs.writeFileSync(path.join(outDir, '09_salesmax_team_b.csv'), `\ufeff${csv}\r\n`, 'utf8');

  // 10: only some SalesMax columns plus extra columns
  const c2: SmLead[] = [];
  for (let i = 0; i < 20; i++) c2.push(smLead());
  const wb3 = new ExcelJS.Workbook();
  const ws3 = wb3.addWorksheet('Leads');
  ws3.addRow(['Lead Name', 'Lead Owner', 'Lead Stage', 'Mobile Number', 'Email', 'Next Followup', 'City', 'Notes']).font = { bold: true };
  for (const l of c2) ws3.addRow([l.name, l.owner, l.stage, Number(l.mobile), l.email, l.nextFollowUp, pick(CITIES), chance(0.3) ? 'Asked for brochure' : null]);
  ws3.getColumn(6).numFmt = 'dd-mmm-yyyy hh:mm';
  await wb3.xlsx.writeFile(path.join(outDir, '10_salesmax_partial.xlsx'));
}

async function main() {
  const dubaiLeads = await dubai();
  await ausNz();
  ielts();
  bbaMba();
  await cwitp(dubaiLeads);
  await adSpend();
  await template();
  partnerReferrals();
  await salesmaxSamples();
  console.warn(`Synthetic samples written to ${outDir} (reporting date ${REPORT_DATE}).`);
}

void main();
