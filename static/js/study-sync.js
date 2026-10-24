import { STORAGE_KEY, emptyProgress, parseProgress, mergeProgress, serializeProgress } from './study-progress.js';
import { createPrivateStorage, progressDelta, uncoveredChanges, hasChanges } from './study-private-storage.js';

const MAX_FILE_BYTES = 65536;
export function readImport(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw Error('invalid');
  const parsed = parseProgress(text);
  if (parsed.status !== 'ready') throw Error('invalid');
  const state = parsed.state, latest = Date.now() + 300000;
  const keys = (value, allowed) => Object.keys(value).every((key) => allowed.includes(key));
  const clock = (value) => {
    if (!Number.isSafeInteger(value) || value < 0) throw Error('invalid');
    if (value > latest) throw Object.assign(Error('future-date'), { code: 'future-date' });
  };
  const leaf = (value, dateValue = false) => {
    if (!keys(value, ['value', 'updatedAt'])) throw Error('invalid');
    clock(value.updatedAt);
    if (dateValue) clock(value.value);
  };
  const safeIDs = (value) => Object.keys(value).every((key) => !['__proto__', 'constructor', 'prototype'].includes(key));
  if (!keys(state, ['version', 'classes', 'selected', 'lastActivity']) || !safeIDs(state.classes)) throw Error('invalid');
  if (state.selected) leaf(state.selected);
  if (state.lastActivity) leaf(state.lastActivity, true);
  for (const lesson of Object.values(state.classes)) {
    if (!keys(lesson, ['blocks', 'complete', 'lastPoint', 'lastActivity']) || !safeIDs(lesson.blocks)) throw Error('invalid');
    for (const field of ['complete', 'lastPoint', 'lastActivity']) if (lesson[field]) leaf(lesson[field], field === 'lastActivity');
    for (const block of Object.values(lesson.blocks)) leaf(block);
  }
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
    if (Object.keys(lesson).length > 1 || Object.keys(lesson.blocks).length) output.classes[item.id] = lesson;
  }
  if (state.selected && catalog.some((item) => item.id === state.selected.value)) output.selected = leaf(state.selected);
  if (state.lastActivity) output.lastActivity = leaf(state.lastActivity);
  return output;
}

// A reading position and explicit unchecked records are progress too.
export function hasProgress(state) {
  return !!(state.selected || state.lastActivity || Object.values(state.classes).some((lesson) =>
    lesson.complete || lesson.lastPoint || lesson.lastActivity || Object.keys(lesson.blocks).length));
}

