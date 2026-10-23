import { MAX_BODY_BYTES } from './lucas-sync-config.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
export const exactKeys = (value, allowed, required = allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key));
const integer = value => Number.isSafeInteger(value) && value >= 0;
export const validBase = value => integer(value.revision) && (value.generation === null || (typeof value.generation === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value.generation)));

export function validProgress(progress, catalog, now = Date.now()) {
  const time = value => integer(value) && value <= now + 300000;
  const record = (value, check) => exactKeys(value, ['value', 'updatedAt']) && time(value.updatedAt) && check(value.value);
  const known = id => typeof id === 'string' && Object.hasOwn(catalog, id);
  if (!exactKeys(progress, ['version', 'classes', 'selected', 'lastActivity'], ['version', 'classes']) || progress.version !== 1 || !object(progress.classes)) return false;
  if (Buffer.byteLength(JSON.stringify(progress)) > MAX_BODY_BYTES) return false;
  if (progress.selected !== undefined && !record(progress.selected, known)) return false;
  if (progress.lastActivity !== undefined && !record(progress.lastActivity, time)) return false;
  for (const [id, lesson] of Object.entries(progress.classes)) {
    if (!known(id) || !exactKeys(lesson, ['blocks', 'complete', 'lastPoint', 'lastActivity'], ['blocks']) || !object(lesson.blocks)) return false;
    if (lesson.complete !== undefined && !record(lesson.complete, value => typeof value === 'boolean')) return false;
    if (lesson.lastActivity !== undefined && !record(lesson.lastActivity, time)) return false;
    if (lesson.lastPoint !== undefined && !record(lesson.lastPoint, value => catalog[id].points.includes(value))) return false;
    for (const [question, block] of Object.entries(lesson.blocks)) {
      if (!catalog[id].questions.includes(question) || !record(block, value => typeof value === 'boolean')) return false;
    }
  }
  return true;
}

export async function readBoundedJSON(request) {
  const claimed = request.headers.get('content-length');
  if (claimed !== null && (!/^\d+$/.test(claimed) || Number(claimed) > MAX_BODY_BYTES)) throw Object.assign(Error(), { status: 413 });
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') || '')) throw Object.assign(Error(), { status: 415 });
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(Error(), { status: 400 });
  let size = 0; const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) { await reader.cancel(); throw Object.assign(Error(), { status: 413 }); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(Error(), { status: 400 }); }
}
