/**
 * Classification of free-text CRM status values into funnel outcomes.
 * Every rule is documented in KPI Definitions so report readers can see exactly what was counted.
 * A value that matches neither the positive nor the negative pattern is reported as "unknown".
 */
export type Tri = true | false | null;

const NEGATION = /\b(not|non|no|never|cancel+ed|cancel+ation|withdrawn|withdraw|rejected|refused|declined|pending|awaiting|draft|in progress|yet to)\b|^n$/i;

function test(value: string | null, positive: RegExp, negative: RegExp = NEGATION): Tri {
  if (!value) return null;
  const v = value.toLowerCase().trim();
  if (!v) return null;
  if (negative.test(v)) return false;
  if (positive.test(v)) return true;
  return false;
}

const YES = /^(y|yes|true|1|done)$/i;

/** "Being Qualified", "To be qualified", "Qualifying" … are work in progress, not qualified. */
const PENDING_QUALIFICATION = /\b(being|to be|not yet|yet to be|pending|awaiting)\s+qualif|\bqualifying\b/;

/** Qualification Status / Lead Quality: explicit "qualified" (or yes) only. */
export function classifyQualified(value: string | null): Tri {
  if (!value) return null;
  const v = value.toLowerCase().trim();
  if (PENDING_QUALIFICATION.test(v)) return null;
  if (/\b(unqualified|disqualified|not qualified|non qualified|junk|invalid|fake|spam|duplicate)\b/.test(v) || /^(n|no|false|0)$/.test(v)) return false;
  if (/\bqualified\b|\bsql\b/.test(v) || YES.test(v)) return true;
  return null; // e.g. "Pending", "New" — not yet assessed
}

/** Lead Status values that explicitly state qualification (used only when no dedicated qualification column is mapped). */
export function classifyQualifiedFromStatus(value: string | null): Tri {
  if (!value) return null;
  const v = value.toLowerCase();
  if (PENDING_QUALIFICATION.test(v)) return null;
  if (/\b(unqualified|disqualified|not qualified|junk|invalid|fake|spam)\b/.test(v)) return false;
  if (/\bqualified\b/.test(v)) return true;
  return null;
}

/** Statuses that indicate the lead has been reached. */
export function classifyContactedFromStatus(value: string | null): Tri {
  if (!value) return null;
  const v = value.toLowerCase();
  if (/\b(not contacted|uncontacted|new|fresh|not connected|dnp|did not pick|unreachable|not reachable|switched off|ringing|no answer|busy)\b/.test(v)) return false;
  if (/\b(contacted|connected|spoke|interested|follow ?up|counsel+ing|qualified|applied|enrolled|callback|call back)\b/.test(v)) return true;
  return null;
}

export function classifyCounsellingBooked(value: string | null): Tri {
  return test(value, /\b(booked|scheduled|attended|completed|done|held|conducted|rescheduled|yes)\b/, /\b(not|no|cancel+ed|never)\b|^n$/i);
}

export function classifyCounsellingAttended(value: string | null): Tri {
  return test(value, /\b(attended|completed|done|held|conducted)\b/, /\b(not|no show|missed|cancel+ed|never)\b/i);
}

export function classifyApplied(value: string | null): Tri {
  return test(value, /\b(submitted|applied|lodged|complete|completed|filed|sent|yes)\b|^y$/i);
}

export function classifyOffer(value: string | null): Tri {
  return test(value, /\b(offer|received|conditional|unconditional|accepted|issued|yes|coe|col|uol)\b|^y$/i, /\b(not|no offer|pending|awaiting|rejected|refused|declined|withdrawn)\b|^(n|no)$/i);
}

export function classifyEnrolled(value: string | null): Tri {
  return test(value, /\b(enrolled|enrolment|enrollment|confirmed|joined|admitted|paid|yes|visa granted)\b|^y$/i);
}

export function classifyFollowUpDone(value: string | null): Tri {
  if (!value) return null;
  const v = value.toLowerCase();
  if (/\b(pending|not done|missed|overdue|scheduled|to do|todo)\b/.test(v)) return false;
  return true;
}

/** Lead is closed (no further follow-up expected). */
export function classifyClosed(status: string | null): boolean {
  if (!status) return false;
  return /\b(lost|junk|invalid|not interested|closed|dnd|unqualified|disqualified|enrolled|dead|spam|fake|duplicate)\b/i.test(status);
}
