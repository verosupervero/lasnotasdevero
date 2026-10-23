import { constants, generateKeyPairSync, randomBytes, publicEncrypt, privateDecrypt, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdir, lstat, readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIMITS = Object.freeze({ objects: 10000, objectBytes: 256 * 1024, totalBytes: 16 * 1024 * 1024 });
const AAD = Buffer.from('lasnotasdevero:lucas-backup:v1');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OPTIONS = { flag: 'wx', mode: 0o600 };

export async function privatePath(root, filename) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/.test(filename)) throw new Error('Invalid private filename.');
  const directory = path.join(root, '.lucas-private');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('Private directory cannot be a symbolic link.');
  const actual = await realpath(directory);
  if (path.dirname(actual).toLowerCase() !== (await realpath(root)).toLowerCase()) throw new Error('Private directory must remain inside the project.');
  const target = path.join(actual, filename);
  try { if ((await lstat(target)).isSymbolicLink()) throw new Error('Private files cannot be symbolic links.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return target;
}

function requirePassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 16) throw new Error('Set a private LUCAS_BACKUP_PASSPHRASE of at least 16 characters.');
}

export function generateKeys(passphrase) {
  requirePassphrase(passphrase);
  return generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase }
  });
}

export function encryptArchive(archive, publicKey) {
  const plaintext = Buffer.from(JSON.stringify(archive));
  if (plaintext.length > LIMITS.totalBytes) throw new Error('Archive exceeds private backup byte limit.');
  const key = randomBytes(32);
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(AAD);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const wrappedKey = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key);
    return { version: 1, algorithm: 'RSA-OAEP-SHA256+A256GCM', wrappedKey: wrappedKey.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
  } finally { key.fill(0); plaintext.fill(0); }
}

export function decryptArchive(envelope, privateKey, passphrase) {
  requirePassphrase(passphrase);
  if (envelope?.version !== 1 || envelope.algorithm !== 'RSA-OAEP-SHA256+A256GCM') throw new Error('Unsupported backup format.');
  for (const field of ['wrappedKey', 'iv', 'tag', 'ciphertext']) {
    if (typeof envelope[field] !== 'string' || envelope[field].length > LIMITS.totalBytes * 1.4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(envelope[field])) throw new Error('Invalid encrypted backup.');
  }
  const key = privateDecrypt({ key: privateKey, passphrase, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(envelope.wrappedKey, 'base64'));
  try {
    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    if (iv.length !== 12 || tag.length !== 16 || key.length !== 32) throw new Error('Invalid backup encryption parameters.');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
    try { return JSON.parse(plaintext.toString('utf8')); }
    finally { plaintext.fill(0); }
  } finally { key.fill(0); }
}

function validateProgress(progress) {
  const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const fields = (value, allowed) => object(value) && Object.keys(value).every((key) => allowed.includes(key));
  const id = (value) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(value);
  const clock = (value) => Number.isSafeInteger(value) && value >= 0;
  const anchor = (value) => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value);
  const entry = (value, type) => fields(value, ['value', 'updatedAt']) && clock(value.updatedAt) && (type === 'id' ? id(value.value) : type === 'anchor' ? anchor(value.value) : type === 'number' ? clock(value.value) : typeof value.value === type);
  if (!fields(progress, ['version', 'classes', 'selected', 'lastActivity']) || progress.version !== 1 || !object(progress.classes)) throw new Error('Unexpected progress schema.');
  if (progress.selected !== undefined && !entry(progress.selected, 'id') || progress.lastActivity !== undefined && !entry(progress.lastActivity, 'number')) throw new Error('Unexpected progress metadata.');
  for (const [lessonId, lesson] of Object.entries(progress.classes)) {
    if (!id(lessonId) || !fields(lesson, ['blocks', 'complete', 'lastPoint', 'lastActivity']) || !object(lesson.blocks)) throw new Error('Unexpected lesson schema.');
    for (const [key, type] of [['complete', 'boolean'], ['lastPoint', 'anchor'], ['lastActivity', 'number']]) if (lesson[key] !== undefined && !entry(lesson[key], type)) throw new Error('Unexpected lesson metadata.');
    for (const [questionId, block] of Object.entries(lesson.blocks)) if (!id(questionId) || !entry(block, 'boolean')) throw new Error('Unexpected question schema.');
  }
}

export function validateStoredRecord(record) {
  const allowed = ['revision', 'generation', 'progress', 'deleted', 'updatedAt', 'backups', 'resetCount'];
  if (!record || Array.isArray(record) || typeof record !== 'object' || Object.keys(record).some((field) => !allowed.includes(field))) throw new Error('Unexpected private progress record.');
  if (!Number.isSafeInteger(record.revision) || record.revision < 0 || !Number.isSafeInteger(record.resetCount) || record.resetCount < 0 || typeof record.generation !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(record.generation) || typeof record.deleted !== 'boolean' || !Number.isSafeInteger(record.updatedAt) || record.updatedAt < 0) throw new Error('Unexpected record metadata.');
  if (!Array.isArray(record.backups) || record.backups.length > 7) throw new Error('Unexpected private progress revisions.');
  if (record.deleted) {
    if (record.progress !== null || record.backups.length) throw new Error('Deleted profile still contains progress.');
  } else validateProgress(record.progress);
  for (const item of record.backups) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some((field) => !['revision', 'generation', 'progress', 'updatedAt'].includes(field)) || !Number.isSafeInteger(item.revision) || item.revision < 0 || typeof item.generation !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(item.generation) || !Number.isSafeInteger(item.updatedAt) || item.updatedAt < 0) throw new Error('Unexpected private progress revision.');
    validateProgress(item.progress);
  }
}

