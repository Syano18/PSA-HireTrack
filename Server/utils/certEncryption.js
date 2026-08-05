/**
 * certEncryption.js
 * ─────────────────
 * Handles AES-256-GCM encryption / decryption of certificate verification tokens
 * embedded in QR codes.
 *
 * Environment variables required (add to Server/.env):
 *   QR_ENCRYPT_KEY  – 64-char hex string (32 bytes)  → openssl rand -hex 32
 *   QR_HMAC_KEY     – any strong secret string         → openssl rand -hex 32
 *   VERCEL_VERIFY_URL – base URL of the certificate verifier app
 *                        e.g. https://cert-verify.is-a.dev
 */

const crypto = require('crypto');
require('dotenv').config();

const ALGORITHM  = 'aes-256-gcm';
const IV_LENGTH  = 12; // bytes – recommended for GCM

// ─── Key helpers ────────────────────────────────────────────────────────────

function getEncryptKey() {
  const hex = process.env.QR_ENCRYPT_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'QR_ENCRYPT_KEY must be a 64-character hex string (32 bytes). ' +
      'Generate one with: openssl rand -hex 32'
    );
  }
  return Buffer.from(hex, 'hex');
}

function getHmacKey() {
  const key = process.env.QR_HMAC_KEY;
  if (!key) throw new Error('QR_HMAC_KEY is not set in environment variables.');
  return key;
}

// ─── HMAC signature ─────────────────────────────────────────────────────────

/**
 * Creates an HMAC-SHA256 signature over `ref|type|issued`.
 * Used to detect tampering even after decryption succeeds.
 */
function sign(ref, type, issued) {
  return crypto
    .createHmac('sha256', getHmacKey())
    .update(`${ref}|${type}|${issued}`)
    .digest('hex');
}

// ─── Encrypt ────────────────────────────────────────────────────────────────

/**
 * Encrypts a certificate payload into a URL-safe token.
 *
 * @param {string} refNumber    – UUID reference number of the certificate
 * @param {string} certType     – 'training' | 'employment'
 * @param {string} recipientName – Full name of the certificate holder
 * @returns {string} token in the format  <iv>.<authTag>.<ciphertext>  (base64url parts)
 */
