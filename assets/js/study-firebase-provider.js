// This module is loaded only after the site's explicit Firebase opt-in.
import { initializeApp, getApps, deleteApp } from 'firebase/app';
import { initializeAuth, getAuth, browserSessionPersistence, browserPopupRedirectResolver, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, deleteUser, reauthenticateWithPopup, connectAuthEmulator } from 'firebase/auth';
import { initializeFirestore, getFirestore, memoryLocalCache, doc, runTransaction, serverTimestamp, writeBatch, connectFirestoreEmulator, terminate } from 'firebase/firestore';

const registry = __STUDY_CATALOG__;
const error = (status, message, data) => Object.assign(new Error(message), { status, data });
const emptyEnvelope = () => ({ revision: 0, generation: null, progress: null, deleted: false });
const own = (o, k) => Object.hasOwn(o, k);
const plain = o => o !== null && typeof o === 'object' && !Array.isArray(o) && [Object.prototype, null].includes(Object.getPrototypeOf(o));
const canonical = value => JSON.stringify(value, (_key, item) => plain(item) ? Object.fromEntries(Object.entries(item).sort(([a],[b]) => a.localeCompare(b))) : item);
const keys = (o, allowed) => plain(o) && Object.keys(o).every(k => allowed.includes(k));
const clock = t => Number.isSafeInteger(t) && t >= 0 && t <= Date.now() + 300000;
function validate(progress, catalog) {
  if (!keys(progress, ['version', 'classes', 'selected', 'lastActivity']) || progress.version !== 1 || !keys(progress.classes, Object.keys(catalog)) || new TextEncoder().encode(JSON.stringify(progress)).byteLength > 32768) throw error(400, 'invalid-progress');
  const leaf = (value, type, choices) => keys(value, ['value', 'updatedAt']) && own(value, 'value') && clock(value.updatedAt) && typeof value.value === type && (type !== 'number' || clock(value.value)) && (!choices || choices.includes(value.value));
  for (const name of ['selected', 'lastActivity']) if (own(progress, name) && !leaf(progress[name], name === 'selected' ? 'string' : 'number', name === 'selected' ? Object.keys(catalog) : undefined)) throw error(400, 'invalid-progress');
  for (const [id, lesson] of Object.entries(progress.classes)) {
    if (!keys(lesson, ['blocks', 'complete', 'lastPoint', 'lastActivity']) || !keys(lesson.blocks, catalog[id].questions)) throw error(400, 'invalid-class');
    for (const block of Object.values(lesson.blocks)) if (!leaf(block, 'boolean')) throw error(400, 'invalid-block');
    for (const [name, type] of [['complete', 'boolean'], ['lastPoint', 'string'], ['lastActivity', 'number']]) if (own(lesson, name) && !leaf(lesson[name], type, name === 'lastPoint' ? catalog[id].points : undefined)) throw error(400, 'invalid-class');
  }
}
export async function createFirebaseProvider(config, { courseId = 'lucas', emulator } = {}) {
  if (!registry[courseId] || !config || !['apiKey','authDomain','projectId','appId'].every(k => typeof config[k] === 'string' && config[k].length > 0)) throw error(400, 'invalid-firebase-config');
  if (emulator && (!config.projectId.startsWith('demo-') || !['localhost','127.0.0.1'].includes(globalThis.location?.hostname))) throw error(400, 'unsafe-emulator');
  // Firebase's session-storage key contains app.name: keep it stable across reloads.
  const name = `study-${config.projectId}-${courseId}`;
  const existing = getApps().find(candidate => candidate.name === name);
  const app = existing || initializeApp(config, name);
  const auth = existing ? getAuth(app) : initializeAuth(app, { persistence: browserSessionPersistence, popupRedirectResolver: browserPopupRedirectResolver });
  const db = existing ? getFirestore(app) : initializeFirestore(app, { localCache: memoryLocalCache() });
  if (emulator && !existing) { connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }); connectFirestoreEmulator(db, '127.0.0.1', 8085); }
  await auth.authStateReady();
  const catalog = registry[courseId];
  const google = () => { const provider = new GoogleAuthProvider(); provider.setCustomParameters({ prompt: 'select_account' }); return provider; };
  const session = () => ({ authenticated: !!auth.currentUser, ...(auth.currentUser ? { subject: auth.currentUser.uid } : {}) });
  function user(expected) {
    const u = auth.currentUser;
    if (!u) throw error(401, 'sign-in-required');
    if (expected !== u.uid) throw error(403, 'account-changed');
    return u;
  }
  const refs = uid => ({ marker: doc(db, 'students', uid), header: doc(db, 'students', uid, 'guides', courseId), classes: Object.fromEntries(Object.keys(catalog).map(id => [id, doc(db, 'students', uid, 'guides', courseId, 'classes', id)])) });
  function envelope(header, snapshots) {
    if (!header.exists()) return emptyEnvelope();
    const h = header.data();
    if (h.deleted) return { revision: h.revision, generation: h.generation, deleted: true, progress: null };
    const progress = { version: 1, classes: {} };
    for (const field of ['selected','lastActivity']) if (own(h, field)) progress[field] = h[field];
    for (const [id, snap] of Object.entries(snapshots)) if (snap.exists() && snap.data().generation === h.generation) { const { schema, generation, ...lesson } = snap.data(); progress.classes[id] = lesson; }
    return { revision: h.revision, generation: h.generation, deleted: false, progress };
  }
  async function readOrMutate(expected, method, input, inspectOnly = false) {
    const captured = user(expected).uid, r = refs(captured);
    if (method !== 'GET') {
      if (!keys(input, method === 'DELETE' ? ['revision','generation'] : ['revision','generation','progress']) || !Number.isSafeInteger(input.revision) || input.revision < 0 || input.revision >= 2147483647 || !(input.generation === null || typeof input.generation === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.generation))) throw error(400, 'invalid-request');
      if (method === 'PUT') validate(input.progress, catalog);
    }
    return runTransaction(db, async tx => {
      user(captured); // Rechecked on every SDK transaction retry; rules remain authoritative.
      const marker = await tx.get(r.marker);
      if (marker.exists()) throw error(410, 'account-erasure-in-progress', { ...emptyEnvelope(), deleted: true });
      const head = await tx.get(r.header);
      const snapshots = Object.fromEntries(await Promise.all(Object.entries(r.classes).map(async ([id, ref]) => [id, await tx.get(ref)])));
      user(captured);
      const current = envelope(head, snapshots), old = head.exists() ? head.data() : undefined;
      if (method === 'GET') return current;
      if (current.generation !== input.generation) {
        const status = input.generation === null && old && !old.deleted && old.resetCount === 0 ? 409 : 410;
        throw error(status, status === 410 ? 'reset' : 'conflict', current);
      }
      if (input.revision !== current.revision) throw error(409, 'conflict', current);
      if (inspectOnly) return null;
      const removed = method === 'DELETE', generation = removed ? crypto.randomUUID() : current.generation || crypto.randomUUID();
      const h = { schema: 1, generation, revision: current.revision + 1, resetCount: (old?.resetCount || 0) + (removed ? 1 : 0), deleted: removed, updatedAt: serverTimestamp() };
      if (!removed) for (const name of ['selected','lastActivity']) if (own(input.progress, name)) h[name] = input.progress[name];
      tx.set(r.header, h);
      for (const [id, ref] of Object.entries(r.classes)) {
        const next = !removed && input.progress.classes[id];
        if (next) {
          const value = { schema: 1, generation, ...next };
          if (!snapshots[id].exists() || canonical(snapshots[id].data()) !== canonical(value)) tx.set(ref, value);
        } else if (snapshots[id].exists()) {
          // A PUT never silently deletes an existing lesson: merges happen in the caller.
          if (!removed) throw error(400, 'missing-existing-class');
          tx.delete(ref);
        }
      }
      return { revision: h.revision, generation, deleted: removed, progress: removed ? null : input.progress };
    }, { maxAttempts: 3 });
  }
  async function eraseAccount(expected) {
    const u = user(expected), uid = u.uid;
    await reauthenticateWithPopup(u, google());
    user(uid);
    const marker = doc(db, 'students', uid);
    await runTransaction(db, async tx => { user(uid); if (!(await tx.get(marker)).exists()) tx.set(marker, { schema: 1, erasedAt: serverTimestamp() }); }, { maxAttempts: 3 });
    // The immutable lock prevents stale ID tokens from resurrecting any guide.
    const batch = writeBatch(db);
    for (const [course, classes] of Object.entries(registry)) {
      batch.delete(doc(db, 'students', uid, 'guides', course));
      for (const id of Object.keys(classes)) batch.delete(doc(db, 'students', uid, 'guides', course, 'classes', id));
    }
    user(uid);
    await batch.commit();
    user(uid);
    await deleteUser(u);
    return { ok: true, deleted: true };
  }
  async function request(path, method = 'GET', body, expectedUID) {
    try {
      if (path === 'session' && method === 'GET') return session();
      if (path === 'auth/login' && method === 'POST') { await signInWithPopup(auth, google()); return session(); }
      if (path === 'auth/logout' && method === 'POST') { if (expectedUID) user(expectedUID); await signOut(auth); return { ok: true }; }
      if (path === 'account/delete' && method === 'DELETE') return await eraseAccount(expectedUID);
      if (path === 'progress' && ['GET','PUT','DELETE'].includes(method)) return await readOrMutate(expectedUID, method, body);
      if (path === 'progress/export' && method === 'GET') return await readOrMutate(expectedUID, 'GET');
      throw error(404, 'unknown-operation');
    } catch (e) {
      if (e.status) throw e;
      // Rules may reject a stale CAS commit before the SDK reports ABORTED.
      // Inspect once, through the same authenticated owner's rules, and classify
      // only an observed revision/epoch change. Unrelated rule denials stay 403.
      if (e.code === 'permission-denied' && path === 'progress' && ['PUT','DELETE'].includes(method)) {
        try { await readOrMutate(expectedUID, method, body, true); }
        catch (inspection) { if ([409,410].includes(inspection.status)) throw inspection; }
      }
      const status = e.code === 'resource-exhausted' ? 429 : ['permission-denied','auth/user-disabled'].includes(e.code) ? 403 : ['unauthenticated','auth/user-token-expired','auth/invalid-user-token'].includes(e.code) ? 401 : 503;
      throw error(status, e.code || 'firebase-unavailable');
    }
  }
  return { request, subscribeUser(callback) { return onAuthStateChanged(auth, () => callback(session())); }, async dispose() { await terminate(db); await deleteApp(app); } };
}
