import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateKeys, encryptArchive, decryptArchive, collectArchive, privatePath, runCLI } from '../scripts/lucas-backup.mjs';

const passphrase = 'synthetic recovery passphrase only';
const keys = generateKeys(passphrase);
const sample = { schema: 1, createdAt: '2026-10-23T00:00:00Z', stores: [{ name: 'lucas-progress-v1', entries: [{ key: 'a'.repeat(64), value: { revision: 1, deleted: false, progress: { lessons: {} } } }] }] };

test('encrypted backup round-trips without exposing progress or owner keys', () => {
  const envelope = encryptArchive(sample, keys.publicKey);
  assert.deepEqual(decryptArchive(envelope, keys.privateKey, passphrase), sample);
  assert.ok(!JSON.stringify(envelope).includes('a'.repeat(64)));
  assert.ok(!JSON.stringify(envelope).includes('lessons'));
  assert.match(keys.privateKey, /ENCRYPTED PRIVATE KEY/);
  assert.throws(() => decryptArchive(envelope, keys.privateKey, 'wrong private passphrase'));
  assert.throws(() => generateKeys('short'));
});

test('authenticated envelope rejects tampering, wrong version and corrupted parameters', () => {
  const envelope = encryptArchive(sample, keys.publicKey);
  for (const field of ['ciphertext', 'wrappedKey', 'tag', 'iv']) {
    const altered = { ...envelope, [field]: `${envelope[field][0] === 'A' ? 'B' : 'A'}${envelope[field].slice(1)}` };
    assert.throws(() => decryptArchive(altered, keys.privateKey, passphrase));
  }
  assert.throws(() => decryptArchive({ ...envelope, version: 2 }, keys.privateKey, passphrase));
});

