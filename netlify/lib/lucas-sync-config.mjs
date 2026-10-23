import { createHash } from 'node:crypto';

export const STORE_NAME = 'lucas-progress-v1';
export const BACKUP_STORE_NAME = 'lucas-progress-backups-v1'; // Reserved; no HTTP handler writes here.
export const BACKUP_SLOTS = 7;
export const MAX_BODY_BYTES = 32 * 1024;
export const MAX_RECORD_BYTES = 256 * 1024;
export const ownerHash = subject => createHash('sha256').update(subject).digest('hex');
export const emptyEnvelope = () => ({ revision: 0, generation: null, progress: null, deleted: false });
export const publicEnvelope = record => record ? Object.fromEntries(['revision', 'generation', 'progress', 'deleted'].map(key => [key, record[key]])) : emptyEnvelope();

export function trustedOrigin(env) {
  const url = new URL(env.LUCAS_SYNC_ORIGIN || env.URL || 'https://www.lasnotasdevero.com');
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('configuration');
  return url.origin;
}
