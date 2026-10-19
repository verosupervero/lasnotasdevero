import { createMessage, encrypt, readKeys } from 'openpgp';

export const RECIPIENT_EMAIL = 'lasnotasdevero@protonmail.com';
export const LIMITS = Object.freeze({ name: 120, email: 254, subject: 200, message: 10000 });
const validatedKeys = new WeakMap();

export function validateValues(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new Error('Completá los cuatro campos del formulario.');
  }
  const result = {};
  for (const [field, limit] of Object.entries(LIMITS)) {
    const value = values[field];
    if (typeof value !== 'string' || !value.trim() || value.length > limit) {
      throw new Error('Revisá los campos obligatorios y sus límites de extensión.');
    }
    result[field] = value;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email) || /[\r\n]/.test(result.name + result.subject)) {
    throw new Error('Revisá el correo electrónico, el nombre y el asunto.');
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 48000) {
    throw new Error('El mensaje supera el tamaño permitido.');
  }
  return result;
}

async function verifyUsableKey(key, recipientEmail) {
  if (key.isPrivate()) throw new Error('Se requiere una clave pública.');
  const date = new Date();
  // OpenPGP.js verifies self-certifications, revocation and expiration.
  await key.getPrimaryUser(date, { email: recipientEmail });
  await key.verifyPrimaryKey(date, { email: recipientEmail });
  await key.getEncryptionKey(undefined, date, { email: recipientEmail });
}

export async function validateRecipientKey({ armoredKey, expectedFingerprint, recipientEmail = RECIPIENT_EMAIL }) {
  if (typeof armoredKey !== 'string' || armoredKey.length > 100000 ||
      !/^-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]*-----END PGP PUBLIC KEY BLOCK-----\s*$/.test(armoredKey.trim()) ||
      (armoredKey.match(/-----BEGIN PGP /g) || []).length !== 1) {
    throw new Error('La clave pública falta o no es válida.');
  }
  const fingerprint = typeof expectedFingerprint === 'string'
    ? expectedFingerprint.replace(/\s/g, '').toLowerCase() : '';
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(fingerprint)) {
    throw new Error('Falta la huella digital completa y verificada de la clave pública.');
  }
  if (typeof recipientEmail !== 'string' || !recipientEmail) throw new Error('Falta el destinatario.');
  const keys = await readKeys({ armoredKeys: armoredKey });
  if (keys.length !== 1 || keys[0].getFingerprint().toLowerCase() !== fingerprint) {
    throw new Error('La clave pública no coincide con la huella digital verificada.');
  }
  const key = keys[0];
  await verifyUsableKey(key, recipientEmail);
  validatedKeys.set(key, { fingerprint, recipientEmail });
  return key;
}

export async function encryptContact({ values, key, recipientEmail = RECIPIENT_EMAIL }) {
  const verified = validatedKeys.get(key);
  if (!verified || verified.recipientEmail !== recipientEmail || key.getFingerprint().toLowerCase() !== verified.fingerprint) {
    throw new Error('La clave pública debe verificarse antes de cifrar.');
  }
  const payload = validateValues(values);
  // Recheck validity at submission time, including after a long-open browser tab.
  await verifyUsableKey(key, recipientEmail);
  return encrypt({
    message: await createMessage({ text: JSON.stringify(payload) }),
    encryptionKeys: key,
    encryptionUserIDs: { email: recipientEmail },
    format: 'armored',
  });
}
