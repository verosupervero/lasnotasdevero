import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSync, cloudProgress, readImport, progressStorageKey, initializeSync, hasProgress } from '../static/js/study-sync.js';
import { STORAGE_KEY, emptyProgress, updateProgress, mergeProgress } from '../static/js/study-progress.js';

const catalog = [{ id: 'video-1', questions: ['question-1', 'question-2'], points: ['video-1', 'question-1', 'question-2'] }];
const progress = (question = 'question-1', time = 10) => updateProgress(emptyProgress(), 'video-1', 'block', true, time, question);
const envelope = (state = emptyProgress(), revision = 0, generation = 'epoch-1') => ({ progress: state, revision, generation, deleted: false });
function setup(sharedRemote, storedMap) {
  const map = storedMap || new Map([[STORAGE_KEY, JSON.stringify(progress())]]), pending = new Map(), calls = [], statuses = [];
  let state = progress(), key = STORAGE_KEY, index = 0, subject = 'alice', remote = envelope(), put, readError;
  const storage = { get length() { return map.size; }, key: index => [...map.keys()][index] ?? null, getItem: (name) => map.get(name) ?? null, setItem: (name, value) => map.set(name, value), removeItem: (name) => map.delete(name) };
  const controller = { snapshot: () => structuredClone(state), activate(name, next, options) { key = name; state = next; if (!options?.private) storage.setItem(name, JSON.stringify(next)); } };
  const fetcher = async (url, options) => {
    if (sharedRemote) remote = sharedRemote.value;
    const body = options.body && JSON.parse(options.body); calls.push({ url, ...options, body });
    if (url.endsWith('/progress') && options.method === 'GET' && readError) throw readError;
    let status = 200, result;
    if (url.endsWith('/session')) result = { authenticated: typeof subject === 'string', subject };
    else if (['PUT', 'PATCH'].includes(options.method)) {
      if (put) ({ status, result } = await put(body));
      else {
        result = remote = envelope(options.method === 'PATCH' ? mergeProgress(remote.progress || emptyProgress(), body.progress) : body.progress, remote.revision + 1, remote.generation || 'epoch-1');
        if (sharedRemote) sharedRemote.value = remote;
      }
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
  return { sync, controller, map, pending, calls, statuses, get state() { return state; }, get key() { return key; }, set state(value) { state = value; if (key === STORAGE_KEY) storage.setItem(key, JSON.stringify(value)); }, set subject(value) { subject = value; }, set remote(value) { remote = value; }, set put(value) { put = value; }, set readError(value) { readError = value; }, async tick() { const entry = [...pending].find(([, timer]) => timer.delay !== 12000); if (entry) { pending.delete(entry[0]); await entry[1].callback(); await new Promise((resolve) => setImmediate(resolve)); } } };
}

const privatePrefix = uid => `${STORAGE_KEY}:private:v2:${encodeURIComponent(uid)}:`;
function seedPrivate(map, uid, snapshot, generation = 'epoch-1', pending = emptyProgress()) {
  const key = `${privatePrefix(uid)}closed-tab`;
  map.set(key, JSON.stringify({ version: 2, uid, generation, snapshot, pending }));
  return key;
}
const privateRecords = (map, uid) => [...map].filter(([key]) => key.startsWith(privatePrefix(uid))).map(([, raw]) => JSON.parse(raw));

test('two live tabs send disjoint deltas, preserve both edits and do not echo storage notifications', async () => {
  const shared = { value: envelope() }, map = new Map(), a = setup(shared, map), b = setup(shared, map);
  await a.sync.connect(false); await b.sync.connect(false);
  a.state = progress('question-1', 20); a.sync.changed();
  b.state = progress('question-2', 30); b.sync.changed();
  const before = b.calls.length;
  b.sync.storageChanged({ key: a.key, newValue: map.get(a.key) });
  assert.equal(b.calls.length, before);
  await a.tick(); await b.tick();
  assert.deepEqual(Object.keys(shared.value.progress.classes['video-1'].blocks).sort(), ['question-1', 'question-2']);
  const write = b.calls.find(call => call.method === 'PATCH');
  assert.deepEqual(Object.keys(write.body.progress.classes['video-1'].blocks), ['question-2']);
  assert.equal(b.calls.filter(call => call.url.endsWith('/progress') && call.method === 'GET').length, 1);
  a.sync.storageChanged({ key: b.key, newValue: map.get(b.key) });
  assert.ok(a.state.classes['video-1'].blocks['question-2']);
  const count = a.calls.length; await a.tick(); assert.equal(a.calls.length, count);
});

test('logout removes only its writer and a literal peer removal cannot empty another tab', async () => {
  const shared = { value: envelope() }, map = new Map(), a = setup(shared, map), b = setup(shared, map);
  await a.sync.connect(false); await b.sync.connect(false);
  b.state = progress('question-2', 30); b.sync.changed(); const bRaw = map.get(b.key), aKey = a.key;
  await a.sync.logout();
  b.sync.storageChanged({ key: aKey, newValue: null });
  assert.ok(b.state.classes['video-1'].blocks['question-2']); assert.equal(map.get(b.key), bRaw);
  await b.tick(); assert.ok(shared.value.progress.classes['video-1'].blocks['question-2']);
});

test('reset notification pauses an old generation and delayed events cannot restart stale writes', async () => {
  const shared = { value: envelope() }, map = new Map(), a = setup(shared, map), b = setup(shared, map);
  await a.sync.connect(false); await b.sync.connect(false);
  b.state = progress('question-2', 30); b.sync.changed(); const oldKey = b.key, oldRaw = map.get(oldKey);
  await a.sync.remove(); shared.value = { ...envelope(null, 1, 'epoch-2'), deleted: true };
  b.sync.storageChanged({ key: a.key, newValue: map.get(a.key) });
  b.sync.storageChanged({ key: oldKey + '-delayed-peer', newValue: oldRaw });
  await b.tick(); assert.equal(b.calls.filter(call => call.method === 'PATCH').length, 0);
  await b.sync.connect(false); assert.deepEqual(b.state, emptyProgress());
  assert.equal(b.pending.size, 0);
});

test('cold offline caches with contradictory epochs never pick an old high-activity snapshot', async () => {
  const x = setup();
  seedPrivate(x.map, 'alice', progress('question-1', 900), 'old');
  x.map.set(`${privatePrefix('alice')}new-empty`, JSON.stringify({ version: 2, uid: 'alice', generation: 'new', snapshot: emptyProgress(), pending: emptyProgress() }));
  x.readError = Object.assign(Error('offline'), { status: 503 });
  await assert.rejects(x.sync.resume(), error => error.code === 'ambiguous-cache');
  assert.equal(x.sync.connected, false); assert.equal(x.key, STORAGE_KEY);
  assert.equal(x.calls.some(call => call.method === 'PATCH'), false);
});

test('explicit account erasure removes all its local writers and blocks active peer resurrection', async () => {
  const shared = { value: envelope() }, map = new Map(), a = setup(shared, map), b = setup(shared, map);
  await a.sync.connect(false); await b.sync.connect(false);
  b.state = progress('question-2', 30); b.sync.changed();
  const bobKey = seedPrivate(map, 'bob', progress('question-1')); const bobRaw = map.get(bobKey);
  await a.sync.removeAccount();
  const marker = `${STORAGE_KEY}:private:erased:v2:alice`;
  b.sync.storageChanged({ key: marker, newValue: map.get(marker) });
  assert.equal(b.sync.connected, false); assert.equal(b.key, STORAGE_KEY);
  assert.equal(privateRecords(map, 'alice').length, 0); assert.equal(map.get(bobKey), bobRaw);
  b.sync.authenticationChanged({ authenticated: true, subject: 'alice' });
  await b.tick(); assert.equal(b.calls.some(call => call.method === 'PATCH'), false);
  await assert.rejects(b.sync.connect(false)); assert.equal(privateRecords(map, 'alice').length, 0);
});

test('same-generation reload keeps retired local IDs without turning snapshots into cloud edits', async () => {
  const snapshot = progress('question-1', 20);
  snapshot.classes.retired = { blocks: { old: { value: false, updatedAt: 10 } } };
  snapshot.classes['video-1'].blocks.retired = { value: true, updatedAt: 10 };
  const map = new Map(); seedPrivate(map, 'alice', snapshot);
  const x = setup(undefined, map); x.remote = envelope(progress('question-2', 30), 2);
  await x.sync.resume();
  assert.ok(x.state.classes.retired); assert.ok(x.state.classes['video-1'].blocks.retired);
  assert.equal(x.pending.size, 0);
  x.state = updateProgress(x.state, 'video-1', 'complete', true, 40); x.sync.changed(); await x.tick();
  const write = x.calls.find(call => call.method === 'PATCH');
  assert.equal(write.body.progress.classes.retired, undefined);
  assert.equal(write.body.progress.classes['video-1'].blocks.retired, undefined);
  const reloaded = setup(undefined, map); await reloaded.sync.resume();
  assert.ok(reloaded.state.classes.retired); assert.ok(reloaded.state.classes['video-1'].blocks.retired);
});

test('account deletion distinguishes remote success from a failed local wipe', async () => {
  const sync = createSync({ catalog, controller: { snapshot: emptyProgress, activate() {} },
    storage: { getItem: () => null, setItem() { throw Error('synthetic-denied'); }, removeItem() { throw Error('synthetic-denied'); } },
    provider: { async request(path) { return path === 'session' ? { authenticated: true, subject: 'alice' } : { deleted: true }; } }
  });
  assert.deepEqual(await sync.removeAccount(), { deleted: true, localErased: false });
});

test('no anonymous upload until explicitly connected; importing is opt-in', async () => {
  const x = setup(); x.sync.changed(); assert.equal(x.calls.length, 0);
  await x.sync.connect(false); assert.deepEqual(x.state, emptyProgress());
  assert.equal(x.pending.size, 0); assert.ok(x.map.get(STORAGE_KEY).includes('question-1'));
});
for (const initiallyChooseRemote of [false, true]) {
  test(`combines phone account progress and PC anonymous progress${initiallyChooseRemote ? ' after initially choosing only account progress' : ' on first connection'}`, async () => {
    const sharedRemote = { value: envelope() };
    const phone = setup(sharedRemote), pc = setup(sharedRemote);
    // Phone studies while signed in. PC studies without an account first.
    await phone.sync.connect(false);
    phone.state = progress('question-1', 10); phone.sync.changed(); await phone.tick();
    pc.state = progress('question-2', 20);
    pc.map.set(STORAGE_KEY, JSON.stringify(pc.state));
    pc.sync.changed();
    assert.equal(pc.calls.length, 0);
    if (initiallyChooseRemote) {
      await pc.sync.connect(false);
      assert.equal(pc.state.classes['video-1'].blocks['question-2'], undefined);
      assert.ok(JSON.parse(pc.map.get(STORAGE_KEY)).classes['video-1'].blocks['question-2']);
    }
    await pc.sync.connect(true); await pc.tick();
    await phone.sync.connect(false);
    for (const state of [pc.state, phone.state, sharedRemote.value.progress]) {
      assert.deepEqual(Object.keys(state.classes['video-1'].blocks).sort(), ['question-1', 'question-2']);
    }
    assert.ok(JSON.parse(pc.map.get(STORAGE_KEY)).classes['video-1'].blocks['question-2']);
  });
}
test('coalesces actual changes and does not poll after upload', async () => {
  const x = setup(); await x.sync.connect(true); x.sync.changed(); x.sync.changed();
  assert.equal(x.pending.size, 1); await x.tick();
  assert.equal(x.calls.filter((call) => call.method === 'PATCH').length, 1);
  assert.equal(x.pending.size, 0); assert.equal(x.statuses.at(-1), 'Sincronizado');
  for (const call of x.calls.filter((item) => item.url.endsWith('/progress'))) assert.equal(call.headers['X-Lucas-Account'], 'alice');
});
test('network failure preserves local state and retries at most three times', async () => {
  const x = setup(); x.put = () => { throw Error('offline'); }; await x.sync.connect(true);
  for (let i = 0; i < 5; i++) await x.tick();
  assert.equal(x.calls.filter((call) => call.method === 'PATCH').length, 4);
  assert.equal(x.pending.size, 0); assert.equal(x.state.classes['video-1'].blocks['question-1'].value, true);
});
test('401 stops automatic synchronization without losing local progress', async () => {
  const x = setup(); x.put = () => ({ status: 401, result: {} }); await x.sync.connect(true); await x.tick();
  x.sync.changed(); await x.tick(); assert.equal(x.calls.filter((call) => call.method === 'PATCH').length, 1);
  assert.ok(x.state.classes['video-1']);
});
test('quota exhaustion stops retries and retains local work', async () => {
  const x = setup(); x.put = () => ({ status: 429, result: {} }); await x.sync.connect(true); await x.tick();
  assert.equal(x.pending.size, 0); x.sync.changed(); await x.tick();
  assert.equal(x.calls.filter((call) => call.method === 'PATCH').length, 1);
  assert.ok(x.state.classes['video-1']);
});
test('409 merges disjoint records before revision retry', async () => {
  const x = setup(); let count = 0;
  x.put = (body) => ++count === 1 ? { status: 409, result: envelope(progress('question-2', 20), 2) } : { status: 200, result: envelope(body.progress, 3) };
  await x.sync.connect(true); await x.tick(); await x.tick();
  const writes = x.calls.filter((call) => call.method === 'PATCH');
  assert.equal(writes[1].body.revision, 2);
  assert.deepEqual(Object.keys(writes[1].body.progress.classes['video-1'].blocks), ['question-1']);
  assert.deepEqual(Object.keys(x.state.classes['video-1'].blocks).sort(), ['question-1', 'question-2']);
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
  // An SDK account switch invalidates old writes without awaiting their network.
  x.sync.authenticationChanged({ authenticated: true, subject: 'bob' }); x.subject = 'bob'; x.put = (body) => ({ status: 200, result: envelope(body.progress, 1) });
  await x.sync.connect(false); x.state = progress('question-2', 20); x.sync.changed(); await x.tick();
  release({ status: 200, result: envelope(progress(), 3) }); await oldRequest;
  const writes = x.calls.filter((call) => call.method === 'PATCH');
  assert.equal(writes.length, 2); assert.equal(writes[1].headers['X-Lucas-Account'], 'bob');
  assert.equal(writes[1].body.progress.classes['video-1'].blocks['question-1'], undefined);
  assert.ok(x.state.classes['video-1'].blocks['question-2']);
  assert.equal(x.state.classes['video-1'].blocks['question-1'], undefined);
});
test('410 prevents resurrection of a deleted generation', async () => {
  const x = setup(); x.put = () => ({ status: 410, result: { ...envelope(null, 0, 'epoch-2'), deleted: true } });
  await x.sync.connect(true); await x.tick(); assert.deepEqual(x.state, emptyProgress());
  x.sync.changed(); await x.tick(); assert.equal(x.calls.filter((call) => call.method === 'PATCH').length, 1);
});
test('logout removes account cache, restores anonymous original, isolates next student', async () => {
  const x = setup(); await x.sync.connect(true); const aliceKey = x.key;
  x.state = progress('question-2'); x.sync.changed(); await x.sync.logout(); assert.equal(x.map.has(aliceKey), false);
  assert.equal(x.key, STORAGE_KEY); assert.ok(x.state.classes['video-1'].blocks['question-1']);
  x.subject = 'bob'; x.remote = envelope(); await x.sync.connect(false); assert.deepEqual(x.state, emptyProgress());
  assert.ok(x.key.startsWith(privatePrefix('bob'))); assert.equal(x.calls.filter((call) => call.method === 'PATCH').length, 1);
});
test('stale cached generation is not merged into a recreated account profile', async () => {
  const x = setup(); const key = `${STORAGE_KEY}:account:alice`;
  x.map.set(key, JSON.stringify(progress())); x.map.set(`${key}:generation`, JSON.stringify('old-generation'));
  await x.sync.connect(false); assert.deepEqual(x.state, emptyProgress()); assert.equal(x.pending.size, 0);
});
test('deletion empties active state and does not automatically upload old data', async () => {
  const x = setup(); await x.sync.connect(true); await x.sync.remove(); await x.tick();
  assert.deepEqual(x.state, emptyProgress()); assert.equal(x.calls.filter((call) => call.method === 'PATCH').length, 0);
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
test('authentication changes cancel queued writes and retain pending cache privately for its owner', async () => {
  const x = setup(); await x.sync.connect(true); const privateKey = x.key;
  x.sync.authenticationChanged({ authenticated: true, subject: 'bob' });
  assert.equal(x.sync.connected, false); assert.equal(x.pending.size, 0);
  assert.equal(x.map.has(privateKey), true); assert.ok(JSON.parse(x.map.get(privateKey)).pending.classes['video-1']); assert.equal(x.key, STORAGE_KEY);
  await x.tick(); assert.equal(x.calls.filter((call) => call.method === 'PATCH').length, 0);
});
test('disabled frontend installs local import/export/reset without fetching config or SDK', async () => {
  const listeners = new Map(), message = {};
  const elements = new Map(['[data-progress-export]', '[data-progress-import]', '[data-progress-reset]'].map((selector) => [selector, { addEventListener(event, handler) { listeners.set(selector, handler); } }]));
  const card = { hidden: true, querySelector(selector) { return selector === '[data-account-status]' ? message : elements.get(selector); } };
  const root = { dataset: { syncEnabled: 'false', syncProvider: 'firebase', courseId: 'lucas' }, querySelector: (selector) => selector === '[data-account-status]' ? message : card };
  const previousFetch = globalThis.fetch;
  let replaced, pending = true;
  globalThis.fetch = () => { throw Error('unexpected network'); };
  try {
    await initializeSync(root, { snapshot: () => emptyProgress(), replace(value) { replaced = value; }, setProgressPending(value) { pending = value; } }, catalog);
    assert.equal(card.hidden, false); assert.equal(listeners.size, 3);
    assert.equal(pending, false);
    const event = { target: { files: [{ size: 200, text: async () => JSON.stringify(progress()) }], value: 'file' } };
    await listeners.get('[data-progress-import]')(event);
    assert.ok(replaced.classes['video-1'].blocks['question-1']);
    assert.equal(event.target.value, '');
  } finally { globalThis.fetch = previousFetch; }
});
test('a stalled Firebase bootstrap releases local progress and ignores a late configuration response', async () => {
  const listeners = new Map(), message = {}, pending = [];
  const elements = new Map(['[data-progress-export]', '[data-progress-import]', '[data-progress-reset]'].map(selector => [selector, { addEventListener(event, handler) { listeners.set(selector, handler); } }]));
  const card = { querySelector(selector) { return selector === '[data-account-status]' ? message : elements.get(selector); } };
  const root = { dataset: { syncEnabled: 'true', syncProvider: 'firebase', courseId: 'lucas' }, querySelector: (selector) => selector === '[data-account-status]' ? message : card };
  const previous = { fetch: globalThis.fetch, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  let expire, release, signal, calls = 0, jsonReads = 0, replaced, activated = 0, subscriptions = 0, cleared;
  globalThis.fetch = (url, options) => { calls++; signal = options.signal; return new Promise(resolve => { release = resolve; }); };
  globalThis.setTimeout = (callback, delay) => { assert.equal(delay, 12000); expire = callback; return 42; };
  globalThis.clearTimeout = handle => { cleared = handle; };
  try {
    const loading = initializeSync(root, { snapshot: () => emptyProgress(), replace(value) { replaced = value; }, setProgressPending(value) { pending.push(value); }, activate() { activated++; }, subscribe() { subscriptions++; } }, catalog);
    assert.deepEqual(pending, [true]);assert.equal(signal.aborted, false);
    expire();await loading;
    assert.equal(signal.aborted, true);assert.equal(cleared, 42);assert.deepEqual(pending, [true, false]);
    assert.match(message.textContent, /Podés continuar y exportar tu avance sin cuenta/);
    assert.equal(listeners.size, 3);
    await listeners.get('[data-progress-import]')({ target: { files: [{ size: 200, text: async () => JSON.stringify(progress()) }], value: 'file' } });
    assert.ok(replaced.classes['video-1'].blocks['question-1']);
    release({ ok: true, json: async () => { jsonReads++; throw Error('late response must be ignored'); } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);assert.equal(jsonReads, 0);assert.equal(activated, 0);assert.equal(subscriptions, 0);
    assert.deepEqual(pending, [true, false]);
  } finally { Object.assign(globalThis, previous); }
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
test('signing out before choosing preserves an unverifiable legacy copy for explicit export', async () => {
  const x = setup(); const key = `${STORAGE_KEY}:account:alice`;
  x.map.set(key, JSON.stringify(progress()));
  x.sync.authenticationChanged({ authenticated: true, subject: 'alice' });
  assert.deepEqual(x.sync.legacySnapshot(), progress());
  await x.sync.logout();
  assert.equal(x.map.has(key), true); assert.equal(x.key, STORAGE_KEY);
  assert.equal(x.sync.legacySnapshot(), undefined);
});
test('reload resumes verified account progress without importing the separate anonymous copy', async () => {
  const shared = { value: envelope(progress('question-2', 20), 1) };
  const first = setup(shared); await first.sync.connect(false);
  const reloaded = setup(shared, first.map);
  assert.equal(await reloaded.sync.resume(), true);
  assert.ok(reloaded.state.classes['video-1'].blocks['question-2']);
  assert.equal(reloaded.state.classes['video-1'].blocks['question-1'], undefined);
  assert.ok(JSON.parse(reloaded.map.get(STORAGE_KEY)).classes['video-1'].blocks['question-1']);
  assert.equal(reloaded.pending.size, 0);
  assert.equal(reloaded.calls.filter((call) => call.method === 'PATCH').length, 0);
});
test('resume requires authenticated ownership and a valid atomic private generation', async () => {
  for (const scenario of ['other-user', 'missing-cache', 'corrupt-cache', 'missing-marker', 'corrupt-marker', 'invalid-marker', 'unauthenticated']) {
    const x = setup(), key = seedPrivate(x.map, 'alice', progress('question-2'));
    if (scenario === 'other-user') x.subject = 'bob';
    if (scenario === 'missing-cache') x.map.delete(key);
    if (scenario === 'corrupt-cache') x.map.set(key, '{}');
    if (scenario === 'missing-marker') { const value = JSON.parse(x.map.get(key)); delete value.generation; x.map.set(key, JSON.stringify(value)); }
    if (scenario === 'corrupt-marker') { const value = JSON.parse(x.map.get(key)); value.generation = {}; x.map.set(key, JSON.stringify(value)); }
    if (scenario === 'invalid-marker') { const value = JSON.parse(x.map.get(key)); value.generation = ''; x.map.set(key, JSON.stringify(value)); }
    if (scenario === 'unauthenticated') x.subject = undefined;
    assert.equal(await x.sync.resume(), false, scenario);
    assert.equal(x.sync.connected, false, scenario);
    assert.equal(x.calls.some((call) => call.url.endsWith('/progress')), false, scenario);
  }
});
test('resume discards cached progress after a generation change or remote deletion', async () => {
  for (const deleted of [false, true]) {
    const x = setup(); seedPrivate(x.map, 'alice', progress('question-2'), 'epoch-1', progress('question-2'));
    x.remote = { ...envelope(emptyProgress(), 0, 'epoch-2'), deleted };
    assert.equal(await x.sync.resume(), true);
    assert.deepEqual(x.state, emptyProgress());
    assert.equal(x.pending.size, 0);
  }
});
test('resume opens only verified owner cache offline and leaves synchronization paused', async () => {
  const x = setup(); seedPrivate(x.map, 'alice', progress('question-2'));
  x.readError = Object.assign(Error('unavailable'), { status: 503 });
  assert.equal(await x.sync.resume(), true);
  assert.equal(x.sync.cloudReady, false);
  assert.ok(x.state.classes['video-1'].blocks['question-2']);
  assert.equal(x.pending.size, 0);
});
test('auth switch during resume cannot activate previous owner progress', async () => {
  let release, subject = 'alice', state = emptyProgress();
  const map = new Map(); seedPrivate(map, 'alice', progress());
  const sync = createSync({ catalog, storage: { get length() { return map.size; }, key: index => [...map.keys()][index], getItem: (key) => map.get(key) ?? null, setItem() {}, removeItem() {} }, controller: { snapshot: () => state, activate(key, value) { state = value; } }, provider: { async request(path) {
    if (path === 'session') return { authenticated: true, subject };
    return new Promise((resolve) => { release = resolve; });
  } } });
  const resuming = sync.resume();
  await new Promise((resolve) => setImmediate(resolve));
  subject = 'bob'; sync.authenticationChanged({ authenticated: true, subject });
  release(envelope(progress()));
  assert.equal(await resuming, false); assert.equal(sync.connected, false);
  assert.deepEqual(state, emptyProgress());
});
test('enabled guide CSP admits official Google popup loader without arbitrary external scripts', async () => {
  const head = await readFile(new URL('../themes/vero/layouts/partials/head.html', import.meta.url), 'utf8');
  const appCheckBlock = /\{\{ if \$appCheck \}\}([\s\S]*?)\{\{ end \}\}/g;
  assert.equal([...head.matchAll(appCheckBlock)].length, 3);
  // Resolve only the known App Check condition. Unknown template syntax must fail
  // the exact allowlists below rather than silently expanding permitted hosts.
  for (const enabled of [false, true]) {
    const rendered = head.replace(appCheckBlock, (_, content) => enabled ? content : '');
    const directive = name => rendered.match(new RegExp(`${name} ([^;]+);`))[1].split(/\s+/);
    const scripts = directive('script-src');
    assert.deepEqual(scripts, ["'self'", 'https://apis.google.com', ...(enabled ? ['https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/'] : [])]);
    assert.ok(!scripts.includes("'unsafe-inline'"));
    assert.deepEqual(directive('connect-src'), ["'self'", 'https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com', 'https://firestore.googleapis.com', 'https://*.firebaseapp.com', ...(enabled ? ['https://content-firebaseappcheck.googleapis.com', 'https://www.google.com/recaptcha/'] : [])]);
    assert.deepEqual(directive('frame-src'), ['https://www.youtube-nocookie.com', 'https://www.youtube.com', 'https://*.firebaseapp.com', 'https://accounts.google.com', ...(enabled ? ['https://www.google.com/recaptcha/', 'https://recaptcha.google.com/recaptcha/'] : [])]);
  }
  assert.ok(head.includes('(not $privateStudy)'));
});
test('verified owner can reopen and edit cached progress during outage without cloud writes', async () => {
  const x = setup(); seedPrivate(x.map, 'alice', progress('question-2', 20));
  x.readError = Object.assign(Error('unavailable'), { status: 503 });
  await x.sync.connect(false);
  assert.ok(x.key.startsWith(privatePrefix('alice'))); assert.ok(x.state.classes['video-1'].blocks['question-2']);
  assert.equal(x.sync.connected, true); assert.equal(x.sync.cloudReady, false);
  x.state = progress('question-2', 30); x.sync.changed(); await x.tick();
  assert.equal(x.calls.filter((call) => call.method === 'PATCH').length, 0);
  assert.equal(readImport(JSON.stringify(x.state)).classes['video-1'].blocks['question-2'].updatedAt, 30);
  await assert.rejects(x.sync.remove());
});
test('outage fallback cannot open another user cache or bypass authentication failures', async () => {
  for (const [subject, status] of [['bob', 503], ['alice', 401], ['alice', 403], ['alice', 410]]) {
    const x = setup(); seedPrivate(x.map, 'alice', progress('question-2'));
    x.subject = subject; x.readError = Object.assign(Error('blocked'), { status });
    await assert.rejects(x.sync.connect(false));
    assert.equal(x.key, STORAGE_KEY); assert.equal(x.sync.connected, false);
  }
});
test('reconnect verifies epoch before merging offline edits or discarding stale deleted progress', async () => {
  for (const generation of ['epoch-1', 'epoch-2']) {
    const x = setup(); seedPrivate(x.map, 'alice', progress('question-2', 20));
    x.readError = Object.assign(Error('quota'), { status: 429 }); await x.sync.connect(false);
    x.state = progress('question-2', 30); x.sync.changed();
    x.readError = undefined; x.remote = envelope(progress('question-1', 10), 2, generation);
    await x.sync.connect(false);
    assert.ok(x.state.classes['video-1'].blocks['question-1']);
    assert.equal(!!x.state.classes['video-1'].blocks['question-2'], generation === 'epoch-1');
    assert.equal(x.sync.cloudReady, true);
    if (generation === 'epoch-2') assert.equal(x.pending.size, 0);
  }
});

test('read-only account inspection identifies local and cloud progress without activating or writing', async () => {
  const x = setup(); x.remote = envelope(progress('question-2', 20));
  const before = new Map(x.map), local = structuredClone(x.state);
  assert.deepEqual(await x.sync.inspect(), { subject: 'alice', hasLocal: true, hasRemote: true });
  assert.equal(x.sync.connected, false); assert.deepEqual(x.map, before); assert.deepEqual(x.state, local);
  assert.equal(x.pending.size, 0); assert.ok(x.calls.every(call => call.method === 'GET'));
  assert.equal(x.calls.find(call => call.url.endsWith('/progress')).headers['X-Lucas-Account'], 'alice');
});
test('inspection reports empty and deleted account progress truthfully', async () => {
  const x = setup();
  assert.equal((await x.sync.inspect()).hasRemote, false);
  x.remote = { ...envelope(progress()), deleted: true };
  assert.equal((await x.sync.inspect()).hasRemote, false);
  assert.equal(x.sync.connected, false);
});
test('progress detection retains reading positions and explicit unchecked records', () => {
  assert.equal(hasProgress(emptyProgress()), false);
  assert.equal(hasProgress({ version: 1, classes: { lesson: { blocks: {} } } }), false);
  assert.equal(hasProgress({ ...emptyProgress(), selected: { value: 'lesson', updatedAt: 0 } }), true);
  const state = progress(); state.classes['video-1'].blocks['question-1'].value = false;
  assert.equal(hasProgress(state), true);
});
test('inspection failures keep local work intact and never start uploads', async () => {
  const x = setup(), before = structuredClone(x.state);
  x.readError = Error('offline');
  await assert.rejects(x.sync.inspect());
  assert.deepEqual(x.state, before); assert.equal(x.sync.connected, false); assert.equal(x.pending.size, 0);
  assert.ok(x.calls.every(call => call.method === 'GET'));
});
test('account change during read-only inspection rejects the stale comparison', async () => {
  let release, subject = 'alice', activated = false;
  const sync = createSync({ catalog, controller: { snapshot: () => progress(), activate() { activated = true; } },
    storage: { getItem: () => null, setItem() { throw Error('write'); }, removeItem() {} },
    provider: { async request(path) {
      if (path === 'session') return { authenticated: true, subject };
      return new Promise(resolve => { release = resolve; });
    } } });
  const reading = sync.inspect(); await new Promise(resolve => setImmediate(resolve));
  subject = 'bob'; release(envelope(progress()));
  await assert.rejects(reading); assert.equal(activated, false); assert.equal(sync.connected, false);
});

test('logout uploads immediately before debounce and clears only acknowledged private progress', async () => {
  const x = setup(); await x.sync.connect(false);
  x.state = progress('question-2', 20); x.sync.changed();
  const privateKey = x.key;
  await x.sync.logout();
  const write = x.calls.findIndex(call => call.method === 'PATCH');
  const signout = x.calls.findIndex(call => call.url.endsWith('/auth/logout'));
  assert.ok(write >= 0 && signout > write);
  assert.equal(x.map.has(privateKey), false); assert.equal(x.map.has(`${privateKey}:pending`), false);
  assert.equal(x.pending.size, 0); assert.equal(x.key, STORAGE_KEY);
});
test('failed logout upload retains pending UID copy without sending it while signed out', async () => {
  const x = setup(); await x.sync.connect(false);
  x.state = progress('question-2', 20); x.sync.changed(); const privateKey = x.key;
  x.put = () => { throw Error('offline'); };
  await x.sync.logout();
  const saved = JSON.parse(x.map.get(privateKey));
  assert.ok(saved.pending.classes['video-1'].blocks['question-2']);
  assert.ok(saved.snapshot.classes['video-1'].blocks['question-2']);
  assert.equal(saved.generation, 'epoch-1');
  x.sync.authenticationChanged({ authenticated: false });
  const before = x.calls.length; await x.sync.retry(); await x.tick();
  assert.equal(x.calls.length, before); assert.equal(x.sync.connected, false);
  assert.match(x.statuses.at(-1), /misma cuenta Google/);
});
test('pending private copy resumes only for its verified owner without importing anonymous progress', async () => {
  const x = setup(); await x.sync.connect(false);
  x.state = progress('question-2', 20); x.sync.changed(); x.put = () => { throw Error('offline'); };
  await x.sync.logout();
  const bob = setup(undefined, x.map); bob.subject = 'bob';
  assert.equal(await bob.sync.resume(), false);
  assert.equal(bob.calls.some(call => call.url.endsWith('/progress')), false);
  const alice = setup(undefined, x.map);
  assert.equal(await alice.sync.resume(), true); await alice.tick();
  assert.ok(alice.state.classes['video-1'].blocks['question-2']);
  assert.equal(alice.state.classes['video-1'].blocks['question-1'], undefined);
  assert.equal(alice.map.has(`${alice.key}:pending`), false);
});
test('online recovery verifies the generation then silently uploads; repeated events are grouped', async () => {
  const x = setup(); await x.sync.connect(false);
  x.state = progress('question-2', 20); x.sync.changed();
  x.put = () => { throw Error('offline'); }; await x.sync.flush();
  x.put = undefined;
  await Promise.all([x.sync.retry(), x.sync.retry(), x.sync.retry()]);
  assert.equal(x.calls.filter(call => call.url.endsWith('/progress') && call.method === 'GET').length, 2);
  assert.equal(x.calls.filter(call => call.method === 'PATCH').length, 2);
  assert.equal(x.statuses.at(-1), 'Sincronizado');
  const count = x.calls.length; await x.sync.retry(); assert.equal(x.calls.length, count);
});
test('online recovery cannot resurrect deleted generations or use another SDK identity', async () => {
  for (const scenario of ['reset', 'different-owner']) {
    const x = setup(); await x.sync.connect(false);
    x.state = progress('question-2', 20); x.sync.changed();
    x.put = () => { throw Error('offline'); }; await x.sync.flush();
    x.put = undefined;
    if (scenario === 'reset') x.remote = { ...envelope(emptyProgress(), 0, 'epoch-2'), deleted: true };
    else x.subject = 'bob';
    await x.sync.retry();
    assert.equal(x.calls.filter(call => call.method === 'PATCH').length, 1, scenario);
    if (scenario === 'reset') { assert.deepEqual(x.state, emptyProgress()); assert.equal(x.map.has(`${x.key}:pending`), false); }
  }
});
test('authentication and quota failures do not trigger automatic online retries', async () => {
  for (const status of [400, 401, 403, 410, 422, 429]) {
    const x = setup(); await x.sync.connect(true);
    x.put = () => ({ status, result: status === 410 ? { ...envelope(emptyProgress(), 0, 'epoch-2'), deleted: true } : {} });
    await x.sync.flush(); const before = x.calls.length;
    await Promise.all([x.sync.retry(), x.sync.retry(), x.sync.retry()]);
    assert.equal(x.calls.length, before, String(status));
  }
});
test('logout joins inflight uploads, drains newer edits once and coalesces repeated clicks', async () => {
  const x = setup(); await x.sync.connect(false); let release;
  x.state = progress('question-1', 20); x.sync.changed();
  x.put = body => new Promise(resolve => { release = () => resolve({ status: 200, result: envelope(body.progress, 1) }); });
  const uploading = x.sync.flush(); await new Promise(resolve => setImmediate(resolve));
  x.state = updateProgress(x.state, 'video-1', 'block', true, 30, 'question-2'); x.sync.changed();
  const first = x.sync.logout(), second = x.sync.logout(); assert.equal(first, second);
  x.put = body => ({ status: 200, result: envelope(body.progress, 2) });
  release(); await uploading; await first;
  assert.equal(x.calls.filter(call => call.method === 'PATCH').length, 2);
  assert.equal(x.calls.filter(call => call.url.endsWith('/auth/logout')).length, 1);
  assert.equal(x.calls.filter(call => call.method === 'PATCH').at(-1).body.progress.classes['video-1'].blocks['question-2'].value, true);
  assert.equal(x.map.has(`${STORAGE_KEY}:account:alice`), false);
});
test('acknowledgment leaves a peer queue intact and its pending edit recovers after a closed tab', async () => {
  const shared = { value: envelope() }, map = new Map();
  const x = setup(shared, map), peer = setup(shared, map);
  await x.sync.connect(false); await peer.sync.connect(false); let release;
  x.state = progress('question-1', 20); x.sync.changed();
  x.put = body => new Promise(resolve => { release = () => resolve({ status: 200, result: envelope(body.progress, 1) }); });
  const uploading = x.sync.flush(); await new Promise(resolve => setImmediate(resolve));
  peer.state = progress('question-2', 30); peer.sync.changed();
  const peerRaw = map.get(peer.key);
  release(); await uploading;
  assert.equal(map.get(peer.key), peerRaw);
  const reloaded = setup(shared, map); await reloaded.sync.resume(); await reloaded.tick();
  assert.ok(reloaded.state.classes['video-1'].blocks['question-2']);
  assert.ok(shared.value.progress.classes['video-1'].blocks['question-2']);
  assert.equal(map.get(peer.key), peerRaw);
});
test('logout keeps the sole in-memory copy open when upload and private storage both fail', async () => {
  let state = emptyProgress(); const calls = [];
  const sync = createSync({ catalog, schedule: () => 0, cancel() {}, controller: { snapshot: () => state, activate(key, value) { state = value; } },
    storage: { getItem: () => null, setItem() { throw Error('quota'); }, removeItem() {} },
    provider: { async request(path, method) {
      calls.push({ path, method });
      if (path === 'session') return { authenticated: true, subject: 'alice' };
      if (method === 'PATCH') throw Error('offline');
      return envelope();
    } } });
  await sync.connect(false); state = progress('question-2', 20); sync.changed();
  await assert.rejects(sync.logout(), error => error.code === 'pending-storage');
  assert.equal(sync.connected, true); assert.ok(state.classes['video-1'].blocks['question-2']);
  assert.equal(calls.some(call => call.path === 'auth/logout'), false);
});

test('successful account deletion removes its pending cache even if auth callback changes context first', async () => {
  for (const nextSubject of [undefined, 'bob']) {
    let state = progress(), sync, subject = 'alice';
    const key = `${STORAGE_KEY}:account:alice`;
    const map = new Map([[key, JSON.stringify(progress())], [`${key}:generation`, '"epoch-1"'], [`${key}:pending`, 'true']]);
    const bobKey = `${STORAGE_KEY}:account:bob`; map.set(bobKey, 'keep-bob');
    sync = createSync({ catalog,
      controller: { snapshot: () => state, activate(name, value) { state = value; } },
      storage: { getItem: name => map.get(name) ?? null, setItem(name, value) { map.set(name, value); }, removeItem(name) { map.delete(name); } },
      provider: { async request(path) {
        if (path === 'session') return { authenticated: true, subject };
        if (path === 'account/delete') {
          subject = nextSubject;
          sync.authenticationChanged({ authenticated: !!subject, subject });
          return { deleted: true };
        }
        return envelope();
      } } });
    sync.authenticationChanged({ authenticated: true, subject: 'alice' });
    await sync.removeAccount();
    assert.equal(map.has(key), false); assert.equal(map.has(`${key}:generation`), false); assert.equal(map.has(`${key}:pending`), false);
    assert.equal(map.get(bobKey), 'keep-bob');
  }
});

test('reconnect and destructive actions cannot cancel a logout awaiting its upload', async () => {
  const x = setup(); await x.sync.connect(false); let release;
  x.state = progress('question-2', 20); x.sync.changed();
  x.put = body => new Promise(resolve => { release = () => resolve({ status: 200, result: envelope(body.progress, 1) }); });
  const exiting = x.sync.logout(); await new Promise(resolve => setImmediate(resolve));
  for (const action of [() => x.sync.connect(false), () => x.sync.resume(), () => x.sync.remove(), () => x.sync.removeAccount()]) {
    await assert.rejects(action(), error => error.code === 'closing');
  }
  release(); await exiting;
  assert.equal(x.sync.connected, false);
  assert.equal(x.calls.filter(call => call.url.endsWith('/auth/logout')).length, 1);
});
test('an SDK identity change during logout reports interruption rather than claiming sign-out', async () => {
  const x = setup(); await x.sync.connect(false); let release;
  x.state = progress('question-2', 20); x.sync.changed();
  x.put = body => new Promise(resolve => { release = () => resolve({ status: 200, result: envelope(body.progress, 1) }); });
  const exiting = x.sync.logout(); await new Promise(resolve => setImmediate(resolve));
  x.subject = 'bob'; x.sync.authenticationChanged({ authenticated: true, subject: 'bob' });
  release(); await assert.rejects(exiting, error => error.code === 'logout-context');
  assert.equal(x.calls.some(call => call.url.endsWith('/auth/logout')), false);
  assert.ok(privateRecords(x.map, 'alice').some(record => record.pending.classes['video-1']));
});

test('offline pending edits from the empty initial generation merge with another device first creation', async () => {
  const pc = setup(); pc.remote = envelope(emptyProgress(), 0, null);
  await pc.sync.connect(false); pc.state = progress('question-1', 20); pc.sync.changed();
  pc.put = () => { throw Error('offline'); }; await pc.sync.logout();
  assert.equal(privateRecords(pc.map, 'alice')[0].generation, null);
  const returning = setup(undefined, pc.map), firstRemote = envelope(progress('question-2', 30), 1, 'first-generation');
  returning.remote = firstRemote;
  returning.put = body => body.generation === null
    ? { status: 409, result: firstRemote }
    : { status: 200, result: envelope(body.progress, 2, 'first-generation') };
  assert.equal(await returning.sync.resume(), true); await returning.tick();
  assert.deepEqual(Object.keys(returning.state.classes['video-1'].blocks).sort(), ['question-1', 'question-2']);
  assert.deepEqual(JSON.parse(returning.map.get(returning.key)).pending, emptyProgress());
  const requests = returning.calls.filter(call => ['PUT', 'PATCH'].includes(call.method));
  assert.equal(requests[0].body.generation, null);
  assert.equal(requests[1].body.generation, 'first-generation');
  assert.deepEqual(Object.keys(requests[1].body.progress.classes['video-1'].blocks), ['question-1']);
});
test('pending initial generation is discarded after a confirmed reset and recreation', async () => {
  const x = setup(); seedPrivate(x.map, 'alice', progress('question-1', 20), null, progress('question-1', 20));
  const recreated = envelope(progress('question-2', 30), 4, 'recreated-after-reset');
  x.remote = recreated; x.put = () => ({ status: 410, result: recreated });
  await x.sync.resume();
  assert.equal(x.state.classes['video-1'].blocks['question-1'], undefined);
  assert.ok(x.state.classes['video-1'].blocks['question-2']);
  assert.deepEqual(JSON.parse(x.map.get(x.key)).pending, emptyProgress()); assert.equal(x.pending.size, 0);
  assert.equal(x.calls.filter(call => call.method === 'PUT').length, 1);
});
test('failed initial-generation comparison preserves pending cache and its original epoch', async () => {
  for (const status of [401, 403, 429, 503]) {
    const x = setup(); seedPrivate(x.map, 'alice', progress('question-1', 20), null, progress('question-1', 20));
    x.remote = envelope(progress('question-2', 30), 1, 'first-generation');
    x.put = () => ({ status, result: {} });
    const before = new Map(x.map);
    await assert.rejects(x.sync.resume());
    assert.deepEqual(x.map, before); assert.equal(x.sync.connected, false);
    assert.equal(x.pending.size, 0);
  }
});

const importFixture = () => ({ version: 1,
  selected: { value: 'retired-lesson', updatedAt: 10 }, lastActivity: { value: 10, updatedAt: 10 },
  classes: { 'retired-lesson': { blocks: { 'retired-question': { value: false, updatedAt: 10 } },
    complete: { value: false, updatedAt: 10 }, lastPoint: { value: 'retired-question', updatedAt: 10 },
    lastActivity: { value: 10, updatedAt: 10 } } } });

test('import keeps valid version-one exports, retired IDs, reading positions and unchecked records', () => {
  const state = importFixture(), text = JSON.stringify(state);
  assert.deepEqual(readImport(text), state); assert.deepEqual(state, importFixture());
  assert.equal(readImport(text).classes['retired-lesson'].complete.value, false);
  assert.deepEqual(readImport(JSON.stringify(emptyProgress())), emptyProgress());
});

test('import rejects future dates in every timestamp field without changing the source', () => {
  const paths = [ ['selected', 'updatedAt'], ['lastActivity', 'updatedAt'], ['lastActivity', 'value'],
    ['classes', 'retired-lesson', 'complete', 'updatedAt'], ['classes', 'retired-lesson', 'lastPoint', 'updatedAt'],
    ['classes', 'retired-lesson', 'lastActivity', 'updatedAt'], ['classes', 'retired-lesson', 'lastActivity', 'value'],
    ['classes', 'retired-lesson', 'blocks', 'retired-question', 'updatedAt'] ];
  for (const path of paths) {
    const state = importFixture(), owner = path.slice(0, -1).reduce((value, key) => value[key], state);
    owner[path.at(-1)] = Date.now() + 600000;
    const text = JSON.stringify(state);
    assert.throws(() => readImport(text), error => error.code === 'future-date', path.join('.'));
    assert.equal(JSON.stringify(state), text);
  }
  const nearFuture = importFixture(); nearFuture.lastActivity.value = Date.now() + 60000;
  assert.deepEqual(readImport(JSON.stringify(nearFuture)), nearFuture);
});

test('import rejects invalid clocks and date values instead of coercing or normalizing them', () => {
  for (const field of ['updatedAt', 'value']) for (const value of [-1, 1.5, '10', Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, -Infinity]) {
    const state = importFixture(); state.lastActivity[field] = value;
    assert.throws(() => readImport(JSON.stringify(state)), `${field}: ${String(value)}`);
  }
  // JSON numeric overflow parses as Infinity; it must not enter the study clock.
  assert.throws(() => readImport('{"version":1,"classes":{},"lastActivity":{"value":1e309,"updatedAt":10}}'));
});

test('import closes root, class and leaf schemas and rejects reserved map IDs', () => {
  for (const path of [[], ['classes', 'retired-lesson'], ['selected'], ['lastActivity'],
    ['classes', 'retired-lesson', 'complete'], ['classes', 'retired-lesson', 'lastPoint'],
    ['classes', 'retired-lesson', 'lastActivity'], ['classes', 'retired-lesson', 'blocks', 'retired-question']]) {
    const state = importFixture(); path.reduce((value, key) => value[key], state).extra = 'never-import';
    assert.throws(() => readImport(JSON.stringify(state)), path.join('.') || 'root');
  }
  for (const id of ['__proto__', 'constructor', 'prototype']) {
    const lesson = '{"blocks":{}}';
    assert.throws(() => readImport(`{"version":1,"classes":{"${id}":${lesson}}}`));
    assert.throws(() => readImport(`{"version":1,"classes":{"safe":{"blocks":{"${id}":{"value":false,"updatedAt":0}}}}}`));
  }
  assert.equal({}.extra, undefined);
});

test('import enforces its 64 KiB limit in UTF-8 bytes including the exact boundary', () => {
  const text = JSON.stringify(emptyProgress());
  assert.deepEqual(readImport(text.padEnd(65536, ' ')), emptyProgress());
  assert.throws(() => readImport(text.padEnd(65537, ' ')));
  const unicode = JSON.stringify({ version: 1, classes: { ['á'.repeat(32000)]: { blocks: {} } } });
  const bytes = new TextEncoder().encode(unicode).length;
  assert.ok(bytes < 65536); assert.ok(unicode.length < bytes);
  const exact = unicode + ' '.repeat(65536 - bytes);
  assert.doesNotThrow(() => readImport(exact));
  assert.throws(() => readImport(exact + ' '));
});

test('future-date import reports the clock problem and leaves active progress unchanged atomically', async () => {
  const listeners = new Map(), message = {}, original = progress(); let active = structuredClone(original), replacements = 0;
  const elements = new Map(['[data-progress-export]', '[data-progress-import]', '[data-progress-reset]'].map(selector =>
    [selector, { addEventListener(event, handler) { listeners.set(selector, handler); } }]));
  const card = { querySelector: selector => elements.get(selector) };
  const root = { dataset: { syncEnabled: 'false', syncProvider: 'firebase' }, querySelector: selector => selector === '[data-account-status]' ? message : card };
  await initializeSync(root, { snapshot: () => structuredClone(active), replace(next) { active = next; replacements++; } }, catalog);
  const incoming = importFixture(); incoming.lastActivity.updatedAt = Date.now() + 600000;
  const text = JSON.stringify(incoming), event = { target: { files: [{ size: text.length, text: async () => text }], value: 'chosen.json' } };
  await listeners.get('[data-progress-import]')(event);
  assert.equal(replacements, 0); assert.deepEqual(active, original); assert.equal(JSON.stringify(incoming), text);
  assert.match(message.textContent, /fechas futuras/); assert.match(message.textContent, /reloj/);
  assert.equal(event.target.value, '');
  await listeners.get('[data-progress-import]')({ target: { files: [{ size: 2, text: async () => '{}' }], value: 'bad.json' } });
  assert.equal(replacements, 0); assert.deepEqual(active, original); assert.match(message.textContent, /formato no es válido/);
});

async function deferredImportFixture() {
  const listeners = new Map(), message = {};
  let state = progress('question-1', 10), version = 0, replacements = 0, release;
  const elements = new Map(['[data-progress-export]', '[data-progress-import]', '[data-progress-reset]'].map(selector =>
    [selector, { addEventListener(event, handler) { listeners.set(selector, handler); } }]));
  const card = { querySelector: selector => elements.get(selector) };
  const root = { dataset: { syncEnabled: 'false', syncProvider: 'firebase' }, querySelector: selector => selector === '[data-account-status]' ? message : card };
  const controller = {
    get profileVersion() { return version; }, snapshot: () => structuredClone(state),
    replace(next) { state = next; replacements++; version++; }
  };
  await initializeSync(root, controller, catalog);
  const incoming = JSON.stringify(importFixture());
  const event = { target: { files: [{ size: incoming.length, text: () => new Promise(resolve => { release = () => resolve(incoming); }) }], value: 'chosen.json' } };
  return { message, event, start: () => listeners.get('[data-progress-import]')(event), release: () => release(),
    activate(value) { state = structuredClone(value); version++; }, edit(value) { state = structuredClone(value); },
    get state() { return state; }, get replacements() { return replacements; } };
}

test('a delayed import cannot carry account A progress into account B or overwrite account B', async () => {
  const x = await deferredImportFixture(), reading = x.start();
  const accountB = progress('question-2', 20); x.activate(accountB);
  x.release(); await reading;
  assert.equal(x.replacements, 0); assert.deepEqual(x.state, accountB);
  assert.equal(x.state.classes['video-1'].blocks['question-1'], undefined);
  assert.equal(x.state.classes['retired-lesson'], undefined);
  assert.match(x.message.textContent, /Cambió el perfil/); assert.equal(x.event.target.value, '');
});

test('a delayed import cannot undo an explicit reset of the same profile', async () => {
  const x = await deferredImportFixture(), reading = x.start();
  x.activate(emptyProgress()); x.release(); await reading;
  assert.equal(x.replacements, 0); assert.deepEqual(x.state, emptyProgress());
  assert.match(x.message.textContent, /se restableció el avance/);
});

test('a delayed import merges the latest edits made in the same profile while reading', async () => {
  const x = await deferredImportFixture(), reading = x.start();
  const latest = updateProgress(x.state, 'video-1', 'block', true, 20, 'question-2'); x.edit(latest);
  x.release(); await reading;
  assert.equal(x.replacements, 1);
  assert.ok(x.state.classes['video-1'].blocks['question-1']); assert.ok(x.state.classes['video-1'].blocks['question-2']);
  assert.equal(x.state.classes['retired-lesson'].blocks['retired-question'].value, false);
  assert.match(x.message.textContent, /Avance importado/);
});
