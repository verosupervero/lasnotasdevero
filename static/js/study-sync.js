import { STORAGE_KEY, emptyProgress, parseProgress, mergeProgress, serializeProgress } from './study-progress.js';

const MAX_FILE_BYTES = 65536;
export function readImport(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw Error('invalid');
  const parsed = parseProgress(text);
  if (parsed.status !== 'ready') throw Error('invalid');
  return parsed.state;
}

// Only fields represented by the current course are sent to the server.
// Retired/local-only records remain in the browser, never in the cloud payload.
export function cloudProgress(state, catalog) {
  const output = emptyProgress();
  const leaf = (record) => ({ value: record.value, updatedAt: record.updatedAt });
  for (const item of catalog) {
    const source = state.classes[item.id];
    if (!source) continue;
    const lesson = { blocks: {} };
    for (const field of ['complete', 'lastActivity']) if (source[field]) lesson[field] = leaf(source[field]);
    if (source.lastPoint && item.points.includes(source.lastPoint.value)) lesson.lastPoint = leaf(source.lastPoint);
    for (const id of item.questions) if (source.blocks[id]) lesson.blocks[id] = leaf(source.blocks[id]);
    output.classes[item.id] = lesson;
  }
  if (state.selected && catalog.some((item) => item.id === state.selected.value)) output.selected = leaf(state.selected);
  if (state.lastActivity) output.lastActivity = leaf(state.lastActivity);
  return output;
}