export function createSync({ controller, catalog, provider, baseKey = STORAGE_KEY, storage = localStorage, schedule = setTimeout, cancel = clearTimeout, status = () => {}, delay = 7000, tabId }) {
  const vault = createPrivateStorage({ storage, baseKey, tabId });
  let account, lastVerifiedSubject, envelope, generation, timer, stopped = false, attempts = 0, context = 0;
  let pending = emptyProgress(), observed = controller.snapshot(), persisted = true;
  let closing = false, loggingOut, recovering, recoverable = false, lastRecovery = -Infinity;
  const running = new Map();
  const legacyKey = subject => `${baseKey}:account:${encodeURIComponent(subject)}`;
  const read = key => { try { return parseProgress(storage.getItem(key)).state; } catch { return emptyProgress(); } };
  const dirty = () => hasChanges(pending);
  const clearTimer = () => { if (timer) cancel(timer); timer = undefined; };
  function checkErased(subject = account || lastVerifiedSubject) {
    if (!subject || !vault.erased(subject)) return false;
    if (account === subject || lastVerifiedSubject === subject) detach(true);
    status('Esta cuenta fue eliminada. No se volverán a guardar ni sincronizar sus copias anteriores.');
    return true;
  }
  function persist() {
    if (!account || generation === undefined) return true;
    persisted = vault.save(account, generation, controller.snapshot(), pending);
    if (persisted && envelope && !envelope.deleted && envelope.generation === generation) vault.prune(account, generation, envelope.progress || emptyProgress());
    controller.setPrivatePersisted?.(persisted);
    return persisted;
  }
  function activate(next, boundary = false) {
    observed = structuredClone(next);
    controller.activate(vault.key(account), next, { private: true, boundary });
    persist();
  }
  async function request(path, method = 'GET', body, expectedAccount = account) {
    if (path === 'progress' && checkErased(expectedAccount)) throw Object.assign(Error('account-erased'), { status: 401 });
    let timeout;
    try {
      const data = ['auth/login', 'account/delete'].includes(path) ? await provider.request(path, method, body, expectedAccount) : await Promise.race([
        provider.request(path, method, body, expectedAccount),
        new Promise((_, reject) => { timeout = schedule(() => reject(Error('timeout')), 12000); })
      ]);
      if (path === 'session' && data.authenticated && typeof data.subject === 'string') {
        if (checkErased(data.subject)) return { authenticated: false };
        lastVerifiedSubject = data.subject;
      }
      if (path === 'progress' && checkErased(expectedAccount)) throw Object.assign(Error('account-erased'), { status: 401 });
      return data;
    } finally { cancel(timeout); }
  }
  function queue(wait = delay) {
    if (!account || stopped || closing || timer || running.has(context) || !dirty()) return;
    timer = schedule(() => { timer = undefined; return flush(); }, wait);
  }
  function changed(before) {
    if (!account || checkErased()) return;
    const next = controller.snapshot();
    const delta = cloudProgress(progressDelta(before || observed, next), catalog);
    pending = mergeProgress(pending, delta);
    observed = structuredClone(next);
    persist(); attempts = 0; queue();
  }
  function resetRemote(next) {
    clearTimer(); envelope = next; generation = next.generation;
    pending = emptyProgress(); stopped = true; recoverable = false;
    activate(next.deleted ? emptyProgress() : next.progress || emptyProgress(), true);
    status('El progreso de la cuenta fue eliminado. Tu avance anterior no se volverá a subir.');
  }
  function flush() {
    if (running.has(context)) return running.get(context);
    if (!account || stopped || !envelope || !dirty()) return Promise.resolve();
    const token = context;
    const operation = sendProgress(token);
    running.set(token, operation);
    return operation;
  }
  async function sendProgress(token) {
    clearTimer();
    let retryDelay;
    const subject = account, sent = structuredClone(pending);
    persist();
    try {
      const result = await request('progress', 'PATCH', { revision: envelope.revision, generation: envelope.generation, progress: sent }, subject);
      if (token !== context || account !== subject) return;
      envelope = result; generation = result.generation; attempts = 0; recoverable = false;
      pending = uncoveredChanges(pending, result.progress || emptyProgress());
      const next = mergeProgress(controller.snapshot(), result.progress || emptyProgress());
      activate(mergeProgress(next, pending));
      status(dirty() ? 'Guardado en este dispositivo; sincronización próxima.' : 'Sincronizado');
    } catch (error) {
      if (token !== context || account !== subject) return;
      recoverable = false;
      if (error.status === 410) resetRemote(error.data.current || error.data);
      else if (error.status === 409 && attempts < 3) {
        const remote = error.data.current || error.data;
        envelope = remote; generation = remote.generation;
        pending = uncoveredChanges(pending, remote.progress || emptyProgress());
        activate(mergeProgress(controller.snapshot(), remote.progress || emptyProgress()));
        attempts++; retryDelay = 1000 * attempts;
      } else if (error.status === 401 || error.status === 403) { stopped = true; status('Tu sesión terminó. El avance sigue guardado en este dispositivo.'); }
      else if (error.status === 429) { stopped = true; status('Se alcanzó un límite de sincronización. Tu avance sigue en este dispositivo; reintentá más tarde.'); }
      else if (error.status === 400 || error.status === 422) { stopped = true; status('No pudimos sincronizar este avance. Se conserva en este dispositivo.'); }
      else {
        recoverable = true; status('Sin conexión: guardado en este dispositivo');
        if (attempts < 3) { attempts++; retryDelay = 15000 * 2 ** (attempts - 1); }
      }
      persist();
    } finally {
      running.delete(token);
      if (token === context && dirty() && !stopped) {
        if (retryDelay !== undefined) queue(retryDelay);
        else if (attempts === 0) queue();
      }
    }
  }
  function hasLocalProgress() { return hasProgress(account ? read(baseKey) : controller.snapshot()); }
  function legacySnapshot() {
    const subject = account || lastVerifiedSubject;
    if (!subject) return;
    try {
      const raw = storage.getItem(legacyKey(subject));
      const parsed = parseProgress(raw);
      return raw && parsed.status === 'ready' ? parsed.state : undefined;
    } catch { /* A legacy copy cannot prove a generation. Never auto-import it. */ }
  }
  async function inspect() {
    const token = context;
    const session = await request('session');
    if (token !== context || !session.authenticated || typeof session.subject !== 'string') throw Error('session');
    const remote = await request('progress', 'GET', undefined, session.subject);
    if (token !== context) throw Error('session');
    const current = await request('session');
    if (token !== context || !current.authenticated || current.subject !== session.subject) throw Error('session');
    return { subject: session.subject, hasLocal: hasLocalProgress(), hasRemote: !remote.deleted && hasProgress(remote.progress || emptyProgress()) };
  }
  function recovered(records, epoch, confirmed) {
    return records.filter(({ record }) => record.generation === epoch).reduce((result, { record }) => mergeProgress(result, uncoveredChanges(cloudProgress(record.pending, catalog), confirmed)), emptyProgress());
  }
  async function connect(useLocal, expectedSubject) {
    if (closing) throw Object.assign(Error('closing'), { code: 'closing' });
    clearTimer();
    const token = ++context;
    const session = await request('session');
    if (token !== context) return;
    if (!session.authenticated || typeof session.subject !== 'string' || (expectedSubject !== undefined && session.subject !== expectedSubject)) throw Error('session');
    let remote;
    try { remote = await request('progress', 'GET', undefined, session.subject); }
    catch (error) {
      if (error.status && error.status !== 429 && error.status < 500) throw error;
      const verified = await request('session');
      if (token !== context || !verified.authenticated || verified.subject !== session.subject) throw Error('session');
      const records = vault.entries(session.subject);
      const knownEpoch = account === session.subject ? generation : undefined;
      const epochs = new Set(records.map(({ record }) => record.generation));
      if (knownEpoch === undefined && epochs.size > 1) throw Object.assign(Error('ambiguous-cache'), { code: 'ambiguous-cache' });
      const usable = knownEpoch === undefined ? records : records.filter(({ record }) => record.generation === knownEpoch);
      const cached = usable[0]?.record;
      if (!cached) throw error;
      account = session.subject; envelope = undefined; generation = cached.generation; stopped = true; attempts = 0;
      pending = recovered(records, generation, emptyProgress());
      recoverable = error.status !== 429;
      const snapshot = usable.reduce((next, { record }) => mergeProgress(next, record.snapshot), emptyProgress());
      activate(mergeProgress(snapshot, pending), true);
      status('Avance de tu cuenta guardado en este dispositivo. Sincronización pausada; reconectá para comprobar el avance remoto.' + (useLocal ? ' No incorporamos todavía el avance sin cuenta; queda guardado por separado.' : ''));
      return;
    }
    if (token !== context) return;
    const records = vault.entries(session.subject);
    let initialCreation = false;
    const initialPending = recovered(records, null, remote.progress || emptyProgress());
    if (hasChanges(initialPending) && remote.generation !== null && !remote.deleted) {
      try {
        remote = await request('progress', 'PUT', { revision: 0, generation: null, progress: initialPending }, session.subject);
        initialCreation = !remote.deleted;
      } catch (error) {
        if (![409, 410].includes(error.status)) throw error;
        const current = error.data?.current || error.data;
        if (!current || !Object.hasOwn(current, 'generation')) throw error;
        remote = current; initialCreation = error.status === 409 && !remote.deleted;
      }
      if (token !== context) return;
    }
    const local = account ? read(baseKey) : controller.snapshot();
    account = session.subject; envelope = remote; generation = remote.generation; stopped = false; attempts = 0; recoverable = false;
    pending = remote.deleted ? emptyProgress() : recovered(vault.entries(account), generation, remote.progress || emptyProgress());
    if (initialCreation) pending = mergeProgress(pending, uncoveredChanges(initialPending, remote.progress || emptyProgress()));
    let source = remote.deleted ? emptyProgress() : remote.progress || emptyProgress();
    // Preserve local-only/retired identifiers in the v1 export without turning
    // a peer snapshot into new cloud edits. The pending journal alone is sent.
    if (!remote.deleted) for (const { record } of records) if (record.generation === generation) source = mergeProgress(record.snapshot, source);
    if (useLocal) pending = mergeProgress(pending, uncoveredChanges(cloudProgress(local, catalog), source));
    activate(mergeProgress(source, pending), true);
    status(dirty() ? 'Guardado en este dispositivo; sincronización próxima.' : 'Sincronizado');
    queue();
  }
  async function resume() {
    if (closing) throw Object.assign(Error('closing'), { code: 'closing' });
    const token = ++context;
    const session = await request('session');
    if (token !== context || !session.authenticated || typeof session.subject !== 'string' || !vault.entries(session.subject).length) return false;
    await connect(false, session.subject);
    return account === session.subject;
  }
  function detach(discard = false) {
    const previous = account;
    const preserve = !discard && previous && (dirty() || running.has(context));
    if (preserve) persist();
    clearTimer(); context++; stopped = true; recoverable = false;
    if (previous && !preserve) vault.removeOwn(previous);
    account = undefined; lastVerifiedSubject = undefined; envelope = undefined; generation = undefined; pending = emptyProgress();
    observed = read(baseKey);
    controller.activate(baseKey, observed);
    status(preserve ? 'Sesión cerrada. Hay avance pendiente guardado para esta cuenta en este dispositivo. Se reintentará al volver a iniciar sesión con la misma cuenta Google.' : 'Guardado en este navegador');
  }
  function logout() {
    if (loggingOut) return loggingOut;
    closing = true; clearTimer();
    loggingOut = (async () => {
      const subject = account || lastVerifiedSubject, token = context;
      await flush();
      if (token === context && dirty() && !stopped && attempts === 0) await flush();
      if (token !== context) throw Object.assign(Error('logout-context'), { code: 'logout-context' });
      if (account && dirty() && !vault.persisted(account, generation, pending)) throw Object.assign(Error('pending-storage'), { code: 'pending-storage' });
      detach();
      await request('auth/logout', 'POST', {}, subject);
    })().finally(() => { closing = false; loggingOut = undefined; queue(); });
    return loggingOut;
  }
  async function retry() {
    if (!account || !recoverable || closing || recovering || Date.now() - lastRecovery < 60000) return;
    const subject = account; lastRecovery = Date.now();
    recovering = (async () => {
      try { await connect(false, subject); if (account === subject && !stopped) await flush(); }
      catch { /* Existing paused state and local records remain available. */ }
    })();
    try { await recovering; } finally { recovering = undefined; }
  }
  async function remove() {
    if (closing) throw Object.assign(Error('closing'), { code: 'closing' });
    if (!account || !envelope) throw Error('reconnect');
    clearTimer(); const token = ++context; stopped = true;
    const result = await request('progress', 'DELETE', { revision: envelope.revision, generation: envelope.generation });
    if (token !== context) return;
    envelope = result; generation = result.generation; pending = emptyProgress(); recoverable = false;
    activate(emptyProgress(), true); stopped = false;
    status('Progreso de la cuenta eliminado.');
  }
  async function removeAccount() {
    if (closing) throw Object.assign(Error('closing'), { code: 'closing' });
    clearTimer(); const token = ++context; stopped = true;
    const session = await request('session');
    if (token !== context || !session.authenticated || typeof session.subject !== 'string') throw Error('session');
    await request('account/delete', 'DELETE', {}, session.subject);
    const erasedLocally = vault.erase(session.subject);
    if (token === context || account === session.subject) detach(true);
    if (!erasedLocally) status('La cuenta remota fue eliminada, pero el navegador no permitió confirmar la eliminación de todas sus copias locales. Borrá los datos de este sitio en el navegador.');
    return { deleted: true, localErased: erasedLocally };
  }
  function authenticationChanged(session) {
    if (session.authenticated && checkErased(session.subject)) return;
    if (((account || lastVerifiedSubject) && (account || lastVerifiedSubject) !== session.subject) || (!session.authenticated && lastVerifiedSubject)) detach();
    if (session.authenticated && typeof session.subject === 'string') lastVerifiedSubject = session.subject;
  }
  function storageChanged(event) {
    if (account && event.key === vault.erasedKey(account) && vault.erased(account)) { checkErased(); return; }
    if (!account || !event.key?.startsWith(vault.prefix) || !event.newValue || event.key === vault.key(account)) return;
    const record = vault.parse(event.newValue, account);
    if (!record) return;
    if (record.generation !== generation) {
      // A peer's event cannot authorize a new epoch. Stop old writes until a
      // verified server read resolves the reset; delayed old events cannot undo it.
      clearTimer(); context++; stopped = true; recoverable = true;
      status('Cambió el progreso en otra pestaña. Reconectá para comprobar la cuenta.');
      return;
    }
    if (stopped) return;
    observed = mergeProgress(controller.snapshot(), record.snapshot);
    controller.activate(vault.key(account), observed, { private: true });
  }
  function pagehide() {
    if (!account) return;
    // Keep the last confirmed snapshot too: it is needed for offline reload.
    persist();
    vault.close(account);
  }
  return { request, inspect, legacySnapshot, hasLocalProgress, connect, resume, logout, remove, removeAccount, authenticationChanged, changed, flush, retry, storageChanged, pagehide,
    get connected() { return !!account; }, get cloudReady() { return !!account && !!envelope && !stopped; } };
}

