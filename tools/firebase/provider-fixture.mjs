import { createFirebaseProvider } from '../../assets/js/study-firebase-provider.js';
import { createSync } from '../../static/js/study-sync.js';
import { emptyProgress, updateProgress } from '../../static/js/study-progress.js';
import { getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithCredential, reauthenticateWithCredential } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, getFirestore } from 'firebase/firestore';

const config = { apiKey: 'demo-not-a-real-key', authDomain: 'demo-lasnotasdevero.firebaseapp.com', projectId: 'demo-lasnotasdevero', appId: 'demo-app-id' };
export async function startFixture(subject, signIn = true) {
  const provider = await createFirebaseProvider(config, { courseId: 'lucas', emulator: true });
  const auth = getAuth(getApps().find((app) => app.name === 'study-demo-lasnotasdevero-lucas'));
  const credential = () => {
    const seconds = Math.floor(Date.now() / 1000);
    const jwt = [{ alg: 'none', typ: 'JWT' }, { sub: subject, email: `${subject}@example.invalid`, email_verified: true, aud: config.projectId, iss: 'https://accounts.google.com', iat: seconds, exp: seconds + 3600 }]
      .map((value) => btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')).join('.') + '.';
    return GoogleAuthProvider.credential(jwt);
  };
  if (signIn) await signInWithCredential(auth, credential());
  // Only the instrumented emulator bundle substitutes the popup with this
  // real SDK reauthentication against the loopback Auth Emulator.
  globalThis.__providerTestReauthenticate = user => reauthenticateWithCredential(user, credential());
  const session = await provider.request('session');
  if (!session.authenticated) throw Error('fixture-not-authenticated');
  const catalog = Object.entries(__STUDY_CATALOG__.lucas).map(([id, value]) => ({ id, ...value }));
  let state = emptyProgress();
  const controller = { snapshot: () => structuredClone(state), activate(_key, value) { state = value; }, replace(value) { state = value; } };
  const sync = createSync({ controller, catalog, provider, status: () => {}, delay: 60000 });
  const resetMetrics = () => { globalThis.__providerMetrics = { reads: [], writes: [] }; };
  const metrics = () => structuredClone(globalThis.__providerMetrics || { reads: [], writes: [] });
  resetMetrics();
  await sync.connect(false);
  const current = () => provider.request('progress', 'GET', undefined, session.subject);
  const patchQuestion = (base, lessonIndex, questionIndex, value, timestamp = Date.now()) => {
    const { id, questions } = catalog[lessonIndex];
    return provider.request('progress', 'PATCH', { revision: base.revision, generation: base.generation,
      progress: { version: 1, classes: { [id]: { blocks: { [questions[questionIndex]]: { value, updatedAt: timestamp } } } } } }, session.subject);
  };
  const seedAllClasses = async () => {
    const timestamp = Date.now();
    for (let i = 0; i < catalog.length; i++) state = updateProgress(state, catalog[i].id, 'block', true, timestamp + i, catalog[i].questions[0]);
    sync.changed();
    return sync.flush();
  };
  const markQuestion = async (lessonIndex, questionIndex, value = true, timestamp = Date.now()) => {
    const { id, questions } = catalog[lessonIndex];
    state = updateProgress(state, id, 'block', value, timestamp, questions[questionIndex]);
    sync.changed();
    return sync.flush();
  };
  const directRead = async (uid) => {
    const db = getFirestore(auth.app);
    return getDoc(doc(db, 'students', uid, 'guides', 'lucas'));
  };
  const classes = async () => {
    const db = getFirestore(auth.app);
    const snapshot = await getDocs(collection(db, 'students', session.subject, 'guides', 'lucas', 'classes'));
    return snapshot.docs.map((item) => { const timestamp = item._document?.version?.timestamp; return { id: item.id, data: item.data(), version: timestamp ? [timestamp.seconds, timestamp.nanoseconds] : undefined }; });
  };
  return { subject: session.subject, catalog, current, seedAllClasses, markQuestion, patchQuestion, classes, sync, directRead, metrics, resetMetrics, request: (...args) => provider.request(...args) };
}