export function createSync({ controller, catalog, provider, baseKey = STORAGE_KEY, storage = localStorage, schedule = setTimeout, cancel = clearTimeout, status = () => {}, delay = 7000 }) {
  let account, lastVerifiedSubject, envelope, timer, dirty = false, stopped = false, attempts = 0, context = 0;
  const running = new Set();
  const keyFor = (subject) => `${baseKey}:account:${encodeURIComponent(subject)}`;
  const generationKey = (subject) => `${keyFor(subject)}:generation`;
  function rememberGeneration(value) { try { storage.setItem(generationKey(account), JSON.stringify(value)); } catch { /* Local storage can be unavailable. */ } }
  const read = (key) => { try { return parseProgress(storage.getItem(key)).state; } catch { return emptyProgress(); } };
  const clearTimer = () => { if (timer) cancel(timer); timer = undefined; };
  async function request(path, method = 'GET', body, expectedAccount = account) {
    let timeout;
    try {
      const data = ['auth/login', 'account/delete'].includes(path) ? await provider.request(path, method, body, expectedAccount) : await Promise.race([
        provider.request(path, method, body, expectedAccount),
        new Promise((_, reject) => { timeout = schedule(() => reject(Error('timeout')), 12000); })
      ]);
      if (path === 'session' && data.authenticated && typeof data.subject === 'string') lastVerifiedSubject = data.subject;
      return data;
    } finally { cancel(timeout); }
  }

  function queue(wait = delay) {
    if (!account || stopped || timer || running.has(context) || !dirty) return;
    timer = schedule(() => { timer = undefined; flush(); }, wait);
  }
  function changed() { if (!account) return; dirty = true; attempts = 0; queue(); }
  function resetRemote(next) {
    envelope = next;
    dirty = false; stopped = true;
    rememberGeneration(next.generation);
    controller.activate(keyFor(account), emptyProgress());
    status('El progreso de la cuenta fue eliminado. Tu avance anterior no se volverá a subir.');
  }
  async function flush() {
    if (!account || stopped || running.has(context) || !dirty) return;
    clearTimer();
    let retryDelay;
    const token = context;
    running.add(token);
    const sent = cloudProgress(controller.snapshot(), catalog);
    dirty = false;
    try {
      const result = await request('progress', 'PUT', { revision: envelope.revision, generation: envelope.generation, progress: sent });
      if (token !== context) return;
      envelope = result; attempts = 0;
      rememberGeneration(result.generation);
      if (result.progress) controller.activate(keyFor(account), mergeProgress(controller.snapshot(), result.progress));
      status(dirty ? 'Guardado en este dispositivo; sincronización próxima.' : 'Sincronizado');
    } catch (error) {
      if (token !== context) return;
      dirty = true;
      if (error.status === 410) resetRemote(error.data.current || error.data);
      else if (error.status === 409 && attempts < 3) {
        const remote = error.data.current || error.data;
        // The server classifies actual generation resets as 410. A 409 can
        // include the first generation created concurrently by another device.
        envelope = remote;
        rememberGeneration(remote.generation);
        controller.activate(keyFor(account), mergeProgress(controller.snapshot(), remote.progress || emptyProgress()));
        attempts++; retryDelay = 1000 * attempts;
      } else if (error.status === 401 || error.status === 403) { stopped = true; status('Tu sesión terminó. El avance sigue guardado en este dispositivo.'); }
      else if (error.status === 429) { stopped = true; status('Se alcanzó un límite de sincronización. Tu avance sigue en este dispositivo; reintentá más tarde.'); }
      else if (error.status === 400 || error.status === 422) { stopped = true; status('No pudimos sincronizar este avance. Se conserva en este dispositivo.'); }
      else {
        status('Sin conexión: guardado en este dispositivo');
        if (attempts < 3) { attempts++; retryDelay = 15000 * 2 ** (attempts - 1); }
      }
    } finally {
      running.delete(token);
      if (token === context && dirty && !stopped) {
        if (retryDelay !== undefined) queue(retryDelay);
        else if (attempts === 0) queue();
      }
    }
  }
  async function connect(useLocal) {
    clearTimer();
    const token = ++context;
    const session = await request('session');
    if (token !== context) return;
    if (!session.authenticated || typeof session.subject !== 'string') throw Error('session');
    let remote;
    try { remote = await request('progress', 'GET', undefined, session.subject); }
    catch (error) {
      // Only the SDK-verified owner's existing copy may be opened offline.
      // No remote revision is invented; reconnect must validate its epoch.
      if (error.status && error.status !== 429 && error.status < 500) throw error;
      const currentSession = await request('session');
      if (token !== context || !currentSession.authenticated || currentSession.subject !== session.subject) throw Error('session');
      let cached;
      try {
        const raw = storage.getItem(keyFor(session.subject));
        const parsed = parseProgress(raw);
        if (!raw || parsed.status !== 'ready') throw Error('cache');
        cached = parsed.state;
      } catch { throw error; }
      if (token !== context) return;
      account = session.subject; envelope = undefined; stopped = true; dirty = false; attempts = 0;
      controller.activate(keyFor(account), cached);
      status('Avance de tu cuenta guardado en este dispositivo. Sincronizaci\u00f3n pausada; reconect\u00e1 para comprobar el avance remoto.' + (useLocal ? ' No incorporamos todav\u00eda el avance sin cuenta; queda guardado por separado.' : ''));
      return;
    }
    if (token !== context) return;
    const local = account ? read(baseKey) : controller.snapshot();
    account = session.subject; envelope = remote; stopped = false; attempts = 0; dirty = false;
    // Deleted generations never import a cached copy automatically.
    let sameGeneration = false;
    try { sameGeneration = storage.getItem(generationKey(account)) === JSON.stringify(remote.generation); } catch { /* No cached generation. */ }
    let progress = remote.deleted ? emptyProgress() : mergeProgress(sameGeneration ? read(keyFor(account)) : emptyProgress(), remote.progress || emptyProgress());
    if (useLocal) progress = mergeProgress(progress, local);
    rememberGeneration(remote.generation);
    controller.activate(keyFor(account), progress);
    dirty = useLocal || (!remote.deleted && serializeProgress(cloudProgress(progress, catalog)) !== serializeProgress(remote.progress || emptyProgress()));
    status(dirty ? 'Guardado en este dispositivo; sincronización próxima.' : 'Sincronizado');
    queue();
  }
  function detach() {
    clearTimer(); context++; stopped = true; dirty = false;
    const previous = account || lastVerifiedSubject; account = undefined; lastVerifiedSubject = undefined; envelope = undefined;
    if (previous) { try { storage.removeItem(keyFor(previous)); storage.removeItem(generationKey(previous)); } catch { /* Memory-only remains usable. */ } }
    controller.activate(baseKey, read(baseKey));
    status('Guardado en este navegador');
  }
  async function logout() {
    const subject = account || lastVerifiedSubject;
    detach();
    await request('auth/logout', 'POST', {}, subject);
  }
  async function remove() {
    if (!account || !envelope) throw Error('reconnect');
    clearTimer(); const token = ++context; dirty = false; stopped = true;
    const result = await request('progress', 'DELETE', { revision: envelope.revision, generation: envelope.generation });
    if (token !== context) return;
    envelope = result;
    rememberGeneration(result.generation);
    controller.activate(keyFor(account), emptyProgress());
    stopped = false;
    status('Progreso de la cuenta eliminado.');
  }
  async function removeAccount() {
    clearTimer(); const token = ++context; dirty = false; stopped = true;
    // Erasure recovery must work even when a prior erasure lock prevents
    // opening a progress profile. Resolve identity directly from the SDK.
    const session = await request('session');
    if (token !== context || !session.authenticated || typeof session.subject !== 'string') throw Error('session');
    await request('account/delete', 'DELETE', {}, session.subject);
    if (token === context) detach();
  }
  function authenticationChanged(session) {
    if (((account || lastVerifiedSubject) && (account || lastVerifiedSubject) !== session.subject) || (!session.authenticated && lastVerifiedSubject)) detach();
    if (session.authenticated && typeof session.subject === 'string') lastVerifiedSubject = session.subject;
  }
  return { request, connect, logout, remove, removeAccount, authenticationChanged, changed, flush, retry() { if (account && !stopped) { attempts = 0; queue(0); } }, get connected() { return !!account; }, get cloudReady() { return !!account && !!envelope && !stopped; } };
}

