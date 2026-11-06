// ============================================================
//  VallorSoft — lib/googleDrive.js
//  Minimális Google OAuth2 + Drive v3 kliens (függőség nélkül).
//  Jogosultság: drive.file — az alkalmazás CSAK a saját maga által
//  létrehozott fájlokat/mappákat látja a felhasználó Drive-ján.
//
//  Env:
//    GOOGLE_OAUTH_CLIENT_ID      — a VallorSoft Google Cloud OAuth kliense
//    GOOGLE_OAUTH_CLIENT_SECRET
//  Visszahívási cím: <APP_URL>/api/backup/google/callback
//  (ezt kell a Google Cloud konzolban „Authorized redirect URI"-ként megadni).
// ============================================================
const fs = require('fs');
const https = require('https');
const { appBaseUrl } = require('./appUrl');

const SCOPES = 'https://www.googleapis.com/auth/drive.file openid email';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

function isConfigured() {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}
function redirectUri() {
  return appBaseUrl('http://localhost:3000') + '/api/backup/google/callback';
}

function authUrl(state) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',          // mindig adjon refresh tokent
    include_granted_scopes: 'true',
    state,
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + p.toString();
}

async function fetchJson(url, opts) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch(url, Object.assign({ signal: ctrl.signal }, opts || {}));
    const text = await r.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) { /* nem JSON */ }
    if (!r.ok) {
      const msg = (data && (data.error_description || (data.error && (data.error.message || data.error)))) || ('HTTP ' + r.status);
      const err = new Error('Google: ' + String(msg).slice(0, 200));
      err.status = r.status;
      err.code = data && typeof data.error === 'string' ? data.error : undefined;
      throw err;
    }
    return data;
  } finally { clearTimeout(timer); }
}

function emailFromIdToken(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8'));
    return payload.email || null;
  } catch (_) { return null; }
}

async function exchangeCode(code) {
  const data = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: process.env.GOOGLE_OAUTH_CLIENT_ID, client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: redirectUri(), grant_type: 'authorization_code',
    }).toString(),
  });
  if (!data || !data.refresh_token) throw new Error('Google nu a returnat un refresh token — reîncercați conectarea.');
  return { refreshToken: data.refresh_token, email: emailFromIdToken(data.id_token) };
}

async function accessToken(refreshToken) {
  const data = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken, client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET, grant_type: 'refresh_token',
    }).toString(),
  });
  return data.access_token;
}

async function revoke(refreshToken) {
  try {
    await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(refreshToken), { method: 'POST' });
  } catch (_) { /* best-effort */ }
}

function auth(token) { return { Authorization: 'Bearer ' + token }; }

// Mappa: ha a megadott id él (nem kukában) azt adja, különben név szerint keres
// / létrehoz (drive.file → csak a saját mappáinkat látjuk).
async function ensureFolder(token, name, parentId, knownId) {
  if (knownId) {
    try {
      const f = await fetchJson('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(knownId) + '?fields=id,trashed', { headers: auth(token) });
      if (f && f.id && !f.trashed) return f.id;
    } catch (e) { if (e.status !== 404) throw e; }
  }
  const esc = String(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  let q = `name='${esc}' and mimeType='${FOLDER_MIME}' and trashed=false`;
  if (parentId) q += ` and '${parentId}' in parents`;
  const list = await fetchJson('https://www.googleapis.com/drive/v3/files?fields=files(id)&spaces=drive&q=' + encodeURIComponent(q), { headers: auth(token) });
  if (list && list.files && list.files[0]) return list.files[0].id;
  const meta = { name, mimeType: FOLDER_MIME };
  if (parentId) meta.parents = [parentId];
  const created = await fetchJson('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, auth(token)), body: JSON.stringify(meta),
  });
  return created.id;
}

// Fájl feltöltése (resumable): a fájlt folyamként küldjük, nem töltjük memóriába.
async function uploadFile(token, folderId, name, filePath) {
  const size = fs.statSync(filePath).size;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let location;
  try {
    const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
      method: 'POST', signal: ctrl.signal,
      headers: Object.assign({
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'application/octet-stream',
        'X-Upload-Content-Length': String(size),
      }, auth(token)),
      body: JSON.stringify({ name, parents: [folderId], mimeType: 'application/octet-stream' }),
    });
    if (!r.ok) throw new Error('Google Drive: inițiere upload eșuată (HTTP ' + r.status + ')');
    location = r.headers.get('location');
  } finally { clearTimeout(timer); }
  if (!location) throw new Error('Google Drive: lipsește adresa de upload');

  return new Promise((resolve, reject) => {
    const u = new URL(location);
    const req = https.request({
      method: 'PUT', hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'Content-Length': size, 'Content-Type': 'application/octet-stream' },
      timeout: 30 * 60 * 1000,
    }, (resp) => {
      let body = '';
      resp.on('data', (c) => { body += c; });
      resp.on('end', () => {
        if (resp.statusCode >= 200 && resp.statusCode < 300) {
          try { return resolve(JSON.parse(body).id); } catch (_) { return reject(new Error('Google Drive: răspuns invalid')); }
        }
        reject(new Error('Google Drive: upload eșuat (HTTP ' + resp.statusCode + ')'));
      });
    });
    req.on('timeout', () => req.destroy(new Error('Google Drive: upload timeout')));
    req.on('error', reject);
    fs.createReadStream(filePath).on('error', reject).pipe(req);
  });
}

async function deleteFile(token, fileId) {
  const r = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId), { method: 'DELETE', headers: auth(token) });
  if (!r.ok && r.status !== 404) throw new Error('Google Drive: ștergere eșuată (HTTP ' + r.status + ')');
}

module.exports = {
  SCOPES, isConfigured, redirectUri, authUrl, exchangeCode, accessToken, revoke,
  ensureFolder, uploadFile, deleteFile, emailFromIdToken,
};
