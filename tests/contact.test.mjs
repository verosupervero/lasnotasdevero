import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKey, decrypt, readMessage, revokeKey } from 'openpgp';
import { validateRecipientKey, encryptContact, validateValues, LIMITS } from '../assets/js/contact-crypto.js';
import retiredContactEndpoint from '../netlify/functions/contact.mjs';

// Synthetic test keys exist only in memory, for a reserved non-deliverable address.
// They are never installed as the site's recipient key or written to disk.
const recipientEmail = 'contact-test@example.invalid';
const fixture = await generateKey({ type: 'ecc', curve: 'curve25519Legacy', userIDs: [{ name: 'TEST ONLY', email: recipientEmail }], format: 'object' });
const armoredKey = fixture.publicKey.armor();
const expectedFingerprint = fixture.publicKey.getFingerprint();
const options = { armoredKey, expectedFingerprint, recipientEmail };
const values = { name: 'Visitante de prueba ñ', email: 'sender@example.invalid', subject: 'Consulta sintética 🔒', message: 'Primera línea.\nSegunda línea con tildes: áéíóú.' };

test('the retired plaintext endpoint rejects without consuming a body', async () => {
  const request = new Request('https://example.invalid/api/contacto', { method: 'POST', body: 'TEST ONLY' });
  const response = retiredContactEndpoint(request);
  assert.equal(response.status, 410);
  assert.equal(request.bodyUsed, false);
  assert.equal((await response.json()).ok, false);
});

test('encrypts all four exact values and round-trips Unicode using only an in-memory test private key', async () => {
  const key = await validateRecipientKey(options);
  const ciphertext = await encryptContact({ values, key, recipientEmail });
  assert.match(ciphertext, /^-----BEGIN PGP MESSAGE-----/);
  for (const value of Object.values(values)) assert.equal(ciphertext.includes(value), false);
  const result = await decrypt({ message: await readMessage({ armoredMessage: ciphertext }), decryptionKeys: fixture.privateKey });
  assert.deepEqual(JSON.parse(result.data), values);
  assert.deepEqual(Object.keys(JSON.parse(result.data)), ['name', 'email', 'subject', 'message']);
});

test('requires a full pinned fingerprint and a certified exact recipient email', async () => {
  for (const expectedFingerprint of ['', undefined, '12345678', '0'.repeat(40)]) {
    await assert.rejects(validateRecipientKey({ ...options, expectedFingerprint }));
  }
  await assert.rejects(validateRecipientKey({ ...options, recipientEmail: 'other@example.invalid' }));
  await assert.rejects(validateRecipientKey({ ...options, recipientEmail: 'test@example.invalid' }));
  const spaced = expectedFingerprint.toUpperCase().match(/.{1,4}/g).join(' ');
  assert.ok(await validateRecipientKey({ ...options, expectedFingerprint: spaced }));
});

test('rejects absent, malformed, private and multiple armored keys', async () => {
  for (const armoredKey of ['', undefined, 'not a key', fixture.privateKey.armor(), `${options.armoredKey}\n${options.armoredKey}`]) {
    await assert.rejects(validateRecipientKey({ ...options, armoredKey }));
  }
});

test('rejects revoked and expired recipient keys', async () => {
  const revoked = await revokeKey({ key: fixture.privateKey, format: 'object' });
  await assert.rejects(validateRecipientKey({ ...options, armoredKey: revoked.publicKey.armor() }));
  const expired = await generateKey({ type: 'ecc', curve: 'curve25519Legacy', userIDs: [{ email: recipientEmail }], date: new Date('2020-01-01T00:00:00Z'), keyExpirationTime: 60, format: 'object' });
  await assert.rejects(validateRecipientKey({ ...options, armoredKey: expired.publicKey.armor(), expectedFingerprint: expired.publicKey.getFingerprint() }));
});

test('rejects a signing-only key with no usable encryption subkey', async () => {
  const signingOnly = await generateKey({ type: 'ecc', curve: 'curve25519Legacy', userIDs: [{ email: recipientEmail }], subkeys: [], format: 'object' });
  await assert.rejects(validateRecipientKey({ ...options, armoredKey: signingOnly.publicKey.armor(), expectedFingerprint: signingOnly.publicKey.getFingerprint() }));
});

test('encryption cannot bypass recipient-key validation or change recipient after validation', async () => {
  await assert.rejects(encryptContact({ values, key: fixture.publicKey, recipientEmail }));
  const key = await validateRecipientKey(options);
  await assert.rejects(encryptContact({ values, key, recipientEmail: 'other@example.invalid' }));
});

test('validates required field types, lengths and email without modifying approved values', () => {
  for (const field of Object.keys(LIMITS)) {
    for (const value of [undefined, null, 123, [], {}, '', '  ', 'a'.repeat(LIMITS[field] + 1)]) {
      assert.throws(() => validateValues({ ...values, [field]: value }));
    }
  }
  for (const email of ['not-an-email', 'a@b', 'a@b.com\r\nInjected']) assert.throws(() => validateValues({ ...values, email }));
  assert.throws(() => validateValues({ ...values, subject: 'Subject\nInjected' }));
  for (const invalid of [null, [], 'message']) assert.throws(() => validateValues(invalid));
  assert.deepEqual(validateValues({ ...values, unexpected: 'discarded' }), values);
});
