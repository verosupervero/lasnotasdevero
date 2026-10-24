import { emptyProgress, parseProgress, mergeProgress, serializeProgress } from './study-progress.js';

// Each page owns a fresh key. Other pages' queues are read, never overwritten or
// deleted. Their acknowledged leaves are ignored on the next verified read.
export function progressDelta(before, after, covered = false) {
  const out = emptyProgress();
  const ordered = value => value && JSON.parse(serializeProgress(value));
  const different = (a, b) => b && (covered
    ? serializeProgress(mergeProgress({ version: 1, classes: {}, selected: ordered(a) }, { version: 1, classes: {}, selected: ordered(b) }).selected) !== serializeProgress(a)
    : serializeProgress(a) !== serializeProgress(b));
  for (const field of ['selected', 'lastActivity']) if (different(before[field], after[field])) out[field] = after[field];
  for (const [id, lesson] of Object.entries(after.classes)) {
    const previous = before.classes[id] || { blocks: {} }, next = { blocks: {} };
    for (const field of ['complete', 'lastPoint', 'lastActivity']) if (different(previous[field], lesson[field])) next[field] = lesson[field];
    for (const [question, value] of Object.entries(lesson.blocks)) if (different(previous.blocks[question], value)) next.blocks[question] = value;
    if (Object.keys(next).length > 1 || Object.keys(next.blocks).length) Object.defineProperty(out.classes, id, { value: next, enumerable: true });
  }
  return out;
}
export const hasChanges = state => !!(state.selected || state.lastActivity || Object.keys(state.classes).length);
export const uncoveredChanges = (pending, confirmed) => progressDelta(confirmed || emptyProgress(), pending, true);