export async function collectArchive(storeNames, getStore, options = LIMITS) {
  const archive = { schema: 1, createdAt: new Date().toISOString(), stores: [] };
  let count = 0;
  let bytes = Buffer.byteLength(JSON.stringify(archive));
  for (const name of storeNames) {
    const store = getStore(name);
    const entries = [];
    for await (const page of store.list({ paginate: true })) {
      for (const blob of page.blobs) {
        if (++count > options.objects) throw new Error('Private backup object limit exceeded.');
        if (typeof blob.key !== 'string' || blob.key.length > 256) throw new Error('Invalid backup object key.');
        if (/^rate\/[a-f0-9]{64}$/.test(blob.key)) continue;
        if (!/^[a-f0-9]{64}$/.test(blob.key)) throw new Error('Unexpected private progress key.');
        const value = await store.get(blob.key, { type: 'text', consistency: 'strong' });
        if (value === null) continue;
        if (Buffer.byteLength(value) > options.objectBytes) throw new Error('Private backup object byte limit exceeded.');
        // Parse only application JSON. Provider credentials and object metadata are never archived.
        const record = JSON.parse(value);
        validateStoredRecord(record);
        const entry = { key: blob.key, value: record };
        bytes += Buffer.byteLength(JSON.stringify(entry)) + 1;
        if (bytes > options.totalBytes - 1024) throw new Error('Private backup total byte limit exceeded.');
        entries.push(entry);
      }
    }
    archive.stores.push({ name, entries });
  }
  return archive;
}

export async function runCLI(command, inputName, environment = process.env, root = ROOT) {
  const passphrase = environment.LUCAS_BACKUP_PASSPHRASE;
  const filename = (name) => privatePath(root, name);
  if (command === 'generate-key') {
    const keys = generateKeys(passphrase);
    // Exclusive writes refuse overwriting existing recovery keys.
    await writeFile(await filename('backup-private.pem'), keys.privateKey, OPTIONS);
    await writeFile(await filename('backup-public.pem'), keys.publicKey, OPTIONS);
    return 'Encrypted recovery key and public key created in the private directory.';
  }
  if (command === 'backup') {
    if (!environment.NETLIFY_SITE_ID || !environment.NETLIFY_AUTH_TOKEN) throw new Error('Netlify operator credentials must be provided through the environment.');
    const publicKey = await readFile(await filename('backup-public.pem'), 'utf8');
    const { getStore } = await import('@netlify/blobs');
    const { STORE_NAME, BACKUP_STORE_NAME } = await import('../netlify/lib/lucas-sync-config.mjs');
    const archive = await collectArchive([STORE_NAME, BACKUP_STORE_NAME], (name) => getStore({ name, siteID: environment.NETLIFY_SITE_ID, token: environment.NETLIFY_AUTH_TOKEN, consistency: 'strong' }));
    const envelope = encryptArchive(archive, publicKey);
    const output = `backup-${Date.now()}-${randomBytes(4).toString('hex')}.json`;
    await writeFile(await filename(output), JSON.stringify(envelope), OPTIONS);
    return 'Encrypted backup created in the private directory. No student data printed.';
  }
  if (command === 'decrypt') {
    requirePassphrase(passphrase);
    if (!inputName) throw new Error('Supply only the encrypted backup filename inside the private directory.');
    const encrypted = await readFile(await filename(inputName));
    if (encrypted.length > LIMITS.totalBytes * 1.5) throw new Error('Encrypted backup exceeds the byte limit.');
    const key = await readFile(await filename('backup-private.pem'), 'utf8');
    const archive = decryptArchive(JSON.parse(encrypted.toString('utf8')), key, passphrase);
    await writeFile(await filename(`recovery-${Date.now()}-${randomBytes(4).toString('hex')}.json`), JSON.stringify(archive), OPTIONS);
    return 'Private plaintext recovery file created. Validate deletion tombstones before any manual restore; delete this recovery file after use.';
  }
  throw new Error('Usage: node scripts/lucas-backup.mjs generate-key | backup | decrypt <private-backup-filename>');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > (process.argv[2] === 'decrypt' ? 4 : 3)) {
    console.error('Unexpected arguments. Credentials must never be supplied as command-line arguments.');
    process.exitCode = 1;
  } else {
    runCLI(process.argv[2], process.argv[3]).then((message) => console.log(message)).catch(() => {
      // Provider error bodies can contain credentials or object keys. Never print them.
      console.error('Private backup failed. Check the command, private files, environment credentials and configured limits. No remote data was modified.');
      process.exitCode = 1;
    });
  }
}
