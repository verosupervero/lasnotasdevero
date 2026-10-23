import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createLucasHandler } from '../netlify/disabled-functions/lucas-progress.mjs';
import { createIdentityAdapter } from '../netlify/lib/lucas-identity.mjs';
import { ownerHash, MAX_BODY_BYTES, BACKUP_SLOTS, MAX_RECORD_BYTES } from '../netlify/lib/lucas-sync-config.mjs';
import { emptyProgress, updateProgress, mergeProgress } from '../static/js/study-progress.js';
import { verifyRequestOrigin } from '@netlify/identity';
import catalog from '../netlify/generated/lucas-catalog.mjs';

const origin = 'https://www.lasnotasdevero.com', now = 1792756800000;
const [lesson] = Object.keys(catalog), [question, otherQuestion] = catalog[lesson].questions;
const state = (q = question, value = true, date = now) => updateProgress(emptyProgress(), lesson, 'block', value, date, q);
class MemoryBlobs {
  data = new Map(); accesses = []; sequence = 0;
  async getWithMetadata(key, options) {
    assert.equal(options.consistency, 'strong'); this.accesses.push(['get', key]);
    return structuredClone(this.data.get(key) || null);
  }
  async setJSON(key, data, conditions) {
    this.accesses.push(['set', key]);
    const previous = this.data.get(key);
    if (conditions.onlyIfNew && previous || conditions.onlyIfMatch && conditions.onlyIfMatch !== previous?.etag) return { modified: false };
    const etag = String(++this.sequence);
    this.data.set(key, { data: structuredClone(data), etag, metadata: {} });
    return { modified: true, etag };
  }
}
function fixture({ enabled = true, limit = 1000, auth = {} } = {}) {
  const store = new MemoryBlobs(), calls = [];
  const identity = {
    async getUser(request) {
      calls.push('user'); const token = request.headers.get('cookie');
      if (token === 'session=A' || token === 'session=B') return { id: token.slice(-1), confirmedAt: '2026-01-01T00:00:00Z' };
      if (token === 'session=unconfirmed') return { id: 'A' };
      return null;
    },
    verifyRequestOrigin,
    ...Object.fromEntries(['login', 'signup', 'logout', 'recover', 'verify', 'password'].map(name => [name, async () => { calls.push(name); }])),
    ...auth
  };
  const handler = createLucasHandler({ env: { LUCAS_SYNC_ENABLED: String(enabled), URL: origin }, identity, store, catalog, now: () => now, rateLimit: limit });
  async function request(path = 'progress', { user = 'A', method = 'GET', body, headers = {}, raw } = {}) {
    const requestHeaders = { Cookie: `session=${user}`, 'X-Lucas-Account': user, ...(method !== 'GET' ? { Origin: origin, 'Content-Type': 'application/json' } : {}), ...headers };
    for (const [key, value] of Object.entries(requestHeaders)) if (value === null) delete requestHeaders[key];
    return handler(new Request(`${origin}/api/lucas/${path}`, { method, headers: requestHeaders, ...(method !== 'GET' ? { body: raw ?? JSON.stringify(body ?? {}) } : {}) }));
  }
  return { store, calls, request, handler };
}
const put = (revision, generation, progress) => ({ method: 'PUT', body: { revision, generation, progress } });

