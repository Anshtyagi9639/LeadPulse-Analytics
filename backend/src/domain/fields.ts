/**
 * Standard reporting fields recognised by the column-mapping engine.
 * `synonyms` are compared after normalising headers (lower-case, alphanumerics only).
 */
export type FieldType = 'string' | 'phone' | 'email' | 'date' | 'datetime' | 'number' | 'currency';
export type FieldGroup = 'student' | 'marketing' | 'sales' | 'conversion' | 'advertising';
export type FileKind = 'leads' | 'ad_spend';

export interface FieldDef {
  key: string;
  label: string;
  group: FieldGroup;
  type: FieldType;
  /** True when the field holds student personal data (never logged, never sent to AI, masked in error reports). */
  pii?: boolean;
  synonyms: string[];
}

export const LEAD_FIELDS: FieldDef[] = [
  // Student information
  { key: 'leadId', label: 'Lead ID', group: 'student', type: 'string', synonyms: ['lead id', 'leadid', 'lead no', 'lead number', 'enquiry id', 'enquiry no', 'crm id', 'record id', 'lead ref', 'lead reference', 'id', 'lead code', 'prospect id', 'ref no', 'ref id', 'reference no', 'reference number', 'ref number'] },
  { key: 'name', label: 'Name', group: 'student', type: 'string', pii: true, synonyms: ['name', 'full name', 'student name', 'lead name', 'candidate name', 'applicant name', 'contact name', 'first name', 'customer name', 'applicant'] },
  { key: 'phone', label: 'Phone Number', group: 'student', type: 'phone', pii: true, synonyms: ['phone', 'phone number', 'phone no', 'mobile', 'mobile number', 'mobile no', 'contact number', 'contact no', 'phone mobile', 'whatsapp number', 'cell', 'cell phone', 'telephone', 'primary phone'] },
  { key: 'email', label: 'Email', group: 'student', type: 'email', pii: true, synonyms: ['email', 'email id', 'email address', 'e mail', 'mail id', 'emailid', 'student email', 'primary email'] },
  { key: 'qualification', label: 'Qualification', group: 'student', type: 'string', synonyms: ['qualification', 'highest qualification', 'education', 'last qualification', 'current qualification', 'academic qualification'] },
  { key: 'city', label: 'City', group: 'student', type: 'string', synonyms: ['city', 'current city', 'location', 'town', 'city name'] },
  { key: 'state', label: 'State', group: 'student', type: 'string', synonyms: ['state', 'province', 'region', 'state name'] },
  { key: 'studyLevel', label: 'Study Level', group: 'student', type: 'string', synonyms: ['study level', 'level', 'program level', 'programme level', 'course level', 'degree level', 'level of study'] },
  { key: 'preferredCourse', label: 'Preferred Course', group: 'student', type: 'string', synonyms: ['preferred course', 'course', 'course interested', 'interested course', 'program', 'programme', 'course name', 'course of interest', 'product'] },
  { key: 'preferredCountry', label: 'Preferred Country', group: 'student', type: 'string', synonyms: ['preferred country', 'country', 'destination', 'study destination', 'country of interest', 'interested country', 'destination country', 'preferred destination'] },
  { key: 'preferredUniversity', label: 'Preferred University', group: 'student', type: 'string', synonyms: ['preferred university', 'university', 'college', 'institution', 'preferred college', 'university name'] },
  { key: 'intakeYear', label: 'Intake Year', group: 'student', type: 'string', synonyms: ['intake year', 'year of intake', 'intake yr'] },
  { key: 'intakeSeason', label: 'Intake Season', group: 'student', type: 'string', synonyms: ['intake season', 'intake', 'intake month', 'session', 'intake term'] },
  { key: 'ieltsStatus', label: 'IELTS Status', group: 'student', type: 'string', synonyms: ['ielts status', 'ielts', 'english test', 'ielts score', 'english proficiency', 'test status', 'pte ielts status'] },
  { key: 'budgetRange', label: 'Budget Range', group: 'student', type: 'string', synonyms: ['budget range', 'budget', 'student budget', 'fee budget'] },
  { key: 'workExperience', label: 'Work Experience', group: 'student', type: 'string', synonyms: ['work experience', 'experience', 'work exp', 'years of experience', 'total experience'] },

  // Marketing attribution
  { key: 'source', label: 'Source', group: 'marketing', type: 'string', synonyms: ['source', 'lead source', 'channel', 'utm source', 'platform', 'source name'] },
  { key: 'medium', label: 'Medium', group: 'marketing', type: 'string', synonyms: ['medium', 'utm medium', 'lead medium'] },
  { key: 'campaignName', label: 'Campaign Name', group: 'marketing', type: 'string', synonyms: ['campaign name', 'campaign', 'campaign title', 'ad campaign', 'campaign nm'] },
  { key: 'campaignId', label: 'Campaign ID', group: 'marketing', type: 'string', synonyms: ['campaign id', 'campaignid', 'campaign code'] },
  { key: 'adSetName', label: 'Ad Set Name', group: 'marketing', type: 'string', synonyms: ['ad set name', 'adset name', 'ad set', 'adset', 'ad group', 'ad group name'] },
  { key: 'adName', label: 'Ad Name', group: 'marketing', type: 'string', synonyms: ['ad name', 'ad', 'creative', 'creative name', 'ad title'] },
  { key: 'leadSourceDetail', label: 'Lead Source Detail', group: 'marketing', type: 'string', synonyms: ['lead source detail', 'source detail', 'sub source', 'subsource', 'lead sub source', 'form name', 'lead form'] },
  { key: 'utmCampaign', label: 'UTM Campaign', group: 'marketing', type: 'string', synonyms: ['utm campaign', 'utmcampaign'] },
  { key: 'utmContent', label: 'UTM Content', group: 'marketing', type: 'string', synonyms: ['utm content', 'utmcontent'] },
  { key: 'utmTerm', label: 'UTM Term', group: 'marketing', type: 'string', synonyms: ['utm term', 'utmterm', 'keyword'] },
  { key: 'leadProvider', label: 'Lead Provider', group: 'marketing', type: 'string', synonyms: ['lead provider', 'provider', 'vendor', 'lead vendor', 'publisher', 'agency', 'partner'] },
  { key: 'leadCreatedDate', label: 'Lead Created Date', group: 'marketing', type: 'datetime', synonyms: ['lead created date', 'created date', 'created on', 'created at', 'lead date', 'date created', 'enquiry date', 'lead created on', 'created time', 'creation date', 'submitted on', 'lead created', 'date', 'lead generation date', 'timestamp'] },

  // Sales and lead handling
  { key: 'assignedCounsellor', label: 'Assigned Counsellor', group: 'sales', type: 'string', synonyms: ['assigned counsellor', 'assigned counselor', 'counsellor', 'counselor', 'owner', 'lead owner', 'assigned to', 'counsellor name', 'counselor name', 'sales owner', 'agent', 'assigned user', 'telecaller', 'tele caller', 'caller', 'advisor', 'adviser'] },
  { key: 'assignedAt', label: 'Assigned Date & Time', group: 'sales', type: 'datetime', synonyms: ['assigned date time', 'assigned date', 'assigned on', 'assignment date', 'assigned at', 'allocation date'] },
  { key: 'firstContactAt', label: 'First Contact Date & Time', group: 'sales', type: 'datetime', synonyms: ['first contact date time', 'first contact date', 'first contacted on', 'first call date', 'first response time', 'first contact', 'first activity date', 'first call'] },
  { key: 'leadStatus', label: 'Lead Status', group: 'sales', type: 'string', synonyms: ['lead status', 'status', 'current status'] },
  { key: 'leadQuality', label: 'Lead Quality', group: 'sales', type: 'string', synonyms: ['lead quality', 'quality', 'lead rating', 'rating', 'lead temperature', 'lead score'] },
  { key: 'qualificationStatus', label: 'Qualification Status', group: 'sales', type: 'string', synonyms: ['qualification status', 'qualified', 'is qualified', 'qualified status', 'qualified unqualified', 'lead qualification'] },
  { key: 'lastContactDate', label: 'Last Contact Date', group: 'sales', type: 'datetime', synonyms: ['last contact date', 'last contacted on', 'last activity date', 'last call date', 'last contacted', 'last activity'] },
  { key: 'nextFollowUpDate', label: 'Next Follow-up Date', group: 'sales', type: 'datetime', synonyms: ['next follow up date', 'next followup date', 'next followup', 'next follow-up', 'follow up date', 'followup date', 'next follow up', 'next action date', 'callback date', 'next call date'] },
  { key: 'followUpOutcome', label: 'Follow-up Outcome', group: 'sales', type: 'string', synonyms: ['follow up outcome', 'followup outcome', 'follow up status', 'remarks', 'outcome'] },
  // SalesMax CRM contact-export fields (Lead Contact Report)
  { key: 'leadStage', label: 'Lead Stage', group: 'sales', type: 'string', synonyms: ['lead stage', 'stage', 'pipeline stage', 'lead pipeline stage'] },
  { key: 'awaitingFirstTouch', label: 'Awaiting First Touch', group: 'sales', type: 'string', synonyms: ['awaiting first touch', 'first touch', 'first touch status', 'awaiting first contact'] },
  { key: 'attempts', label: 'Attempts', group: 'sales', type: 'number', synonyms: ['attempts', 'attempt count', 'no of attempts', 'number of attempts', 'call attempts'] },
  { key: 'totalCalls', label: 'Total Calls', group: 'sales', type: 'number', synonyms: ['total calls', 'calls', 'call count', 'no of calls', 'number of calls'] },
  { key: 'callsToday', label: 'Calls Today', group: 'sales', type: 'number', synonyms: ['calls today', 'today calls', 'todays calls', 'calls made today'] },
  { key: 'lastWorked', label: 'Last Worked', group: 'sales', type: 'datetime', synonyms: ['last worked', 'last worked on', 'last worked date', 'last worked at'] },
  { key: 'startedWorkOn', label: 'Started Work On', group: 'sales', type: 'datetime', synonyms: ['started work on', 'work started on', 'started working on', 'first worked on'] },
  { key: 'leadDisposition', label: 'Lead Disposition', group: 'sales', type: 'string', synonyms: ['lead disposition', 'disposition', 'latest disposition', 'current disposition'] },
  { key: 'lastDispositionOn', label: 'Last Disposition On', group: 'sales', type: 'datetime', synonyms: ['last disposition on', 'disposition date', 'last disposition date', 'disposition on'] },
  { key: 'lastCallOutcome', label: 'Last Call Outcome', group: 'sales', type: 'string', synonyms: ['last call outcome', 'call outcome', 'call status', 'last call status', 'last call result'] },
  { key: 'lastCalledBy', label: 'Last Called By', group: 'sales', type: 'string', synonyms: ['last called by', 'called by', 'last caller', 'last call by'] },
  { key: 'counsellingStatus', label: 'Counselling Status', group: 'sales', type: 'string', synonyms: ['counselling status', 'counseling status', 'counselling', 'counseling', 'session status', 'counselling session', 'meeting status'] },
  { key: 'unqualifiedReason', label: 'Unqualified Reason', group: 'sales', type: 'string', synonyms: ['unqualified reason', 'disqualification reason', 'reason for unqualified', 'not qualified reason', 'junk reason'] },
  { key: 'lostReason', label: 'Lost Reason', group: 'sales', type: 'string', synonyms: ['lost reason', 'reason lost', 'drop reason', 'closure reason', 'reason for loss'] },

  // Conversion information
  { key: 'applicationStatus', label: 'Application Status', group: 'conversion', type: 'string', synonyms: ['application status', 'app status', 'application stage', 'applied status'] },
  { key: 'applicationDate', label: 'Application Date', group: 'conversion', type: 'date', synonyms: ['application date', 'applied on', 'applied date', 'date of application', 'application submitted on'] },
  { key: 'offerStatus', label: 'Offer Status', group: 'conversion', type: 'string', synonyms: ['offer status', 'offer', 'offer letter status', 'offer received'] },
  { key: 'enrolmentStatus', label: 'Enrolment Status', group: 'conversion', type: 'string', synonyms: ['enrolment status', 'enrollment status', 'enrolled', 'admission status', 'enrolment', 'enrollment'] },
  { key: 'enrolmentDate', label: 'Enrolment Date', group: 'conversion', type: 'date', synonyms: ['enrolment date', 'enrollment date', 'enrolled on', 'admission date', 'date of enrolment'] },
  { key: 'revenue', label: 'Revenue / Fee Value', group: 'conversion', type: 'currency', synonyms: ['revenue', 'fee value', 'fee', 'fees', 'revenue fee value', 'amount', 'fee amount', 'deal value', 'commission', 'value'] },
];