function encryptQRToken(refNumber, certType, recipientName) {
  const key     = getEncryptKey();
  const iv      = crypto.randomBytes(IV_LENGTH);
  const issued  = new Date().toISOString();
  const sig     = sign(refNumber, certType, issued);

  const plaintext = JSON.stringify({
    ref    : refNumber,
    type   : certType,
    name   : recipientName,
    issued : issued,
    sig    : sig,
  });

  const cipher    = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Dot-separated base64url: iv.authTag.ciphertext
  return [
    iv       .toString('base64url'),
    authTag  .toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

// ─── Decrypt ────────────────────────────────────────────────────────────────

/**
 * Decrypts a token produced by encryptQRToken().
 * Throws an error if the token is invalid, tampered, or the HMAC fails.
 *
 * @param {string} token
 * @returns {{ ref: string, type: string, name: string, issued: string }}
 */
function decryptQRToken(token) {
  const parts = (token || '').split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format.');
  }

  const iv        = Buffer.from(parts[0], 'base64url');
  const authTag   = Buffer.from(parts[1], 'base64url');
  const encrypted = Buffer.from(parts[2], 'base64url');

  const key = getEncryptKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted;
  try {
    decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch {
    throw new Error('Token decryption failed – data may be corrupted or tampered with.');
  }

  let payload;
  try {
    payload = JSON.parse(decrypted.toString('utf8'));
  } catch {
    throw new Error('Token payload is not valid JSON.');
  }

  // Verify HMAC signature
  const expected = sign(payload.ref, payload.type, payload.issued);
  const sigBuf   = Buffer.from(payload.sig  || '', 'hex');
  const expBuf   = Buffer.from(expected, 'hex');

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('Token HMAC signature mismatch – certificate may be forged.');
  }

  return {
    ref    : payload.ref,
    type   : payload.type,
    name   : payload.name,
    issued : payload.issued,
  };
}

// ─── URL builder ────────────────────────────────────────────────────────────

/**
 * Builds the full Vercel verification URL to embed in the QR code.
 *
 * @param {string} refNumber
 * @param {string} certType        'training' | 'employment'
 * @param {string} recipientName
 * @returns {string}  e.g. https://cert-verify.is-a.dev/verify?t=abc.def.ghi
 */
function buildVerifyURL(refNumber, certType, recipientName) {
  const base  = (process.env.VERCEL_VERIFY_URL || 'https://cert-verify.is-a.dev').replace(/\/$/, '');
  const token = encryptQRToken(refNumber, certType, recipientName);
  return `${base}/verify?t=${token}`;
}

// ─── Turso certificate registry helper ──────────────────────────────────────

/**
 * Inserts a certificate record into the Turso `certificate_registry` table
 * so the Vercel validator can look it up.
 *
 * Create the table once with:
 *   CREATE TABLE IF NOT EXISTS certificate_registry (
 *     id               INTEGER PRIMARY KEY AUTOINCREMENT,
 *     reference_number TEXT    NOT NULL UNIQUE,
 *     certificate_type TEXT    NOT NULL,
 *     recipient_name   TEXT    NOT NULL,
 *     details          TEXT    NOT NULL,   -- JSON
 *     issued_at        TEXT    NOT NULL,
 *     created_at       TEXT    DEFAULT (datetime('now'))
 *   );
 */
// Note: executeTursoFn uses TURSO_AUTH_TOKEN (not TURSO_DB_TOKEN)
async function registerCertificateInTurso(executeTursoFn, {
  refNumber,
  certType,
  recipientName,
  details,       // plain JS object – will be JSON-stringified
}) {
  try {
    await executeTursoFn(
      `INSERT OR IGNORE INTO certificate_registry
         (reference_number, certificate_type, recipient_name, details, issued_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [refNumber, certType, recipientName, JSON.stringify(details)]
    );
  } catch (err) {
    // Non-fatal: log but don't block PDF generation
    console.error('[certEncryption] Failed to register certificate in Turso:', err.message);
  }
}

/**
 * Updates an existing certificate record in the Turso `certificate_registry` table.
 * Used when regenerating a certificate after correcting misspelled entries.
 *
 * @param {function} executeTursoFn
 * @param {{ refNumber: string, recipientName: string, details: object }} opts
 */
async function updateCertificateInTurso(executeTursoFn, {
  refNumber,
  recipientName,
  details,
}) {
  try {
    await executeTursoFn(
      `UPDATE certificate_registry SET recipient_name = ?, details = ? WHERE reference_number = ?`,
      [recipientName, JSON.stringify(details), refNumber]
    );
  } catch (err) {
    console.error('[certEncryption] Failed to update certificate in Turso:', err.message);
  }
}

/**
 * Updates the TRANSMITTER and REMARKS columns in the Turso Digital_Logbook row
 * that corresponds to a given reference number.
 * Called after a certificate is edited/regenerated to record who made the change
 * and what fields were modified.
 *
 * @param {function} executeTursoFn
 * @param {{ refNumber: string, editorName: string, remarks: string }} opts
 */
async function updateTursoLogbookEntry(executeTursoFn, { refNumber, editorName, remarks, recipientName }) {
  try {
    await executeTursoFn(
      `INSERT INTO Digital_Logbook (
         REFERENCE_NUMBER, DOCUMENT, NAME, PURPOSE, 
         OR_NO, AMOUNT, TRANSMITTER, SECTION, MODE_OF_TRANSMITTAL, REMARKS
       )
       SELECT 
         REFERENCE_NUMBER, DOCUMENT, COALESCE(?, NAME), 'REGENERATED',
         OR_NO, AMOUNT, ?, SECTION, MODE_OF_TRANSMITTAL, ?
       FROM Digital_Logbook 
       WHERE REFERENCE_NUMBER = ? 
       ORDER BY id ASC LIMIT 1`,
      [recipientName || null, editorName, remarks, refNumber]
    );
  } catch (err) {
    console.error('[certEncryption] Failed to update Digital_Logbook in Turso:', err.message);
  }
}

module.exports = {
  encryptQRToken,
  decryptQRToken,
  buildVerifyURL,
  registerCertificateInTurso,
  updateCertificateInTurso,
  updateTursoLogbookEntry,
};
