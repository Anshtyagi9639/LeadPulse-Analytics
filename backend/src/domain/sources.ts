import { groupKey } from './normalize.js';

/**
 * Canonical labels for well-known lead sources so "facebook", "FB Lead Ads" and "Meta" group together.
 * Unknown sources keep the label supplied in the data — no source is ever invented.
 */
const ALIASES: [RegExp, string][] = [
  [/^(meta|meta ads|facebook|facebook ads|fb|fb ads|fb lead ads?|facebook lead ads?|instagram|ig|insta|meta lead ads?)$/, 'Meta Ads'],
  [/^(google|google ads|adwords|google adwords|gads|google search|google ppc|ppc|sem|youtube|google display|pmax|performance max)$/, 'Google Ads'],
  [/^(collegedunia|college dunia|collegedunia com)$/, 'Collegedunia'],
  [/^(organic|website|web|seo|direct|organic search|walk in|walkin|walk-in)$/, 'Organic'],
  [/^(referral|reference|referred|friend referral|student referral)$/, 'Referral'],
];

export function canonicalSource(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const k = groupKey(raw).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [re, label] of ALIASES) if (re.test(k)) return label;
  return raw.trim();
}