export const AD_FIELDS: FieldDef[] = [
  { key: 'campaignName', label: 'Campaign Name', group: 'advertising', type: 'string', synonyms: ['campaign name', 'campaign', 'campaign title'] },
  { key: 'source', label: 'Source / Platform', group: 'advertising', type: 'string', synonyms: ['source', 'platform', 'channel', 'network', 'publisher'] },
  { key: 'date', label: 'Date', group: 'advertising', type: 'date', synonyms: ['date', 'day', 'reporting date', 'report date', 'reporting starts'] },
  { key: 'spend', label: 'Spend', group: 'advertising', type: 'currency', synonyms: ['spend', 'amount spent', 'amount spent inr', 'cost', 'ad spend', 'spend inr', 'total spend', 'spent'] },
  { key: 'impressions', label: 'Impressions', group: 'advertising', type: 'number', synonyms: ['impressions', 'impr', 'impr.', 'views'] },
  { key: 'clicks', label: 'Clicks', group: 'advertising', type: 'number', synonyms: ['clicks', 'link clicks', 'clicks all'] },
  { key: 'budget', label: 'Budget', group: 'advertising', type: 'currency', synonyms: ['budget', 'daily budget', 'campaign budget', 'ad set budget'] },
  { key: 'targetLeads', label: 'Target Leads', group: 'advertising', type: 'number', synonyms: ['target leads', 'lead target', 'target', 'leads target', 'daily target'] },
];

export function fieldsFor(kind: FileKind): FieldDef[] {
  return kind === 'ad_spend' ? AD_FIELDS : LEAD_FIELDS;
}

export const LEAD_FIELD_MAP = new Map(LEAD_FIELDS.map((f) => [f.key, f]));
export const AD_FIELD_MAP = new Map(AD_FIELDS.map((f) => [f.key, f]));

/** A lead row must carry at least one of these to be accepted (otherwise it cannot be counted or de-duplicated). */
export const LEAD_IDENTITY_FIELDS = ['leadId', 'phone', 'email', 'name'] as const;
/** An ad-spend row needs a spend value and something to attribute it to. */
export const AD_REQUIRED_FIELDS = ['spend'] as const;
export const AD_ATTRIBUTION_FIELDS = ['campaignName', 'source'] as const;