const RECORD_LIMIT = 98304, TOTAL_LIMIT = 1048576, COUNT_LIMIT = 64;
const bytes = value => new TextEncoder().encode(value).length;
export function createPrivateStorage({ storage, baseKey, tabId = globalThis.crypto.randomUUID() }) {
  const prefix = `${baseKey}:private:v2:`, memory = new Map();
  const key = uid => `${prefix}${encodeURIComponent(uid)}:${tabId}`;
  const erasedKey = uid => `${baseKey}:private:erased:v2:${encodeURIComponent(uid)}`;
  const erasedMemory = new Set();
  function erased(uid) {
    if (erasedMemory.has(uid)) return true;
    try {
      const marker = JSON.parse(storage.getItem(erasedKey(uid)));
      return marker?.version === 2 && marker.uid === uid && marker.erased === true;
    } catch { return false; }
  }
  function parse(raw, uid) {
    try {
      if (typeof raw !== 'string' || bytes(raw) > RECORD_LIMIT) return;
      const record = JSON.parse(raw);
      if (!record || record.version !== 2 || record.uid !== uid || Object.keys(record).some(k => !['version', 'uid', 'generation', 'snapshot', 'pending', 'closed'].includes(k))
        || (record.closed !== undefined && typeof record.closed !== 'boolean')
        || !(record.generation === null || (typeof record.generation === 'string' && record.generation.length > 0 && record.generation.length <= 128))) return;
      for (const field of ['snapshot', 'pending']) if (parseProgress(JSON.stringify(record[field])).status !== 'ready') return;
      return record;
    } catch { /* Corrupt/private future formats remain untouched. */ }
  }
  function entries(uid) {
    if (erased(uid)) { memory.delete(uid); return []; }
    const out = new Map();
    try {
      for (let index = 0; index < storage.length; index++) {
        const name = storage.key(index);
        if (name?.startsWith(`${prefix}${encodeURIComponent(uid)}:`)) {
          const record = parse(storage.getItem(name), uid);
          if (record) out.set(name, record);
        }
      }
      const own = parse(storage.getItem(key(uid)), uid);
      if (own) out.set(key(uid), own);
    } catch { /* Recover the page's memory copy if storage is unavailable. */ }
    if (memory.has(uid)) out.set(key(uid), memory.get(uid));
    return [...out].map(([name, record]) => ({ key: name, record }));
  }
  function save(uid, generation, snapshot, pending) {
    if (erased(uid)) { memory.delete(uid); return false; }
    const record = { version: 2, uid, generation, snapshot: structuredClone(snapshot), pending: structuredClone(pending) };
    memory.set(uid, record);
    const raw = JSON.stringify(record);
    if (bytes(raw) > RECORD_LIMIT) return false;
    try {
      let total = bytes(raw), count = 1;
      for (let index = 0; index < storage.length; index++) {
        const name = storage.key(index);
        if (name?.startsWith(prefix) && name !== key(uid)) { count++; total += bytes(storage.getItem(name) || ''); }
      }
      if (count > COUNT_LIMIT || total > TOTAL_LIMIT) return false;
      storage.setItem(key(uid), raw);
      // Another page can erase this UID between our initial check and setItem.
      // Remove only this writer's late copy when that terminal marker appears.
      // localStorage has no cross-page transaction: if this process is killed
      // before this postcheck, residual bytes can remain, but the terminal
      // marker still blocks their recovery and every subsequent normal save.
      if (erased(uid)) { memory.delete(uid); storage.removeItem(key(uid)); return false; }
      return storage.getItem(key(uid)) === raw;
    } catch { return false; }
  }
  function removeOwn(uid) { memory.delete(uid); try { storage.removeItem(key(uid)); } catch { /* No other page's key is touched. */ } }
  function close(uid) {
    const oldKey = key(uid);
    try {
      const record = parse(storage.getItem(oldKey), uid);
      if (record && !erased(uid)) {
        const raw = JSON.stringify({ ...record, closed: true });
        if (bytes(raw) <= RECORD_LIMIT) {
          storage.setItem(oldKey, raw);
          if (erased(uid)) { memory.delete(uid); storage.removeItem(oldKey); }
        }
      }
    } catch { /* The previous durable copy remains; never falsely mark it closed. */ }
    // A sealed key is immutable, including after BFCache restoration or a late
    // async acknowledgment. Every future write uses a fresh writer identity.
    tabId = globalThis.crypto.randomUUID();
  }
  function prune(uid, generation, confirmed) {
    try {
      const own = parse(storage.getItem(key(uid)), uid);
      if (!own || own.generation !== generation || own.closed) return;
      for (const { key: name, record } of entries(uid)) {
        if (name !== key(uid) && record.closed === true && record.generation === generation
          && !hasChanges(uncoveredChanges(record.pending, confirmed))
          && !hasChanges(uncoveredChanges(record.snapshot, own.snapshot))) storage.removeItem(name);
      }
    } catch { /* No pruning is needed for correctness; preserve every uncertain copy. */ }
  }
  function erase(uid) {
    erasedMemory.add(uid); memory.delete(uid);
    let complete = true;
    try { storage.setItem(erasedKey(uid), JSON.stringify({ version: 2, uid, erased: true })); }
    catch { complete = false; }
    // This is explicit account erasure, not normal queue acknowledgment or
    // logout. The terminal marker prevents every older writer from returning.
    try {
      const names = [];
      for (let index = 0; index < storage.length; index++) {
        const name = storage.key(index);
        if (name?.startsWith(`${prefix}${encodeURIComponent(uid)}:`)) names.push(name);
      }
      names.push(key(uid), ...['', ':generation', ':pending'].map(suffix => `${baseKey}:account:${encodeURIComponent(uid)}${suffix}`));
      for (const name of names) storage.removeItem(name);
    } catch { complete = false; }
    return complete;
  }
  return { key, entries, save, removeOwn, close, prune, parse, prefix, erasedKey, erased, erase,
    persisted(uid, generation, pending) {
      try {
        const record = parse(storage.getItem(key(uid)), uid);
        return !!record && record.generation === generation && !hasChanges(uncoveredChanges(pending, record.pending));
      } catch { return false; }
    }
  };
}
