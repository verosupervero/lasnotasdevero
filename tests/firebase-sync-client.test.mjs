import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSync, cloudProgress, readImport, progressStorageKey, initializeSync } from '../static/js/study-sync.js';
import { STORAGE_KEY, emptyProgress, updateProgress } from '../static/js/study-progress.js';

const catalog = [{ id: 'video-1', questions: ['question-1', 'question-2'], points: ['video-1', 'question-1', 'question-2'] }];
const progress = (question = 'question-1', time = 10) => updateProgress(emptyProgress(), 'video-1', 'block', true, time, question);
const envelope = (state = emptyProgress(), revision = 0, generation = 'epoch-1') => ({ progress: state, revision, generation, deleted: false });
function setup() {
  const map = new Map([[STORAGE_KEY, JSON.stringify(progress())]]), pending = new Map(), calls = [], statuses = [];
  let state = progress(), key = STORAGE_KEY, index = 0, subject = 'alice', remote = envelope(), put, readError;
  const storage = { getItem: (name) => map.get(name) ?? null, setItem: (name, value) => map.set(name, value), removeItem: (name) => map.delete(name) };
  const controller = { snapshot: () => structuredClone(state), activate(name, next) { key = name; state = next; storage.setItem(name, JSON.stringify(next)); } };
  const fetcher = async (url, options) => {
    const body = options.body && JSON.parse(options.body); calls.push({ url, ...options, body });
    if (url.endsWith('/progress') && options.method === 'GET' && readError) throw readError;
    let status = 200, result;
    if (url.endsWith('/session')) result = { authenticated: true, subject };
    else if (options.method === 'PUT') {
      if (put) ({ status, result } = await put(body));
      else result = remote = envelope(body.progress, remote.revision + 1);
    } else if (options.method === 'DELETE') result = remote = { ...envelope(null, 0, 'epoch-2'), deleted: true };
    else if (url.endsWith('/logout')) result = {};
    else result = remote;
    return { ok: status < 400, status, json: async () => structuredClone(result) };
  };
  const sync = createSync({ controller, catalog, storage, provider: { async request(path, method, body, expectedUID) {
    const response = await fetcher(`mock/${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'X-Lucas-Account': expectedUID } });
    const data = await response.json();
    if (!response.ok) throw Object.assign(Error('provider'), { status: response.status, data });
    return data;
  } }, status: (text) => statuses.push(text), schedule: (callback, delay) => { const id = ++index; pending.set(id, { callback, delay }); return id; }, cancel: (id) => pending.delete(id) });
  return { sync, controller, map, pending, calls, statuses, get state() { return state; }, get key() { return key; }, set state(value) { state = value; }, set subject(value) { subject = value; }, set remote(value) { remote = value; }, set put(value) { put = value; }, set readError(value) { readError = value; }, async tick() { const entry = [...pending].find(([, timer]) => timer.delay !== 12000); if (entry) { pending.delete(entry[0]); await entry[1].callback(); await new Promise((resolve) => setImmediate(resolve)); } } };
}

test('no anonymous upload until explicitly connected; importing is opt-in', async () => {
  const x = setup(); x.sync.changed(); assert.equal(x.calls.length, 0);
  await x.sync.connect(false); assert.deepEqual(x.state, emptyProgress());
  assert.equal(x.pending.size, 0); assert.ok(x.map.get(STORAGE_KEY).includes('question-1'));
});
test('coalesces actual changes and does not poll after upload', async () => {
  const x = setup(); await x.sync.connect(true); x.sync.changed(); x.sync.changed();
  assert.equal(x.pending.size, 1); await x.tick();
  assert.equal(x.calls.filter((call) => call.method === 'PUT').length, 1);
  assert.equal(x.pending.size, 0); assert.equal(x.statuses.at(-1), 'Sincronizado');
  for (const call of x.calls.filter((item) => item.url.endsWith('/progress'))) assert.equal(call.headers['X-Lucas-Account'], 'alice');
});
test('network failure preserves local state and retries at most three times', async () => {
  const x = setup(); x.put = () => { throw Error('offline'); }; await x.sync.connect(true);
  for (let i = 0; i < 5; i++) await x.tick();
  assert.equal(x.calls.filter((call) => call.method === 'PUT').length, 4);
  assert.equal(x.pending.size, 0); assert.equal(x.state.classes['video-1'].blocks['question-1'].value, true);
});
test('401 stops automatic synchronization without losing local progress', async () => {
  const x = setup(); x.put = () => ({ status: 401, result: {} }); await x.sync.connect(true); await x.tick();
  x.sync.changed(); await x.tick(); assert.equal(x.calls.filter((call) => call.method === 'PUT').length, 1);
  assert.ok(x.state.classes['video-1']);
});
test('quota exhaustion stops retries and retains local work', async () => {
  const x = setup(); x.put = () => ({ status: 429, result: {} }); await x.sync.connect(true); await x.tick();
  assert.equal(x.pending.size, 0); x.sync.changed(); await x.tick();
  assert.equal(x.calls.filter((call) => call.method === 'PUT').length, 1);
  assert.ok(x.state.classes['video-1']);
});
test('409 merges disjoint records before revision retry', async () => {
  const x = setup(); let count = 0;
  x.put = (body) => ++count === 1 ? { status: 409, result: envelope(progress('question-2', 20), 2) } : { status: 200, result: envelope(body.progress, 3) };
  await x.sync.connect(true); await x.tick(); await x.tick();
  const writes = x.calls.filter((call) => call.method === 'PUT');
  assert.equal(writes[1].body.revision, 2);
  assert.deepEqual(Object.keys(writes[1].body.progress.classes['video-1'].blocks).sort(), ['question-1', 'question-2']);
});
test('first-generation concurrent creation is merged without erasing local records', async () => {
  const x = setup(); x.remote = envelope(emptyProgress(), 0, null); let count = 0;
  x.put = (body) => ++count === 1 ? { status: 409, result: envelope(progress('question-2', 20), 1, 'first-generation') } : { status: 200, result: envelope(body.progress, 2, 'first-generation') };
  await x.sync.connect(true); await x.tick(); await x.tick();
  assert.deepEqual(Object.keys(x.state.classes['video-1'].blocks).sort(), ['question-1', 'question-2']);
});
test('a pending old-account request cannot block or overwrite a new account', async () => {
  const x = setup(); let release;
  x.put = () => new Promise((resolve) => { release = resolve; });
  await x.sync.connect(true); const oldRequest = x.sync.flush();
  await new Promise((resolve) => setImmediate(resolve));
  await x.sync.logout(); x.subject = 'bob'; x.put = (body) => ({ status: 200, result: envelope(body.progress, 1) });
  await x.sync.connect(false); x.state = progress('question-2', 20); x.sync.changed(); await x.tick();
  release({ status: 200, result: envelope(progress(), 3) }); await oldRequest;
  const writes = x.calls.filter((call) => call.method === 'PUT');
  assert.equal(writes.length, 2); assert.equal(writes[1].headers['X-Lucas-Account'], 'bob');
  assert.equal(writes[1].body.progress.classes['video-1'].blocks['question-1'], undefined);
  assert.ok(x.state.classes['video-1'].blocks['question-2']);
  assert.equal(x.state.classes['video-1'].blocks['question-1'], undefined);
});
test('410 prevents resurrection of a deleted generation', async () => {
  const x = setup(); x.put = () => ({ status: 410, result: { ...envelope(null, 0, 'epoch-2'), deleted: true } });
  await x.sync.connect(true); await x.tick(); assert.deepEqual(x.state, emptyProgress());
  x.sync.changed(); await x.tick(); assert.equal(x.calls.filter((call) => call.method === 'PUT').length, 1);
});
test('logout removes account cache, restores anonymous original, isolates next student', async () => {
  const x = setup(); await x.sync.connect(true); const aliceKey = x.key;
  x.state = progress('question-2'); await x.sync.logout(); assert.equal(x.map.has(aliceKey), false);
  assert.equal(x.key, STORAGE_KEY); assert.ok(x.state.classes['video-1'].blocks['question-1']);
  x.subject = 'bob'; await x.sync.connect(false); assert.deepEqual(x.state, emptyProgress());
  assert.ok(x.key.endsWith(':bob')); assert.equal(x.calls.filter((call) => call.method === 'PUT').length, 0);
});
test('stale cached generation is not merged into a recreated account profile', async () => {
  const x = setup(); const key = `${STORAGE_KEY}:account:alice`;
  x.map.set(key, JSON.stringify(progress())); x.map.set(`${key}:generation`, JSON.stringify('old-generation'));
  await x.sync.connect(false); assert.deepEqual(x.state, emptyProgress()); assert.equal(x.pending.size, 0);
});
test('deletion empties active state and does not automatically upload old data', async () => {
  const x = setup(); await x.sync.connect(true); await x.sync.remove(); await x.tick();
  assert.deepEqual(x.state, emptyProgress()); assert.equal(x.calls.filter((call) => call.method === 'PUT').length, 0);
});
test('unknown classes, blocks, points and extra fields stay out of cloud payload', () => {
  const input = progress(); input.secret = 'never-upload'; input.classes.retired = { blocks: {} };
  input.classes['video-1'].blocks.retired = { value: true, updatedAt: 10 };
  input.classes['video-1'].lastPoint = { value: 'retired', updatedAt: 10 };
  input.classes['video-1'].blocks['question-1'].personal = 'never-upload';
  const output = cloudProgress(input, catalog);
  assert.equal(output.secret, undefined); assert.equal(output.classes.retired, undefined);
  assert.equal(output.classes['video-1'].blocks.retired, undefined); assert.equal(output.classes['video-1'].lastPoint, undefined);
  assert.ok(input.classes.retired); assert.ok(input.classes['video-1'].blocks.retired);
  assert.equal(output.classes['video-1'].blocks['question-1'].personal, undefined);
});
test('import rejects corrupt, future and oversized files', () => {
  assert.throws(() => readImport('{}')); assert.throws(() => readImport('{"version":2,"classes":{}}'));
  assert.throws(() => readImport(' '.repeat(65537))); assert.equal(readImport(JSON.stringify(progress())).version, 1);
});
test('other guides use isolated storage keys while Lucas keeps its existing key', () => {
  assert.equal(progressStorageKey('lucas'), STORAGE_KEY);
  assert.equal(progressStorageKey('mateo'), 'lasnotasdevero:mateo:progress:v1');
  assert.throws(() => progressStorageKey('../invalid'));
});
test('authentication changes discard queued writes and private account cache', async () => {
  const x = setup(); await x.sync.connect(true); const privateKey = x.key;
  x.sync.authenticationChanged({ authenticated: true, subject: 'bob' });
  assert.equal(x.sync.connected, false); assert.equal(x.pending.size, 0);
  assert.equal(x.map.has(privateKey), false); assert.equal(x.key, STORAGE_KEY);
  await x.tick(); assert.equal(x.calls.filter((call) => call.method === 'PUT').length, 0);
});
test('disabled frontend installs local import/export/reset without fetching config or SDK', async () => {
  const listeners = new Map(), message = {};
  const elements = new Map(['[data-progress-export]', '[data-progress-import]', '[data-progress-reset]'].map((selector) => [selector, { addEventListener(event, handler) { listeners.set(selector, handler); } }]));
  const card = { hidden: true, querySelector(selector) { return selector === '[data-account-status]' ? message : elements.get(selector); } };
  const root = { dataset: { syncEnabled: 'false', syncProvider: 'firebase', courseId: 'lucas' }, querySelector: () => card };
  const previousFetch = globalThis.fetch;
  let replaced;
  globalThis.fetch = () => { throw Error('unexpected network'); };
  try {
    await initializeSync(root, { snapshot: () => emptyProgress(), replace(value) { replaced = value; } }, catalog);
    assert.equal(card.hidden, false); assert.equal(listeners.size, 3);
    const event = { target: { files: [{ size: 200, text: async () => JSON.stringify(progress()) }], value: 'file' } };
    await listeners.get('[data-progress-import]')(event);
    assert.ok(replaced.classes['video-1'].blocks['question-1']);
    assert.equal(event.target.value, '');
  } finally { globalThis.fetch = previousFetch; }
});
test('auth change during initial remote read cancels handshake before private state activation', async () => {
  let release, activated = false;
  const controller = { snapshot: () => emptyProgress(), activate() { activated = true; } };
  const storage = { getItem: () => null, removeItem() {}, setItem() {} };
  const provider = { async request(path) {
    if (path === 'session') return { authenticated: true, subject: 'alice' };
    return new Promise((resolve) => { release = resolve; });
  } };
  const sync = createSync({ controller, provider, catalog, storage });
  const pending = sync.connect(false);
  await new Promise((resolve) => setImmediate(resolve));
  sync.authenticationChanged({ authenticated: true, subject: 'bob' });
  activated = false;
  release(envelope(progress())); await pending;
  assert.equal(activated, false); assert.equal(sync.connected, false);
});
test('account deletion can resume after reload even when erasure lock prevents connecting', async () => {
  const calls = [], storage = { getItem: () => null, removeItem() {}, setItem() {} };
  const provider = { async request(path, method, body, uid) {
    calls.push({ path, uid });
    if (path === 'session') return { authenticated: true, subject: 'alice' };
    if (path === 'progress') throw Object.assign(Error('erasing'), { status: 410 });
    return { ok: true, deleted: true };
  } };
  const sync = createSync({ provider, catalog, storage, controller: { snapshot: () => emptyProgress(), activate() {} } });
  await assert.rejects(sync.connect(false)); assert.equal(sync.connected, false);
  await sync.removeAccount();
  assert.ok(calls.some((call) => call.path === 'account/delete' && call.uid === 'alice'));
  assert.equal(sync.connected, false);
});
test('signing out before choosing progress still purges an existing private cache', async () => {
  const x = setup(); const key = `${STORAGE_KEY}:account:alice`;
  x.map.set(key, JSON.stringify(progress()));
  x.sync.authenticationChanged({ authenticated: true, subject: 'alice' });
  await x.sync.logout();
  assert.equal(x.map.has(key), false); assert.equal(x.key, STORAGE_KEY);
});
test('enabled guide CSP admits official Google popup loader without arbitrary external scripts', async () => {
  const head = await readFile(new URL('../themes/vero/layouts/partials/head.html', import.meta.url), 'utf8');
  const scripts = head.match(/script-src ([^;]+);/)[1].split(/\s+/);
  assert.deepEqual(scripts, ["'self'", 'https://apis.google.com']);
  assert.ok(!scripts.includes("'unsafe-inline'"));
  assert.ok(head.includes('(not $privateStudy)'));
});
test('verified owner can reopen and edit cached progress during outage without cloud writes', async () => {
  const x = setup(), key = `${STORAGE_KEY}:account:alice`;
  x.map.set(key, JSON.stringify(progress('question-2', 20)));
  x.map.set(`${key}:generation`, JSON.stringify('epoch-1'));
  x.readError = Object.assign(Error('unavailable'), { status: 503 });
  await x.sync.connect(false);
  assert.equal(x.key, key); assert.ok(x.state.classes['video-1'].blocks['question-2']);
  assert.equal(x.sync.connected, true); assert.equal(x.sync.cloudReady, false);
  x.state = progress('question-2', 30); x.map.set(key, JSON.stringify(x.state)); x.sync.changed(); await x.tick();
  assert.equal(x.calls.filter((call) => call.method === 'PUT').length, 0);
  assert.equal(readImport(JSON.stringify(x.state)).classes['video-1'].blocks['question-2'].updatedAt, 30);
  await assert.rejects(x.sync.remove());
});
test('outage fallback cannot open another user cache or bypass authentication failures', async () => {
  for (const [subject, status] of [['bob', 503], ['alice', 401], ['alice', 403], ['alice', 410]]) {
    const x = setup(); x.map.set(`${STORAGE_KEY}:account:alice`, JSON.stringify(progress('question-2')));
    x.subject = subject; x.readError = Object.assign(Error('blocked'), { status });
    await assert.rejects(x.sync.connect(false));
    assert.equal(x.key, STORAGE_KEY); assert.equal(x.sync.connected, false);
  }
});
test('reconnect verifies epoch before merging offline edits or discarding stale deleted progress', async () => {
  for (const generation of ['epoch-1', 'epoch-2']) {
    const x = setup(), key = `${STORAGE_KEY}:account:alice`;
    x.map.set(key, JSON.stringify(progress('question-2', 20)));
    x.map.set(`${key}:generation`, JSON.stringify('epoch-1'));
    x.readError = Object.assign(Error('quota'), { status: 429 }); await x.sync.connect(false);
    x.state = progress('question-2', 30); x.map.set(key, JSON.stringify(x.state)); x.sync.changed();
    x.readError = undefined; x.remote = envelope(progress('question-1', 10), 2, generation);
    await x.sync.connect(false);
    assert.ok(x.state.classes['video-1'].blocks['question-1']);
    assert.equal(!!x.state.classes['video-1'].blocks['question-2'], generation === 'epoch-1');
    assert.equal(x.sync.cloudReady, true);
    if (generation === 'epoch-2') assert.equal(x.pending.size, 0);
  }
});
