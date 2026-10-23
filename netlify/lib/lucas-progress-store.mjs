import { randomUUID } from 'node:crypto';
import { BACKUP_SLOTS, MAX_RECORD_BYTES, publicEnvelope } from './lucas-sync-config.mjs';

export const strongRead = (store, key) => store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
const condition = current => {
  if (!current) return { onlyIfNew: true };
  if (!current.etag) throw Error('missing strong ETag');
  return { onlyIfMatch: current.etag };
};
const generationConflict = (record, generation) => {
  if (generation === (record?.generation ?? null)) return null;
  // The first creation is mergeable; a null generation must NEVER cross a deletion epoch.
  return generation === null && record && !record.deleted && record.resetCount === 0 ? 409 : 410;
};

// The history lives in the SAME CAS object: a stale writer cannot restore it after deletion.
export async function mutateProgress(store, key, input, remove, now) {
  const current = await strongRead(store, key), envelope = publicEnvelope(current?.data);
  const mismatch = generationConflict(current?.data, input.generation);
  if (mismatch) return { status: mismatch, body: { error: mismatch === 409 ? 'conflict' : 'reset', ...envelope } };
  if (input.revision !== envelope.revision) return { status: 409, body: { error: 'conflict', ...envelope } };
  const next = {
    revision: envelope.revision + 1,
    generation: remove ? randomUUID() : envelope.generation || randomUUID(),
    progress: remove ? null : input.progress,
    deleted: remove,
    resetCount: (current?.data.resetCount || 0) + (remove ? 1 : 0),
    updatedAt: now,
    backups: remove ? [] : [...(current?.data.backups || [])]
  };
  if (!remove && current?.data.progress && !current.data.deleted) {
    const { revision, generation, progress, updatedAt } = current.data;
    next.backups.push({ revision, generation, progress, updatedAt });
  }
  next.backups = next.backups.slice(-BACKUP_SLOTS);
  while (Buffer.byteLength(JSON.stringify(next)) > MAX_RECORD_BYTES && next.backups.length) next.backups.shift();
  if (Buffer.byteLength(JSON.stringify(next)) > MAX_RECORD_BYTES) throw Error('record too large');
  const write = await store.setJSON(key, next, condition(current));
  if (!write.modified) {
    const latestRecord = (await strongRead(store, key))?.data;
    const latest = publicEnvelope(latestRecord);
    const status = generationConflict(latestRecord, input.generation) || 409;
    return { status, body: { error: status === 410 ? 'reset' : 'conflict', ...latest } };
  }
  return { status: 200, body: publicEnvelope(next) };
}

// Persistent fixed-size per-subject bucket. Edge rate limiting also covers anonymous auth requests.
export async function allowRequest(store, owner, now, limit = 30) {
  const key = `rate/${owner}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const previous = await strongRead(store, key);
    const old = previous?.data;
    const bucket = old && now >= old.start && now - old.start < 60000 ? { start: old.start, count: old.count + 1 } : { start: now, count: 1 };
    if (bucket.count > limit) return false;
    if ((await store.setJSON(key, bucket, condition(previous))).modified) return true;
  }
  return false;
}