test('parked synchronization cannot be discovered as a production Netlify function', async () => {
  const active = await readdir(new URL('../netlify/functions/', import.meta.url));
  assert.deepEqual(active.filter(name => !name.startsWith('.')).sort(), []);
  const parked = await readFile(new URL('../netlify/disabled-functions/lucas-progress.mjs', import.meta.url), 'utf8');
  assert.match(parked, /export function createLucasHandler/);
  const deployment = await readFile(new URL('../netlify.toml', import.meta.url), 'utf8');
  assert.match(deployment, /\[functions\][\s\S]*?directory\s*=\s*"netlify\/functions"/);
  assert.match(deployment, /\[context\.production\.environment\][\s\S]*?LUCAS_SYNC_ENABLED\s*=\s*"false"/);
  assert.doesNotMatch(deployment, /^\s*(?:functions|directory|included_files)\s*=.*(?:disabled-functions|lucas)/mi);
  assert.doesNotMatch(deployment, /\[\[redirects\]\][\s\S]*?(?:api\/lucas|lucas-progress)/);
  assert.doesNotMatch(deployment, /(?:schedule|scheduled)\s*=/i);
  for (const filename of active) {
    const source = await readFile(new URL(`../netlify/functions/${filename}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /lucas|disabled-functions/i);
  }
  const hugo = await readFile(new URL('../config/_default/config.toml', import.meta.url), 'utf8');
  assert.match(hugo, /\[params\][\s\S]*?lucas_sync_enabled\s*=\s*false/);
  const scripts = await readdir(new URL('../scripts/', import.meta.url));
  for (const filename of scripts.filter(name => name.endsWith('.mjs'))) {
    const source = await readFile(new URL(`../scripts/${filename}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /disabled-functions/);
  }
});

test('OFF by default returns generic no-store 503 without auth/storage access', async () => {
  const f = fixture({ enabled: false });
  const response = await f.request('progress', put(0, null, state()));
  assert.equal(response.status, 503); assert.deepEqual(f.calls, []); assert.deepEqual(f.store.accesses, []);
  assert.match(response.headers.get('cache-control'), /no-store/); assert.equal(response.headers.get('vary'), 'Cookie');
  const defaultOff = createLucasHandler({ env: {} });
  assert.equal((await defaultOff(new Request(`${origin}/api/lucas/session`))).status, 503);
});

test('only verified confirmed Identity subject authorizes access; forged/missing sessions rejected', async () => {
  const f = fixture();
  for (const user of ['missing', 'unconfirmed', 'eyJhbGciOiJub25lIn0.fake.fake']) {
    assert.equal((await f.request('progress', { user })).status, 401);
    assert.deepEqual(await (await f.request('session', { user })).json(), { authenticated: false });
  }
  assert.deepEqual(await (await f.request('session')).json(), { authenticated: true, subject: 'A' });
  assert.deepEqual(f.store.accesses, []);
});

test('account/body/query/path/header cannot select another user; export only own data', async () => {
  const f = fixture();
  const saved = await (await f.request('progress', put(0, null, state()))).json();
  assert.equal(saved.revision, 1);
  assert.equal((await f.request('progress?subject=B')).status, 400);
  assert.equal((await f.request('progress/B')).status, 404);
  assert.equal((await f.request('progress', { headers: { 'X-Lucas-Account': 'B' } })).status, 401);
  assert.equal((await f.request('progress', { headers: { 'X-Lucas-Account': null } })).status, 401);
  assert.equal((await f.request('progress', { method: 'DELETE', body: { revision: 1, generation: saved.generation, userId: 'B' } })).status, 400);
  assert.equal((await f.request('progress', { ...put(1, saved.generation, state()), body: { revision: 1, generation: saved.generation, progress: state(), subject: 'B' } })).status, 400);
  const b = await (await f.request('progress', { user: 'B' })).json();
  assert.deepEqual(b, { revision: 0, generation: null, progress: null, deleted: false });
  const exported = await f.request('export');
  assert.match(exported.headers.get('content-disposition'), /attachment/);
  const exportedValue = await exported.json(); assert.deepEqual(exportedValue.progress, state());
  assert.ok(!JSON.stringify(exportedValue).includes('backups')); assert.ok(!JSON.stringify(exportedValue).includes('email'));
  assert.equal(f.store.data.has(ownerHash('B')), false);
});

test('CSRF origin is configured, not request Host; all mutations require JSON and bounded bodies', async () => {
  const f = fixture();
  for (const supplied of [null, 'null', 'https://attacker.invalid', 'http://www.lasnotasdevero.com']) {
    assert.equal((await f.request('auth/login', { method: 'POST', body: { email: 'a@example.com', password: 'strong-password' }, headers: { Origin: supplied } })).status, 403);
  }
  assert.equal((await f.handler(new Request('https://attacker.invalid/api/lucas/progress', { method: 'PUT', headers: { Origin: 'https://attacker.invalid' }, body: '{}' }))).status, 400);
  assert.equal((await f.request('progress', { ...put(0, null, state()), headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await f.request('progress', { method: 'PUT', raw: ' '.repeat(MAX_BODY_BYTES + 1) })).status, 413);
  assert.equal((await f.request('progress', { method: 'PUT', raw: '{bad' })).status, 400);
  assert.deepEqual(f.calls, []);
});

test('reject unknown fields, prototype keys, cross-class questions, arbitrary anchors, invalid/future timestamps', async () => {
  const f = fixture();
  const invalid = [];
  invalid.push({ ...state(), email: 'private@example.com' });
  invalid.push(JSON.parse('{"version":1,"classes":{},"__proto__":{"polluted":true}}'));
  invalid.push({ version: 1, classes: { constructor: { blocks: {} } } });
  invalid.push({ version: 1, classes: { [lesson]: { blocks: { unknown: { value: true, updatedAt: now } } } } });
  invalid.push({ version: 1, classes: { [lesson]: { blocks: {}, lastPoint: { value: 'https://example.com', updatedAt: now } } } });
  invalid.push(state(question, true, now + 86400000));
  invalid.push(state(question, true, -1));
  invalid.push({ version: 1, classes: [], selected: { value: lesson, updatedAt: now } });
  const foreign = Object.keys(catalog).find(id => id !== lesson);
  invalid.push({ version: 1, classes: { [lesson]: { blocks: { [catalog[foreign].questions[0]]: { value: true, updatedAt: now } } } } });
  for (const progress of invalid) assert.equal((await f.request('progress', put(0, null, progress))).status, 400);
  assert.equal(f.store.data.has(ownerHash('A')), false); assert.equal({}.polluted, undefined);
});

test('initial concurrent creation returns mergeable 409; retry retains different question blocks', async () => {
  const f = fixture(); assert.ok(otherQuestion);
  const [left, right] = await Promise.all([f.request('progress', put(0, null, state())), f.request('progress', put(0, null, state(otherQuestion, true, now - 10)))]);
  assert.deepEqual([left.status, right.status].sort(), [200, 409]);
  const conflictResponse = left.status === 409 ? left : right;
  const conflict = await conflictResponse.json(); assert.equal(conflict.error, 'conflict');
  const merged = mergeProgress(conflict.progress, left.status === 409 ? state() : state(otherQuestion, true, now - 10));
  const retried = await f.request('progress', put(conflict.revision, conflict.generation, merged));
  assert.equal(retried.status, 200);
  const saved = await retried.json();
  assert.equal(saved.progress.classes[lesson].blocks[question].value, true);
  assert.equal(saved.progress.classes[lesson].blocks[otherQuestion].value, true);
});

test('CAS detects concurrent updates and never overwrites a newer revision', async () => {
  const f = fixture();
  const base = await (await f.request('progress', put(0, null, state()))).json();
  const responses = await Promise.all([f.request('progress', put(base.revision, base.generation, state(question, false))), f.request('progress', put(base.revision, base.generation, state(otherQuestion)))]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal((await (await f.request()).json()).revision, 2);
});

test('delete atomically wipes progress/history, tombstone rejects stale generations, including old null after recreation', async () => {
  const f = fixture(); let value = await (await f.request('progress', put(0, null, state()))).json();
  const original = structuredClone(value);
  for (let i = 0; i < 10; i++) value = await (await f.request('progress', put(value.revision, value.generation, state(question, Boolean(i % 2), now - i)))).json();
  const record = f.store.data.get(ownerHash('A')).data;
  assert.equal(record.backups.length, BACKUP_SLOTS); assert.ok(Buffer.byteLength(JSON.stringify(record)) <= MAX_RECORD_BYTES);
  const deletion = await f.request('progress', { method: 'DELETE', body: { revision: value.revision, generation: value.generation } });
  assert.equal(deletion.status, 200); const tombstone = await deletion.json();
  assert.equal(tombstone.progress, null); assert.equal(tombstone.deleted, true); assert.notEqual(tombstone.generation, original.generation);
  assert.deepEqual(f.store.data.get(ownerHash('A')).data.backups, []);
  assert.equal(f.store.data.get(ownerHash('A')).data.resetCount, 1);
  assert.equal((await f.request('progress', put(original.revision, original.generation, state()))).status, 410);
  assert.equal((await f.request('progress', put(0, null, state()))).status, 410);
  assert.equal((await f.request('progress', put(tombstone.revision, tombstone.generation, state(otherQuestion)))).status, 200);
  assert.equal((await f.request('progress', put(0, null, state()))).status, 410);
});

test('DELETE/write race leaves either tombstone or conflict; no post-delete historical progress', async () => {
  const f = fixture(); const base = await (await f.request('progress', put(0, null, state()))).json();
  const results = await Promise.all([f.request('progress', { method: 'DELETE', body: { revision: base.revision, generation: base.generation } }), f.request('progress', put(base.revision, base.generation, state(otherQuestion)))]);
  assert.ok(results.some(result => result.status === 200));
  const latest = f.store.data.get(ownerHash('A')).data;
  if (latest.deleted) { assert.equal(latest.progress, null); assert.deepEqual(latest.backups, []); }
  else assert.equal(results[0].status, 409);
});

test('persistent subject rate limit spans handler instances and gives 429 without extra progress writes', async () => {
  const f = fixture({ limit: 2 });
  assert.equal((await f.request()).status, 200); assert.equal((await f.request()).status, 200);
  assert.equal((await f.request()).status, 429);
  assert.equal(f.store.data.get(`rate/${ownerHash('A')}`).data.count, 2);
});

test('auth response never reveals password/token/email or upstream error; signup and recover hide enumeration', async () => {
  const secret = 'email=secret@example.com token=secret-password';
  const reject = async () => { throw Error(secret); };
  const f = fixture({ auth: { login: reject, signup: reject, recover: reject } });
  const login = await f.request('auth/login', { method: 'POST', body: { email: 'secret@example.com', password: 'secret-password' } });
  assert.equal(login.status, 401); assert.ok(!(await login.text()).includes('secret'));
  const signup = await f.request('auth/signup', { method: 'POST', body: { email: 'secret@example.com', password: 'secret-password' } });
  assert.equal(signup.status, 202); assert.deepEqual(await signup.json(), { ok: true, confirmationRequired: true });
  assert.equal((await f.request('auth/recover', { method: 'POST', body: { email: 'secret@example.com' } })).status, 202);
});

test('recovery verification binds original subject so a cross-tab session switch cannot reset another account password', async () => {
  let changed = false;
  const f = fixture({ auth: {
    async verify() { return { id: 'A', confirmedAt: '2026-01-01T00:00:00Z' }; },
    async password() { changed = true; }
  } });
  const verified = await f.request('auth/verify', { method: 'POST', body: { token: 'one-time-confirmation-token', type: 'recovery' } });
  assert.deepEqual(await verified.json(), { ok: true, subject: 'A' });
  const switched = await f.request('auth/password', { user: 'B', method: 'POST', body: { password: 'new-strong-password' }, headers: { 'X-Lucas-Account': 'A' } });
  assert.equal(switched.status, 401); assert.equal(changed, false);
});

test('official HTTP auth adapter sets only HttpOnly Secure cookies, trusted callback referrer, confirmation enabled', async () => {
  const writes = [], requests = [], store = { get: () => 'access', set: options => writes.push(options) };
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/settings')) return Response.json({ autoconfirm: false });
    if (url.endsWith('/token') || url.endsWith('/verify')) return Response.json({ access_token: 'server-only-token', refresh_token: 'server-only-refresh', expires_in: 3600 });
    return Response.json({ id: 'A', confirmed_at: '2026-01-01' });
  };
  const identity = createIdentityAdapter(origin, { cookies: store }, fetcher);
  await identity.login('a@example.com', 'long-password');
  assert.deepEqual(await identity.verify('one-time-confirmation-token', 'signup'), { id: 'A', confirmedAt: '2026-01-01' });
  await identity.signup('a@example.com', 'long-password');
  assert.equal(writes.length, 4); assert.ok(writes.every(cookie => cookie.httpOnly && cookie.secure && cookie.sameSite === 'Lax' && cookie.path === '/'));
  assert.ok(requests.every(({ url, options }) => url.startsWith(`${origin}/.netlify/identity/`) && options.headers.Referer === `${origin}/cuenta/`));
  let signupCalled = false;
  const badSettings = createIdentityAdapter(origin, { cookies: store }, async url => { if (url.endsWith('/settings')) return Response.json({ autoconfirm: true }); signupCalled = true; return Response.json({}); });
  await assert.rejects(badSettings.signup('a@example.com', 'long-password')); assert.equal(signupCalled, false);
});

test('generated allowlist represents source classes/questions, with no student data', async () => {
  assert.equal(Object.keys(catalog).length, 9);
  assert.equal(Object.values(catalog).reduce((n, entry) => n + entry.questions.length, 0), 63);
  assert.ok(Object.values(catalog).every(entry => entry.points.length && entry.questions.length));
  const source = await readFile(new URL('../netlify/generated/lucas-catalog.mjs', import.meta.url), 'utf8');
  assert.ok(!/email|password|token/.test(source));
});
