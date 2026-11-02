import { createHash } from 'node:crypto';
import type { Request } from 'express';

const CLIENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Hash of the random per-browser id the portal sends in X-Client-Id. Used to keep each browser's
 * sessions and report history separate. Not authentication: the portal has no user accounts.
 */
export function clientHash(req: Request): string | null {
  const id = req.header('x-client-id');
  if (!id || !CLIENT_ID_RE.test(id)) return null;
  return createHash('sha256').update(id.toLowerCase()).digest('hex');
}
