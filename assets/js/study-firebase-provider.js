// This module is loaded only after the site's explicit Firebase opt-in.
import { initializeApp, getApps, deleteApp } from 'firebase/app';
import { initializeAuth, getAuth, browserSessionPersistence, browserPopupRedirectResolver, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, deleteUser, reauthenticateWithPopup, connectAuthEmulator } from 'firebase/auth';
import { initializeFirestore, getFirestore, memoryLocalCache, doc, collection, query, limit, getDocsFromServer, runTransaction, serverTimestamp, writeBatch, connectFirestoreEmulator, terminate } from 'firebase/firestore';
import { createAppCheckGate } from './study-app-check.js';
import { emptyProgress, mergeProgress, serializeProgress } from '../../static/js/study-progress.js';

const registry = __STUDY_CATALOG__;
const MAX_ERASURE_CLASSES = 200;
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
export async function createFirebaseProvider(config, { courseId = 'lucas', emulator, appCheck } = {}) {
  if (!registry[courseId] || !config || !['apiKey','authDomain','projectId','appId'].every(k => typeof config[k] === 'string' && config[k].length > 0)) throw error(400, 'invalid-firebase-config');
  if (emulator && (!config.projectId.startsWith('demo-') || !['localhost','127.0.0.1'].includes(globalThis.location?.hostname))) throw error(400, 'unsafe-emulator');
  // Firebase's session-storage key contains app.name: keep it stable across reloads.
  const name = `study-${config.projectId}-${courseId}`;
  const existing = getApps().find(candidate => candidate.name === name);
  const app = existing || initializeApp(config, name);
  const gate = createAppCheckGate(app, appCheck);
  const auth = existing ? getAuth(app) : initializeAuth(app, { persistence: browserSessionPersistence, popupRedirectResolver: browserPopupRedirectResolver });
  const db = existing ? getFirestore(app) : initializeFirestore(app, { localCache: memoryLocalCache() });
  if (emulator && !existing) { connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }); connectFirestoreEmulator(db, '127.0.0.1', 8085); }
  await auth.authStateReady();
  let baseline, cacheEpoch = 0, cacheSubject = auth.currentUser?.uid;
  const clearBaseline = () => { baseline = undefined; cacheEpoch++; };
  const stopCacheAuth = onAuthStateChanged(auth, () => {
    const subject = auth.currentUser?.uid;
    if (subject !== cacheSubject) { clearBaseline(); cacheSubject = subject; }
  });
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
  async function discoverClasses(uid, course) {
    user(uid);
    // A server-only, bounded query also discovers classes retired from the
    // current catalog. Never mistake an offline cache for completed erasure.
    const snapshot = await getDocsFromServer(query(collection(db, 'students', uid, 'guides', course, 'classes'), limit(MAX_ERASURE_CLASSES + 1)));
    user(uid);
    if (snapshot.size > MAX_ERASURE_CLASSES) throw error(413, 'too-many-classes-to-erase');
    return snapshot.docs.map(item => item.ref);
  }
  const signature = h => canonical(h ? Object.fromEntries(['schema','revision','generation','resetCount','deleted','selected','lastActivity'].filter(key => own(h, key)).map(key => [key, h[key]])) : null);
  function envelope(h, classes) {
    if (!h) return emptyEnvelope();
    if (h.deleted) return { revision: h.revision, generation: h.generation, deleted: true, progress: null };
    const progress = { version: 1, classes: {} };
    for (const field of ['selected','lastActivity']) if (own(h, field)) progress[field] = h[field];
    for (const [id, value] of Object.entries(classes)) if (value && value.generation === h.generation) { const { schema, generation, ...lesson } = value; progress.classes[id] = lesson; }
    return { revision: h.revision, generation: h.generation, deleted: false, progress };
  }
  async function readOrMutate(expected, method, input, inspectOnly = false) {
    const captured = user(expected).uid, r = refs(captured);
    if (method !== 'GET') {
      if (!keys(input, method === 'DELETE' ? ['revision','generation'] : ['revision','generation','progress']) || !Number.isSafeInteger(input.revision) || input.revision < 0 || input.revision >= 2147483647 || !(input.generation === null || typeof input.generation === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.generation))) throw error(400, 'invalid-request');
      if (['PUT','PATCH'].includes(method)) validate(input.progress, catalog);
      // The caller can keep editing its local state while the transaction runs.
      input = structuredClone(input);
    }
    await gate.ensure();
    user(captured);
    const discovered = method === 'DELETE' && !inspectOnly ? await discoverClasses(captured, courseId) : [];
    const capturedEpoch = cacheEpoch;
    const committed = await runTransaction(db, async tx => {
      user(captured); // Rechecked on every SDK transaction retry; rules remain authoritative.
      const marker = await tx.get(r.marker);
      if (marker.exists()) throw error(410, 'account-erasure-in-progress', { ...emptyEnvelope(), deleted: true });
      const head = await tx.get(r.header);
      const old = head.exists() ? head.data() : undefined;
      const sameCAS = method === 'GET' || (input.generation === (old?.generation ?? null) && (method === 'PATCH' ? input.revision <= (old?.revision ?? 0) : input.revision === (old?.revision ?? 0)));
      const reusable = method !== 'DELETE' && !inspectOnly && sameCAS && baseline?.subject === captured && baseline.signature === signature(old);
      // Every committed class change also advances its header. A matching
      // owner/header therefore identifies our last confirmed remote baseline.
      // Keep physical documents, including old-generation ones, so a PUT may
      // never silently omit an existing class.
      const classes = reusable ? baseline.classes : Object.fromEntries(await Promise.all(Object.entries(r.classes).map(async ([id, ref]) => {
        const snapshot = await tx.get(ref);
        return [id, snapshot.exists() ? snapshot.data() : undefined];
      })));
      user(captured);
      const current = envelope(old, classes);
      if (method === 'GET') return { result: current, header: old, classes };
      if (current.generation !== input.generation) {
        const status = input.generation === null && old && !old.deleted && old.resetCount === 0 ? 409 : 410;
        throw error(status, status === 410 ? 'reset' : 'conflict', current);
      }
      if (input.revision !== current.revision && (method !== 'PATCH' || inspectOnly || input.revision > current.revision)) throw error(409, 'conflict', current);
      if (inspectOnly) return null;
      let progress = input.progress;
      if (method === 'PATCH') {
        const remote = current.progress || emptyProgress();
        // Missing fields are not deletions. Ignore empty class containers and
        // apply the shared per-field clock/tie rule to canonical leaf objects.
        const delta = structuredClone(input.progress);
        for (const [id, lesson] of Object.entries(delta.classes)) if (Object.keys(lesson).length === 1 && Object.keys(lesson.blocks).length === 0) delete delta.classes[id];
        progress = mergeProgress(JSON.parse(serializeProgress(remote)), JSON.parse(serializeProgress(delta)));
        validate(progress, catalog);
        if (serializeProgress(progress) === serializeProgress(remote)) return { result: current, header: old, classes };
      }
      const removed = method === 'DELETE', generation = removed ? crypto.randomUUID() : current.generation || crypto.randomUUID();
      const h = { schema: 1, generation, revision: current.revision + 1, resetCount: (old?.resetCount || 0) + (removed ? 1 : 0), deleted: removed, updatedAt: serverTimestamp() };
      const nextClasses = { ...classes };
      if (!removed) for (const name of ['selected','lastActivity']) if (own(progress, name)) h[name] = progress[name];
      tx.set(r.header, h);
      for (const [id, ref] of Object.entries(r.classes)) {
        const next = !removed && progress.classes[id];
        if (next) {
          const value = { schema: 1, generation, ...next };
          if (!classes[id] || canonical(classes[id]) !== canonical(value)) tx.set(ref, value);
          nextClasses[id] = value;
        } else if (classes[id]) {
          // A PUT never silently deletes an existing lesson: merges happen in the caller.
          if (!removed) { if (method === 'PATCH') continue; throw error(400, 'missing-existing-class'); }
          tx.delete(ref);
          nextClasses[id] = undefined;
        }
      }
      // Current classes were read inside the transaction, covering creations
      // after discovery. Rules prohibit creation of unknown retired IDs.
      if (removed) for (const ref of discovered) if (!own(r.classes, ref.id)) tx.delete(ref);
      return { result: { revision: h.revision, generation, deleted: removed, progress: removed ? null : progress }, header: h, classes: nextClasses };
    }, { maxAttempts: 3 });
    // Never publish a tentative callback (Firestore may retry it), nor share
    // mutable objects with a caller or a subsequent authentication session.
    user(captured);
    if (capturedEpoch === cacheEpoch && committed) baseline = { subject: captured, signature: signature(committed.header), classes: structuredClone(committed.classes) };
    return committed ? structuredClone(committed.result) : null;
  }
  async function eraseAccount(expected) {
    clearBaseline();
    const u = user(expected), uid = u.uid;
    await reauthenticateWithPopup(u, google());
    user(uid);
    await gate.ensure();
    user(uid);
    const marker = doc(db, 'students', uid);
    await runTransaction(db, async tx => { user(uid); if (!(await tx.get(marker)).exists()) tx.set(marker, { schema: 1, erasedAt: serverTimestamp() }); }, { maxAttempts: 3 });
    // The immutable lock prevents stale ID tokens from resurrecting any guide.
    const courses = [];
    for (const course of Object.keys(registry)) courses.push({ course, classes: await discoverClasses(uid, course) });
    for (const { course, classes } of courses) {
      user(uid);
      const batch = writeBatch(db);
      batch.delete(doc(db, 'students', uid, 'guides', course));
      for (const ref of classes) batch.delete(ref);
      await batch.commit();
      user(uid);
    }
    user(uid);
    await deleteUser(u);
    return { ok: true, deleted: true };
  }
  async function request(path, method = 'GET', body, expectedUID) {
    try {
      if (path === 'session' && method === 'GET') return session();
      if (path === 'auth/login' && method === 'POST') { await signInWithPopup(auth, google()); return session(); }
      if (path === 'auth/logout' && method === 'POST') { if (expectedUID) user(expectedUID); clearBaseline(); await signOut(auth); return { ok: true }; }
      if (path === 'account/delete' && method === 'DELETE') return await eraseAccount(expectedUID);
      if (path === 'progress' && ['GET','PUT','PATCH','DELETE'].includes(method)) return await readOrMutate(expectedUID, method, body);
      if (path === 'progress/export' && method === 'GET') return await readOrMutate(expectedUID, 'GET');
      throw error(404, 'unknown-operation');
    } catch (e) {
      if (e.status) throw e;
      // Rules may reject a stale CAS commit before the SDK reports ABORTED.
      // Inspect once, through the same authenticated owner's rules, and classify
      // only an observed revision/epoch change. Unrelated rule denials stay 403.
      if (e.code === 'permission-denied' && path === 'progress' && ['PUT','PATCH','DELETE'].includes(method)) {
        try { await readOrMutate(expectedUID, method, body, true); }
        catch (inspection) { if ([409,410].includes(inspection.status)) throw inspection; }
      }
      const status = e.code === 'resource-exhausted' ? 429 : ['permission-denied','auth/user-disabled'].includes(e.code) ? 403 : ['unauthenticated','auth/user-token-expired','auth/invalid-user-token'].includes(e.code) ? 401 : 503;
      throw error(status, e.code || 'firebase-unavailable');
    }
  }
  return { request, subscribeUser(callback) { return onAuthStateChanged(auth, () => callback(session())); }, async dispose() { stopCacheAuth(); clearBaseline(); await terminate(db); await deleteApp(app); } };
}
