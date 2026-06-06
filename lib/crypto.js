// crypto-util.js
// Integrációs kulcsok titkosított tárolásához (AES-256-GCM).
// A mester-kulcs env változóból jön: INTEGRATION_ENC_KEY (32 byte, hex vagy base64).
//
// Kulcsgenerálás egyszer (és tedd .env-be):
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

const crypto = require('crypto');

function getMasterKey() {
  const raw = process.env.INTEGRATION_ENC_KEY;
  if (!raw) throw new Error('INTEGRATION_ENC_KEY hiányzik a környezeti változókból');
  // hex (64 char) vagy base64 elfogadott
  const buf = raw.length === 64 ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error('INTEGRATION_ENC_KEY-nek 32 byte-osnak kell lennie');
  return buf;
}

// Titkosítás -> "iv.tag.ciphertext" (mind base64)
function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getMasterKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
}

function decrypt(blob) {
  const [ivB64, tagB64, ctB64] = String(blob).split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getMasterKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

// Maszkolás a felületre: csak az utolsó 4 karakter látszik
function mask(secret) {
  const s = String(secret || '');
  if (s.length <= 4) return '••••';
  return '••••••••' + s.slice(-4);
}

module.exports = { encrypt, decrypt, mask };
