// ============================================================
//  VallorSoft — lib/r2.js
//  Cloudflare R2 (S3-kompatibilis) minimál kliens, függőség nélkül (AWS SigV4).
//  A saját Cloudflare-tárhelyünk: a fizetős dokumentum-archiválás (lib/docArchiveCloud)
//  titkosított ZIP-jei ide kerülnek.
//  Env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
//       (opc. R2_ENDPOINT, pl. EU-joghatósághoz: https://<account>.eu.r2.cloudflarestorage.com)
// ============================================================
'use strict';

const crypto = require('crypto');
const { Writable } = require('stream');

const PART = 16 * 1024 * 1024;   // R2: a részek (az utolsó kivételével) azonos méretűek

function config() {
  const account = process.env.R2_ACCOUNT_ID;
  const key = process.env.R2_ACCESS_KEY_ID;
  const secret = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!account || !key || !secret || !bucket) return null;
  const endpoint = (process.env.R2_ENDPOINT || ('https://' + account + '.r2.cloudflarestorage.com')).replace(/\/+$/, '');
  return { endpoint, key, secret, bucket };
}
function configured() { return !!config(); }

const sha256hex = (b) => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
function encKey(k) { return String(k).split('/').map((p) => encodeURIComponent(p)).join('/'); }

// Aláírt kérés (SigV4, régió 'auto', szolgáltatás 's3', path-style URL).
function signedRequest(cfg, method, objKey, query, body, extraHeaders) {
  const url = new URL(cfg.endpoint);
  const path = '/' + encodeURIComponent(cfg.bucket) + (objKey ? '/' + encKey(objKey) : '');
  const q = Object.keys(query || {}).sort().map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(query[k])).join('&');
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = body ? sha256hex(body) : sha256hex('');
  const headers = Object.assign({ host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate }, extraHeaders || {});
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const canonHeaders = names.map((h) => h + ':' + String(headers[Object.keys(headers).find((k) => k.toLowerCase() === h)]).trim() + '\n').join('');
  const signedHeaders = names.join(';');
  const canonReq = [method, path, q, canonHeaders, signedHeaders, payloadHash].join('\n');
  const scope = day + '/auto/s3/aws4_request';
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonReq)].join('\n');
  const kSign = hmac(hmac(hmac(hmac('AWS4' + cfg.secret, day), 'auto'), 's3'), 'aws4_request');
  const sig = crypto.createHmac('sha256', kSign).update(toSign).digest('hex');
  headers.authorization = 'AWS4-HMAC-SHA256 Credential=' + cfg.key + '/' + scope + ', SignedHeaders=' + signedHeaders + ', Signature=' + sig;
  delete headers.host;
  return { url: url.origin + path + (q ? '?' + q : ''), headers };
}

async function call(method, objKey, query, body, extra) {
  const cfg = config();
  if (!cfg) throw new Error('R2 nincs beállítva (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET)');
  const { url, headers } = signedRequest(cfg, method, objKey, query, body, extra);
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { method, headers, body: body || undefined });
      if (r.status >= 500) { lastErr = new Error('R2 ' + r.status); await new Promise((ok) => setTimeout(ok, 1000 * (i + 1))); continue; }
      return r;
    } catch (e) { lastErr = e; await new Promise((ok) => setTimeout(ok, 1000 * (i + 1))); }
  }
  throw lastErr;
}
async function ok(r, what) {
  if (r.ok) return r;
  const t = await r.text().catch(() => '');
  throw new Error('R2 ' + what + ' ' + r.status + ' ' + t.slice(0, 200));
}

async function createMultipart(objKey, contentType) {
  const r = await ok(await call('POST', objKey, { uploads: '' }, null, contentType ? { 'content-type': contentType } : null), 'create');
  const m = /<UploadId>([^<]+)<\/UploadId>/.exec(await r.text());
  if (!m) throw new Error('R2 UploadId hiányzik');
  return m[1];
}
async function uploadPart(objKey, uploadId, partNumber, buf) {
  const r = await ok(await call('PUT', objKey, { partNumber: String(partNumber), uploadId }, buf), 'part');
  return r.headers.get('etag');
}
async function completeMultipart(objKey, uploadId, parts) {
  const xml = '<CompleteMultipartUpload>' + parts.map((p) => '<Part><PartNumber>' + p.n + '</PartNumber><ETag>' + p.etag + '</ETag></Part>').join('') + '</CompleteMultipartUpload>';
  await ok(await call('POST', objKey, { uploadId }, Buffer.from(xml, 'utf8')), 'complete');
}
async function abortMultipart(objKey, uploadId) {
  try { await call('DELETE', objKey, { uploadId }); } catch (_) { /* best-effort */ }
}
async function getObject(objKey) { return ok(await call('GET', objKey), 'get'); }
async function deleteObject(objKey) {
  const r = await call('DELETE', objKey);
  if (!r.ok && r.status !== 404) await ok(r, 'delete');
}

// Írható stream → R2 darabolt feltöltés (16 MB-os részek; egyszerre egy rész a memóriában).
function createUploadStream(objKey, contentType) {
  let uploadId = null, partNo = 0, size = 0;
  const parts = [];
  let chunks = [], buffered = 0;
  const ensure = async () => { if (!uploadId) uploadId = await createMultipart(objKey, contentType); };
  const flush = async (all) => {
    while (buffered >= PART || (all && buffered > 0)) {
      const buf = Buffer.concat(chunks, buffered);
      const take = buffered >= PART ? PART : buffered;
      const part = buf.subarray(0, take);
      const rest = buf.subarray(take);
      chunks = rest.length ? [rest] : []; buffered = rest.length;
      await ensure();
      partNo++;
      parts.push({ n: partNo, etag: await uploadPart(objKey, uploadId, partNo, Buffer.from(part)) });
    }
  };
  const w = new Writable({
    highWaterMark: 4 * 1024 * 1024,
    write(chunk, _enc, cb) {
      chunks.push(chunk); buffered += chunk.length; size += chunk.length;
      if (buffered < PART) return cb();
      flush(false).then(() => cb(), cb);
    },
    final(cb) {
      flush(true).then(async () => {
        if (!parts.length) { await ensure(); partNo++; parts.push({ n: partNo, etag: await uploadPart(objKey, uploadId, partNo, Buffer.alloc(0)) }); }
        await completeMultipart(objKey, uploadId, parts);
        cb();
      }).catch(cb);
    },
    destroy(err, cb) { if (uploadId) abortMultipart(objKey, uploadId).finally(() => cb(err)); else cb(err); },
  });
  Object.defineProperty(w, 'bytes', { get: () => size });
  return w;
}

module.exports = { config, configured, signedRequest, createUploadStream, getObject, deleteObject, PART };