test('private paths reject traversal, publish paths and symlinks', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lucas-backup-test-'));
  try {
    for (const name of ['../public/private.json', 'static/private.json', 'C:\\secret.json', '.hidden', '/tmp/private']) await assert.rejects(privatePath(root, name));
    const target = await privatePath(root, 'archive.json');
    assert.equal(path.dirname(target), path.join(root, '.lucas-private'));
    await writeFile(target, 'existing');
    await assert.rejects(writeFile(target, 'new', { flag: 'wx' }));
    await rm(path.join(root, '.lucas-private'), { recursive: true });
    await symlink(os.tmpdir(), path.join(root, '.lucas-private'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(privatePath(root, 'archive.json'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

const fakeStore = (values) => ({
  async *list() { yield { blobs: values.map((_, index) => ({ key: index.toString(16).padStart(64, '0') })) }; },
  async get(key) { return values[parseInt(key, 16)]; }
});

test('collection is bounded, preserves deletion records, excludes provider metadata and never writes remotely', async () => {
  const record = { revision: 1, generation: 'synthetic-generation', progress: { version: 1, classes: {} }, deleted: false, updatedAt: 1, backups: [], resetCount: 0 };
  const values = [JSON.stringify(record), JSON.stringify({ ...record, deleted: true, progress: null, resetCount: 2 })];
  const archive = await collectArchive(['primary'], () => fakeStore(values));
  assert.equal(archive.stores[0].entries[1].value.deleted, true);
  assert.equal(archive.stores[0].entries[1].value.resetCount, 2);
  const restored = decryptArchive(encryptArchive(archive, keys.publicKey), keys.privateKey, passphrase);
  assert.equal(restored.stores[0].entries[1].value.resetCount, 2);
  assert.deepEqual(Object.keys(archive.stores[0].entries[0]), ['key', 'value']);
  await assert.rejects(collectArchive(['primary'], () => fakeStore(values), { objects: 1, objectBytes: 1000, totalBytes: 10000 }));
  await assert.rejects(collectArchive(['primary'], () => fakeStore(values), { objects: 10, objectBytes: 2, totalBytes: 10000 }));
  await assert.rejects(collectArchive(['primary'], () => fakeStore(values), { objects: 10, objectBytes: 1000, totalBytes: 1000 }));
  await assert.rejects(collectArchive(['primary'], () => fakeStore(['not JSON'])));
  await assert.rejects(collectArchive(['primary'], () => fakeStore([JSON.stringify({ ...record, email: 'private@example.invalid' })])));
  for (const resetCount of [-1, 1.5, '2', null, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(collectArchive(['primary'], () => fakeStore([JSON.stringify({ ...record, resetCount })])));
  await assert.rejects(collectArchive(['primary'], () => fakeStore([JSON.stringify({ ...record, progress: { version: 1, classes: {}, password: 'never-archive' } })])));
  await assert.rejects(collectArchive(['primary'], () => fakeStore([JSON.stringify({ ...record, progress: { version: 1, classes: {}, selected: { value: 'private@example.invalid', updatedAt: 1 } } })])));
});

test('rate-limit records are omitted without fetching their values', async () => {
  const store = { async *list() { yield { blobs: [{ key: `rate/${'a'.repeat(64)}` }] }; }, async get() { assert.fail('Rate records must not be fetched.'); } };
  const archive = await collectArchive(['primary'], () => store);
  assert.deepEqual(archive.stores[0].entries, []);
});

test('actual server rate keys can coexist with profile records in an encrypted backup', async () => {
  const owner = 'b'.repeat(64);
  const record = { revision: 4, generation: 'synthetic-generation', progress: null, deleted: true, updatedAt: 1, backups: [], resetCount: 2 };
  let reads = 0;
  const store = {
    async *list() { yield { blobs: [{ key: `rate/${'a'.repeat(64)}` }, { key: owner }] }; },
    async get(key) { assert.equal(key, owner); reads++; return JSON.stringify(record); }
  };
  const archive = await collectArchive(['primary'], () => store);
  assert.equal(reads, 1);
  assert.deepEqual(archive.stores[0].entries, [{ key: owner, value: record }]);
  assert.deepEqual(decryptArchive(encryptArchive(archive, keys.publicKey), keys.privateKey, passphrase), archive);
  const unexpected = { async *list() { yield { blobs: [{ key: 'rate/not-a-hash' }] }; } };
  await assert.rejects(collectArchive(['primary'], () => unexpected));
});

test('valid accented and leading-hyphen lesson anchors survive private backup recovery', async () => {
  for (const anchor of ['2-adoración-y-misión', '-video-1--por-qué']) {
    const record = { revision: 1, generation: 'synthetic-generation', progress: { version: 1, classes: { 'video-1': { blocks: {}, lastPoint: { value: anchor, updatedAt: 1 } } } }, deleted: false, updatedAt: 1, backups: [], resetCount: 0 };
    const archive = await collectArchive(['primary'], () => fakeStore([JSON.stringify(record)]));
    assert.equal(decryptArchive(encryptArchive(archive, keys.publicKey), keys.privateKey, passphrase).stores[0].entries[0].value.progress.classes['video-1'].lastPoint.value, anchor);
  }
});

test('CLI uses private exclusive files and decrypt never prints plaintext', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lucas-backup-cli-'));
  const environment = { LUCAS_BACKUP_PASSPHRASE: passphrase };
  try {
    const message = await runCLI('generate-key', undefined, environment, root);
    assert.ok(!message.includes(passphrase));
    await assert.rejects(runCLI('generate-key', undefined, environment, root));
    const publicKey = await readFile(await privatePath(root, 'backup-public.pem'), 'utf8');
    await writeFile(await privatePath(root, 'synthetic.json'), JSON.stringify(encryptArchive(sample, publicKey)));
    const result = await runCLI('decrypt', 'synthetic.json', environment, root);
    assert.ok(!result.includes('a'.repeat(64)));
    assert.ok(!result.includes('lessons'));
    await assert.rejects(runCLI('backup', undefined, {}, root));
    await assert.rejects(runCLI('decrypt', '../public/private.json', environment, root));
  } finally { await rm(root, { recursive: true, force: true }); }
});
