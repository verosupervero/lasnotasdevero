import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createSync, cloudProgress, readImport } from '../legacy/netlify-sync/study-sync.js';
import { STORAGE_KEY, emptyProgress, updateProgress } from '../static/js/study-progress.js';

const catalog = [{ id: 'video-1', questions: ['question-1', 'question-2'], points: ['video-1', 'question-1', 'question-2'] }];
const progress = (question = 'question-1', time = 10) => updateProgress(emptyProgress(), 'video-1', 'block', true, time, question);
const envelope = (state = emptyProgress(), revision = 0, generation = 'epoch-1') => ({ progress: state, revision, generation, deleted: false });
function setup() {
  const map = new Map([[STORAGE_KEY, JSON.stringify(progress())]]), pending = new Map(), calls = [], statuses = [];
  let state = progress(), key = STORAGE_KEY, index = 0, subject = 'alice', remote = envelope(), put;
  const storage = { getItem: (name) => map.get(name) ?? null, setItem: (name, value) => map.set(name, value), removeItem: (name) => map.delete(name) };
  const controller = { snapshot: () => structuredClone(state), activate(name, next) { key = name; state = next; storage.setItem(name, JSON.stringify(next)); } };
  const fetcher = async (url, options) => {
    const body = options.body && JSON.parse(options.body); calls.push({ url, ...options, body });
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
  const sync = createSync({ controller, catalog, storage, fetcher, status: (text) => statuses.push(text), schedule: (callback, delay) => { const id = ++index; pending.set(id, { callback, delay }); return id; }, cancel: (id) => pending.delete(id) });
  return { sync, controller, map, pending, calls, statuses, get state() { return state; }, get key() { return key; }, set state(value) { state = value; }, set subject(value) { subject = value; }, set remote(value) { remote = value; }, set put(value) { put = value; }, async tick() { const entry = [...pending].find(([, timer]) => timer.delay !== 12000); if (entry) { pending.delete(entry[0]); await entry[1].callback(); await new Promise((resolve) => setImmediate(resolve)); } } };
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
test('429 has bounded exponential backoff', async () => {
  const x = setup(); x.put = () => ({ status: 429, result: {} }); await x.sync.connect(true); await x.tick();
  assert.equal([...x.pending.values()][0].delay, 15000); await x.tick();
  assert.equal([...x.pending.values()][0].delay, 30000);
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
test('isolated email callback strips token before same-origin verification, never accepts bearer tokens', async () => {
  const script = await readFile(new URL('../legacy/netlify-sync/study-auth-callback.js', import.meta.url), 'utf8');
  for (const hash of ['#confirmation_token=secret-confirmation', '#recovery_token=secret-recovery', '#access_token=untrusted-browser-token']) {
    const actions = [], result = { textContent: '' }, button = { disabled: false };
    let submit;
    const form = { hidden: true, elements: { password: { value: 'a-new-secure-password' } }, querySelector: () => button, addEventListener(_name, callback) { submit = callback; } };
    vm.runInNewContext(script, {
      URLSearchParams, AbortController, setTimeout, clearTimeout,
      location: { hash, search: '', pathname: '/cuenta/' },
      history: { replaceState(_a, _b, path) { actions.push({ strip: path }); } },
      document: { querySelector: (selector) => selector === '#account-result' ? result : form },
      fetch: async (url, options) => {
        actions.push({ url, options });
        if (url.endsWith('/auth/password')) assert.equal(options.headers['X-Lucas-Account'], 'officially-verified-subject');
        return { ok: true, json: async () => ({ authenticated: true, subject: 'officially-verified-subject' }) };
      }
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(actions[0], { strip: '/cuenta/' });
    if (hash.startsWith('#access_token')) { assert.equal(actions.length, 1); assert.match(result.textContent, /no es válido/); }
    else {
      assert.equal(actions[1].url, '/api/lucas/auth/verify');
      assert.equal(actions[1].options.credentials, 'same-origin');
      const payload = JSON.parse(actions[1].options.body);
      assert.equal(payload.type, hash.startsWith('#recovery') ? 'recovery' : 'signup');
      assert.equal(form.hidden, payload.type !== 'recovery');
      if (payload.type === 'recovery') {
        assert.equal(actions[2].url, '/api/lucas/session');
        await submit({ preventDefault() {} });
        assert.equal(actions[3].url, '/api/lucas/auth/password');
        assert.equal(actions[3].options.headers['X-Lucas-Account'], 'officially-verified-subject');
        assert.equal(form.elements.password.value, '');
        assert.equal(form.hidden, true);
      }
    }
  }
});
test('recovery refuses a different cookie principal after verifying the email token', async () => {
  const script = await readFile(new URL('../legacy/netlify-sync/study-auth-callback.js', import.meta.url), 'utf8');
  const calls = [], result = { textContent: '' }, form = { hidden: true, addEventListener() {} };
  vm.runInNewContext(script, {
    URLSearchParams, AbortController, setTimeout, clearTimeout,
    location: { hash: '#recovery_token=alice-recovery-token', search: '', pathname: '/cuenta/' },
    history: { replaceState() {} },
    document: { querySelector: (selector) => selector === '#account-result' ? result : form },
    fetch: async (url) => { calls.push(url); return { ok: true, json: async () => url.endsWith('/verify') ? { ok: true, subject: 'alice' } : { authenticated: true, subject: 'bob' } }; }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['/api/lucas/auth/verify', '/api/lucas/session']);
  assert.equal(form.hidden, true); assert.match(result.textContent, /No pudimos verificar/);
});