export function progressStorageKey(courseId = 'lucas') {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(courseId)) throw Error('course');
  return courseId === 'lucas' ? STORAGE_KEY : `lasnotasdevero:${courseId}:progress:v1`;
}

export async function initializeSync(root, controller, catalog) {
  const setPending = (value) => controller.setProgressPending?.(value);
  const card = root.querySelector('#study-account');
  if (!card) { setPending(false); return; }
  card.hidden = false;
  const courseId = root.dataset.courseId || 'lucas';
  const message = root.querySelector('[data-account-status]');
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
      const profileVersion = controller.profileVersion;
      const text = await file.text();
      if (controller.profileVersion !== profileVersion) throw Object.assign(Error('import-profile-changed'), { code: 'import-profile-changed' });
      const incoming = readImport(text);
      if (controller.profileVersion !== profileVersion) throw Object.assign(Error('import-profile-changed'), { code: 'import-profile-changed' });
      controller.replace(mergeProgress(controller.snapshot(), incoming));
      tell('Avance importado en este navegador.');
    } catch (error) {
      tell(error.code === 'import-profile-changed'
        ? 'Cambió el perfil o se restableció el avance mientras leíamos el archivo. No lo importamos. Volvé a elegir el archivo en el perfil que querés usar.'
        : error.code === 'future-date'
        ? 'El archivo contiene fechas futuras. Revisá el reloj del dispositivo que lo exportó y volvé a exportar el avance. No cambiamos tu progreso.'
        : 'No pudimos importar ese archivo de avance: el formato no es válido. No cambiamos tu progreso.');
    }
    event.target.value = '';
  });
  const localReset = card.querySelector('[data-progress-reset]');
  localReset.addEventListener('click', () => {
    if (confirm('¿Borrar el avance de este navegador? Esta acción no se puede deshacer.')) { controller.replace(emptyProgress(), true); tell('Avance local eliminado.'); }
  });
  // No config fetch, SDK import, authentication or cloud request while disabled.
  if (root.dataset.syncEnabled !== 'true' || root.dataset.syncProvider !== 'firebase') { setPending(false); return; }
  setPending(true);
  const auth = root.querySelector('[data-account-auth]'), connected = card.querySelector('[data-account-connected]'), choose = root.querySelector('[data-account-choose]');
  const recovery = card.querySelector('[data-account-recovery]'), compareRetry = root.querySelector('[data-account-compare-retry]');
  let provider;
  const bootstrap = new AbortController();
  let bootstrapTimer;
  const checkBootstrap = () => { if (bootstrap.signal.aborted) throw Error('timeout'); };
  try {
    provider = await Promise.race([
      (async () => {
        const response = await fetch('/config/firebase.json', { cache: 'no-store', credentials: 'omit', signal: bootstrap.signal });
        checkBootstrap();
        if (!response.ok) throw Error('config');
        const config = await response.json();
        checkBootstrap();
        if (config.enabled !== true || !config.firebase || !['apiKey', 'authDomain', 'projectId', 'appId'].every((key) => typeof config.firebase[key] === 'string' && config.firebase[key].length > 0)) throw Error('config');
        if (!/^[a-z0-9-]+\.firebaseapp\.com$/.test(config.firebase.authDomain)) throw Error('domain');
        const { createFirebaseProvider } = await import('./study-firebase.bundle.js');
        checkBootstrap();
        const result = await createFirebaseProvider(config.firebase, { courseId, catalog, appCheck: config.appCheck });
        if (bootstrap.signal.aborted) {
          result.dispose?.().catch(() => {});
          throw Error('timeout');
        }
        return result;
      })(),
      new Promise((_, reject) => { bootstrapTimer = setTimeout(() => { bootstrap.abort(); reject(Error('timeout')); }, 12000); })
    ]);
  } catch { setPending(false); tell('La sincronización no está disponible. Podés continuar y exportar tu avance sin cuenta.'); return; }
  finally { clearTimeout(bootstrapTimer); }
  const sync = createSync({ controller, catalog, provider, baseKey: progressStorageKey(courseId), status: tell });
  controller.subscribe(sync.changed);
  window.addEventListener('storage', (event) => {
    const wasConnected = sync.connected;
    sync.storageChanged(event);
    if (wasConnected && !sync.connected) {
      // Account erasure in another tab also invalidates this tab's account UI
      // and outstanding decisions. Preserve the coordinator's terminal notice.
      authContext++; signedOut(); setPending(false);
    }
    updateCloudActions();
  });
  window.addEventListener('pagehide', sync.pagehide);
  const legacyExport = document.createElement('button');
  legacyExport.type = 'button'; legacyExport.className = 'study-btn';
  legacyExport.textContent = 'Exportar copia anterior de esta cuenta';
  legacyExport.hidden = true;
  legacyExport.addEventListener('click', () => {
    const previous = sync.legacySnapshot();
    if (previous) { download(previous); tell('Exportamos la copia anterior. Revisala antes de importarla: no podemos confirmar a qué versión del avance pertenece. No se combinó automáticamente.'); }
  });
  card.querySelector('[data-progress-export]').after(legacyExport);
  let authContext = 0, explicitLogin = false, decisionSubject, signedSubject;
  const signedOut = () => { connected.hidden = true; recovery.hidden = true; choose.hidden = true; compareRetry.hidden = true; auth.hidden = false; localReset.hidden = false; legacyExport.hidden = true; decisionSubject = undefined; signedSubject = undefined; };
  const updateCloudActions = () => { card.querySelector('[data-account-delete]').disabled = !sync.cloudReady; };
  const showConnected = () => { auth.hidden = true; choose.hidden = true; compareRetry.hidden = true; recovery.hidden = true; connected.hidden = false; localReset.hidden = true; decisionSubject = undefined; updateCloudActions(); };
  async function prepareAccount(token, forceChoice) {
    setPending(true);
    auth.hidden = true; connected.hidden = true; recovery.hidden = false; choose.hidden = true; compareRetry.hidden = true;
    tell('Comprobando el avance de tu cuenta…');
    try {
      if (!forceChoice && await sync.resume()) {
        if (token === authContext) showConnected();
        return;
      }
      if (token !== authContext) return;
      if (!sync.hasLocalProgress()) {
        await sync.connect(false, signedSubject);
        if (token === authContext && sync.connected) showConnected();
        return;
      }
      const comparison = await sync.inspect();
      if (token !== authContext) return;
      decisionSubject = comparison.subject;
      choose.querySelector('[data-account-comparison]').textContent = comparison.hasRemote
        ? 'Encontramos avance en este navegador y progreso guardado en tu cuenta Google. ¿Querés combinar ambos o usar el de tu cuenta? El avance sin cuenta se conserva por separado.'
        : 'Encontramos avance en este navegador. Tu cuenta Google todavía no tiene progreso en esta guía. Podés combinar para guardarlo en tu cuenta o usar la cuenta sin incorporar el avance local. El avance sin cuenta se conserva por separado.';
      choose.hidden = false; localReset.hidden = false;
      tell('Elegí qué avance querés usar. Todavía no incorporamos el avance local a tu cuenta.');
      choose.querySelector('h2').focus();
    } catch {
      if (token !== authContext) return;
      compareRetry.hidden = false; localReset.hidden = false;
      tell('No pudimos comprobar el avance de tu cuenta. El avance local se conserva; podés reintentar.');
    } finally { if (token === authContext) setPending(false); }
  }
  provider.subscribeUser(async (session) => {
    // Repeated notifications for the same owner must not bypass a pending choice.
    if (session.authenticated && signedSubject === session.subject) return;
    const token = ++authContext;
    decisionSubject = undefined;
    sync.authenticationChanged(session);
    legacyExport.hidden = !session.authenticated || !sync.legacySnapshot();
    if (!session.authenticated) { signedOut(); setPending(false); }
    else {
      signedSubject = session.subject;
      const forceChoice = explicitLogin;
      explicitLogin = false;
      if (!sync.connected) await prepareAccount(token, forceChoice);
      else { showConnected(); setPending(false); }
    }
  });
  root.querySelector('[data-account-google]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    // Consumed by the authenticated callback, which may follow popup resolution.
    explicitLogin = true;
    try { await sync.request('auth/login', 'POST', {}); }
    catch { explicitLogin = false; tell('No pudimos iniciar sesión con Google. El avance local se conserva.'); }
    finally { button.disabled = false; }
  });
  compareRetry.addEventListener('click', () => prepareAccount(++authContext, true));
  card.querySelector('[data-account-reconnect]').addEventListener('click', async () => {
    const token = authContext;
    setPending(true);
    try { await sync.connect(false); } catch { tell('No pudimos reconectar. El avance de este dispositivo se conserva.'); }
    finally { if (token === authContext) setPending(false); }
    updateCloudActions();
  });
  card.querySelector('[data-account-merge-local]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const token = authContext;
    setPending(true);
    button.disabled = true;
    try { await sync.connect(true); }
    catch { tell('No pudimos incorporar el avance guardado sin cuenta. Se conserva por separado; reintentá cuando tengas conexión.'); }
    finally { button.disabled = false; if (token === authContext) setPending(false); updateCloudActions(); }
  });
  choose.querySelectorAll('[data-account-choice]').forEach((button) => button.addEventListener('click', async () => {
    const token = authContext;
    const subject = decisionSubject;
    if (!subject) return;
    const choices = choose.querySelectorAll('[data-account-choice]');
    choices.forEach((choice) => { choice.disabled = true; });
    setPending(true);
    try { await sync.connect(button.dataset.accountChoice === 'local', subject); if (token !== authContext || !sync.connected) return; showConnected(); }
    catch { tell('No pudimos conectar. Tu avance local se conserva.'); }
    finally { choices.forEach((choice) => { choice.disabled = false; }); if (token === authContext) setPending(false); }
  }));
  card.querySelectorAll('[data-account-logout]').forEach((button) => button.addEventListener('click', async () => {
    try { await sync.logout(); signedOut(); }
    catch (error) {
      if (error.code === 'pending-storage') tell('No pudimos sincronizar ni guardar una copia pendiente. Tu avance sigue en esta pestaña: exportalo antes de cerrar. No cerramos la sesión.');
      else if (error.code === 'logout-context') tell('Cambió la sesión mientras intentábamos salir. Comprobá la cuenta activa antes de compartir el dispositivo.');
      else { signedOut(); tell('La copia pendiente de esta cuenta se conserva si no se sincronizó, pero no pudimos confirmar el cierre de sesión de Google. Reintentá antes de compartir el dispositivo.'); }
    }
  }));
  card.querySelector('[data-account-delete]').addEventListener('click', async () => {
    if (!confirm('¿Eliminar el progreso de esta guía en tu cuenta? Se conservará un marcador técnico sin avance para impedir que otro dispositivo lo vuelva a subir.')) return;
    try { await sync.remove(); } catch { tell('No pudimos confirmar la eliminación del progreso. Reintentá; tu cuenta sigue abierta.'); }
  });
  card.querySelectorAll('[data-account-delete-user]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('¿Eliminar tu cuenta y el progreso de todas las guías? Se conservará solamente un bloqueo técnico para impedir escrituras de sesiones antiguas.')) return;
    try {
      const result = await sync.removeAccount(); signedOut();
      tell(result.localErased ? 'Cuenta y progreso eliminados.' : 'La cuenta remota fue eliminada, pero el navegador no permitió confirmar la eliminación de todas sus copias locales. Borrá los datos de este sitio en el navegador.');
    }
    catch { tell('La eliminación no se completó. No la damos por terminada: volvé a ingresar con Google y reintentá.'); }
  }));
  window.addEventListener('online', async () => { await sync.retry(); updateCloudActions(); });
}
