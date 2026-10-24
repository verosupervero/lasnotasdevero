// Stable IDs are supplied by the content. Every mutable field has its own clock.
export const STORAGE_KEY = 'lasnotasdevero:lucas:progress:v1';
export const emptyProgress = () => ({ version: 1, classes: {} });
// A deterministic representation prevents multi-tab merge writes from echoing.
export function serializeProgress(state) {
  return JSON.stringify(state, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
    return value;
  });
}
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const record = (value, type) => object(value) && typeof value.value === type && Number.isSafeInteger(value.updatedAt) && value.updatedAt >= 0;
export function parseProgress(raw) {
  if (raw === null) return { state: emptyProgress(), status: 'ready' };
  try {
    const state = JSON.parse(raw);
    if (object(state) && state.version > 1) return { state: emptyProgress(), status: 'future' };
    if (!object(state) || state.version !== 1 || !object(state.classes)) throw Error('schema');
    for (const key of ['selected', 'lastActivity']) {
      if (state[key] !== undefined && !record(state[key], key === 'selected' ? 'string' : 'number')) throw Error('record');
    }
    for (const lesson of Object.values(state.classes)) {
      if (!object(lesson) || !object(lesson.blocks)) throw Error('class');
      if (lesson.complete !== undefined && !record(lesson.complete, 'boolean')) throw Error('complete');
      if (lesson.lastPoint !== undefined && !record(lesson.lastPoint, 'string')) throw Error('point');
      if (lesson.lastActivity !== undefined && !record(lesson.lastActivity, 'number')) throw Error('activity');
      if (!Object.values(lesson.blocks).every((block) => record(block, 'boolean'))) throw Error('block');
    }
    return { state, status: 'ready' };
  } catch { return { state: emptyProgress(), status: 'corrupt' }; }
}
const newer = (a, b) => !a ? b : !b ? a : b.updatedAt > a.updatedAt ? b : b.updatedAt < a.updatedAt ? a : serializeProgress(a) > serializeProgress(b) ? a : b;
export function mergeProgress(a, b) {
  const result = { ...a, ...b, version: 1, classes: {} };
  for (const field of ['selected', 'lastActivity']) {
    const value = newer(a[field], b[field]);
    if (value) result[field] = value;
  }
  for (const id of new Set([...Object.keys(a.classes), ...Object.keys(b.classes)])) {
    const x = a.classes[id] || { blocks: {} }, y = b.classes[id] || { blocks: {} };
    const lesson = { ...x, ...y, blocks: {} };
    for (const field of ['complete', 'lastPoint', 'lastActivity']) {
      const value = newer(x[field], y[field]);
      if (value) lesson[field] = value;
    }
    for (const question of new Set([...Object.keys(x.blocks), ...Object.keys(y.blocks)])) lesson.blocks[question] = newer(x.blocks[question], y.blocks[question]);
    Object.defineProperty(result.classes, id, { value: lesson, enumerable: true, writable: true, configurable: true });
  }
  return result;
}
export function updateProgress(state, classId, field, value, timestamp, questionId) {
  const lesson = { blocks: {}, lastActivity: { value: timestamp, updatedAt: timestamp } };
  const next = { version: 1, classes: { [classId]: lesson }, lastActivity: { value: timestamp, updatedAt: timestamp } };
  if (field === 'selected') next.selected = { value: classId, updatedAt: timestamp };
  else if (field === 'block') lesson.blocks[questionId] = { value, updatedAt: timestamp };
  else lesson[field] = { value, updatedAt: timestamp };
  return mergeProgress(state, next);
}
export function progressCounts(state, lessons) {
  const count = (items) => ({ total: items.length, complete: items.filter((item) => state.classes[item.id]?.complete?.value === true).length });
  return {
    course: count(lessons.filter((item) => item.kind === 'course')),
    complement: count(lessons.filter((item) => item.kind === 'complement')),
    integration: count(lessons.filter((item) => item.kind === 'integration')),
  };
}
