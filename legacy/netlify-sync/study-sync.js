import { STORAGE_KEY, emptyProgress, parseProgress, mergeProgress, serializeProgress } from '../../static/js/study-progress.js';

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

export function createSync({ controller, catalog, storage = localStorage, fetcher = fetch, schedule = setTimeout, cancel = clearTimeout, status = () => {}, delay = 7000 }) {
  let account, lastVerifiedSubject, envelope, timer, dirty = false, stopped = false, attempts = 0, context = 0;
  const running = new Set();
  const keyFor = (subject) => `${STORAGE_KEY}:account:${encodeURIComponent(subject)}`;
  const generationKey = (subject) => `${keyFor(subject)}:generation`;
  function rememberGeneration(value) { try { storage.setItem(generationKey(account), JSON.stringify(value)); } catch { /* Local storage can be unavailable. */ } }
  const read = (key) => { try { return parseProgress(storage.getItem(key)).state; } catch { return emptyProgress(); } };
  const clearTimer = () => { if (timer) cancel(timer); timer = undefined; };
  async function request(path, method = 'GET', body, expectedAccount = account) {
    const abort = new AbortController(), timeout = schedule(() => abort.abort(), 12000);
    try {
      const response = await fetcher(`/api/lucas/${path}`, { method, credentials: 'same-origin', signal: abort.signal, headers: { Accept: 'application/json', ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }), ...(expectedAccount && ['progress', 'export'].includes(path) ? { 'X-Lucas-Account': expectedAccount } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      let data; try { data = await response.json(); } catch { data = {}; }
      if (!response.ok) throw Object.assign(Error('request'), { status: response.status, data });
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
      } else if (error.status === 401) { stopped = true; status('Tu sesión terminó. El avance sigue guardado en este dispositivo.'); }
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
    const remote = await request('progress', 'GET', undefined, session.subject);
    if (token !== context) return;
    const local = account ? read(STORAGE_KEY) : controller.snapshot();
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
  async function logout() {
    clearTimer(); context++; stopped = true; dirty = false;
    const previous = account || lastVerifiedSubject; account = undefined; lastVerifiedSubject = undefined; envelope = undefined;
    if (previous) { try { storage.removeItem(keyFor(previous)); storage.removeItem(generationKey(previous)); } catch { /* Memory-only remains usable. */ } }
    controller.activate(STORAGE_KEY, read(STORAGE_KEY));
    status('Guardado en este navegador');
    await request('auth/logout', 'POST', {});
  }
  async function remove() {
    if (!account) return;
    clearTimer(); const token = ++context; dirty = false; stopped = true;
    const result = await request('progress', 'DELETE', { revision: envelope.revision, generation: envelope.generation });
    if (token !== context) return;
    envelope = result;
    rememberGeneration(result.generation);
    controller.activate(keyFor(account), emptyProgress());
    stopped = false;
    status('Progreso de la cuenta eliminado.');
  }
  return { request, connect, logout, remove, changed, flush, retry() { if (account && !stopped) { attempts = 0; queue(0); } }, get connected() { return !!account; } };
}

export function initializeSync(root, controller, catalog) {
  const card = root.querySelector('#study-account');
  if (!card) return;
  card.hidden = false;
  const message = card.querySelector('[data-account-status]');
  const tell = (text) => { message.textContent = controller.canPersist && !controller.canPersist() ? `${text} El navegador no permite guardar una copia local; conservá esta pestaña abierta o exportá tu avance.` : text; };
  const download = (state) => {
    const url = URL.createObjectURL(new Blob([serializeProgress(state)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'mi-avance-lucas.json'; link.click();
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
  card.querySelector('[data-progress-reset]').addEventListener('click', () => {
    if (confirm('¿Borrar el avance de este navegador? Esta acción no se puede deshacer.')) { controller.replace(emptyProgress(), true); tell('Avance local eliminado.'); }
  });
  if (root.dataset.syncEnabled !== 'true') return;
  const sync = createSync({ controller, catalog, status: tell });
  const localReset = card.querySelector('[data-progress-reset]');
  controller.subscribe(sync.changed);
  const auth = card.querySelector('[data-account-auth]'), connected = card.querySelector('[data-account-connected]'), choose = card.querySelector('[data-account-choose]');
  auth.hidden = false;
  const form = card.querySelector('form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = form.elements.password.value, email = form.elements.email.value;
    form.elements.password.value = '';
    const action = event.submitter?.value || 'login';
    for (const button of form.querySelectorAll('button')) button.disabled = true;
    try {
      await sync.request(`auth/${action}`, 'POST', { email, password });
      form.elements.email.value = '';
      if (action === 'signup') tell('Revisá tu correo para confirmar la cuenta antes de ingresar.');
      else { auth.hidden = true; choose.hidden = false; tell('Elegí qué avance querés usar.'); }
    } catch { tell('No pudimos completar la operación. Revisá tus datos o intentá más tarde.'); }
    finally { for (const button of form.querySelectorAll('button')) button.disabled = false; }
  });
  card.querySelector('[data-account-recover]').addEventListener('click', async () => {
    const email = form.elements.email.value;
    if (!email || !form.elements.email.checkValidity()) { tell('Ingresá tu correo para solicitar la recuperación.'); return; }
    form.elements.password.value = '';
    try { await sync.request('auth/recover', 'POST', { email }); tell('Si existe una cuenta con ese correo, recibirás un enlace para recuperar el acceso.'); }
    catch { tell('No pudimos solicitar el correo. Intentá nuevamente más tarde.'); }
  });
  choose.querySelectorAll('button').forEach((button) => button.addEventListener('click', async () => {
    try { await sync.connect(button.dataset.accountChoice === 'local'); choose.hidden = true; connected.hidden = false; localReset.hidden = true; }
    catch { tell('No pudimos conectar. Tu avance local se conserva.'); }
  }));
  card.querySelectorAll('[data-account-logout]').forEach((button) => button.addEventListener('click', async () => {
    try { await sync.logout(); } catch { tell('Avance de cuenta retirado de este navegador. No pudimos cerrar la sesión del servidor; reintentá antes de compartir el dispositivo.'); }
    connected.hidden = true; choose.hidden = true; auth.hidden = false; localReset.hidden = false;
  }));
  card.querySelector('[data-account-delete]').addEventListener('click', async () => {
    if (!confirm('¿Eliminar todo tu progreso de la cuenta y sus copias de seguridad? Esta acción no se puede deshacer.')) return;
    try { await sync.remove(); } catch { tell('No pudimos eliminar el progreso de la cuenta. Intentá nuevamente.'); }
  });
  window.addEventListener('online', () => sync.retry());
  // A cookie session alone never imports the anonymous browser profile.
  sync.request('session').then((session) => { if (session.authenticated) { auth.hidden = true; choose.hidden = false; tell('Hay una sesión iniciada. Elegí el avance que querés usar.'); } }).catch(() => tell('Sin conexión: guardado en este navegador'));
}