export function progressStorageKey(courseId = 'lucas') {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(courseId)) throw Error('course');
  return courseId === 'lucas' ? STORAGE_KEY : `lasnotasdevero:${courseId}:progress:v1`;
}

export async function initializeSync(root, controller, catalog) {
  const card = root.querySelector('#study-account');
  if (!card) return;
  card.hidden = false;
  const courseId = root.dataset.courseId || 'lucas';
  const message = card.querySelector('[data-account-status]');
  const tell = (text) => { message.textContent = controller.canPersist && !controller.canPersist() ? `${text} El navegador no permite guardar una copia local; conservá esta pestaña abierta o exportá tu avance.` : text; };
  const download = (state) => {
    const url = URL.createObjectURL(new Blob([serializeProgress(state)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `mi-avance-${courseId}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  card.querySelector('[data-progress-export]').addEventListener('click', () => download(controller.snapshot()));
  card.querySelector('[data-progress-import]').addEventListener('change', async (event) => {
    try {
      const file = event.target.files[0];
      if (!file || file.size > MAX_FILE_BYTES) throw Error('file');
      controller.replace(mergeProgress(controller.snapshot(), readImport(await file.text())));
      tell('Avance importado en este navegador.');
    } catch { tell('No pudimos importar ese archivo de avance.'); }
    event.target.value = '';
  });
  const localReset = card.querySelector('[data-progress-reset]');
  localReset.addEventListener('click', () => {
    if (confirm('¿Borrar el avance de este navegador? Esta acción no se puede deshacer.')) { controller.replace(emptyProgress(), true); tell('Avance local eliminado.'); }
  });
  // No config fetch, SDK import, authentication or cloud request while disabled.
  if (root.dataset.syncEnabled !== 'true' || root.dataset.syncProvider !== 'firebase') return;
  const auth = card.querySelector('[data-account-auth]'), connected = card.querySelector('[data-account-connected]'), choose = card.querySelector('[data-account-choose]');
  let provider;
  try {
    const response = await fetch('/config/firebase.json', { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw Error('config');
    const config = await response.json();
    if (config.enabled !== true || !config.firebase || !['apiKey', 'authDomain', 'projectId', 'appId'].every((key) => typeof config.firebase[key] === 'string' && config.firebase[key].length > 0)) throw Error('config');
    if (!/^[a-z0-9-]+\.firebaseapp\.com$/.test(config.firebase.authDomain)) throw Error('domain');
    const { createFirebaseProvider } = await import('./study-firebase.bundle.js');
    provider = await createFirebaseProvider(config.firebase, { courseId, catalog });
  } catch { tell('La sincronización no está disponible. Podés continuar y exportar tu avance sin cuenta.'); return; }
  const sync = createSync({ controller, catalog, provider, baseKey: progressStorageKey(courseId), status: tell });
  controller.subscribe(sync.changed);
  const signedOut = () => { connected.hidden = true; choose.hidden = true; auth.hidden = false; localReset.hidden = false; };
  auth.hidden = false;
  provider.subscribeUser((session) => {
    sync.authenticationChanged(session);
    if (!session.authenticated) signedOut();
    else if (!sync.connected) { auth.hidden = true; connected.hidden = true; choose.hidden = false; localReset.hidden = false; tell('Elegí si querés incorporar el avance de este navegador a tu cuenta.'); }
  });
  card.querySelector('[data-account-google]').addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try { await sync.request('auth/login', 'POST', {}); auth.hidden = true; choose.hidden = false; tell('Elegí qué avance querés usar.'); }
    catch { tell('No pudimos iniciar sesión con Google. El avance local se conserva.'); }
    finally { event.currentTarget.disabled = false; }
  });
  const updateCloudActions = () => { card.querySelector('[data-account-delete]').disabled = !sync.cloudReady; };
  card.querySelector('[data-account-reconnect]').addEventListener('click', async () => {
    try { await sync.connect(false); } catch { tell('No pudimos reconectar. El avance de este dispositivo se conserva.'); }
    updateCloudActions();
  });
  choose.querySelectorAll('[data-account-choice]').forEach((button) => button.addEventListener('click', async () => {
    try { await sync.connect(button.dataset.accountChoice === 'local'); if (!sync.connected) return; choose.hidden = true; connected.hidden = false; localReset.hidden = true; updateCloudActions(); }
    catch { tell('No pudimos conectar. Tu avance local se conserva.'); }
  }));
  card.querySelectorAll('[data-account-logout]').forEach((button) => button.addEventListener('click', async () => {
    try { await sync.logout(); signedOut(); }
    catch { signedOut(); tell('Retiramos la copia de esta cuenta del navegador, pero no pudimos cerrar la sesión de Google. Reintentá antes de compartir el dispositivo.'); }
  }));
  card.querySelector('[data-account-delete]').addEventListener('click', async () => {
    if (!confirm('¿Eliminar el progreso de esta guía en tu cuenta? Se conservará un marcador técnico sin avance para impedir que otro dispositivo lo vuelva a subir.')) return;
    try { await sync.remove(); } catch { tell('No pudimos confirmar la eliminación del progreso. Reintentá; tu cuenta sigue abierta.'); }
  });
  card.querySelectorAll('[data-account-delete-user]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('¿Eliminar tu cuenta y el progreso de todas las guías? Se conservará solamente un bloqueo técnico para impedir escrituras de sesiones antiguas.')) return;
    try { await sync.removeAccount(); signedOut(); tell('Cuenta y progreso eliminados.'); }
    catch { tell('La eliminación no se completó. No la damos por terminada: volvé a ingresar con Google y reintentá.'); }
  }));
  window.addEventListener('online', () => sync.retry());
}
