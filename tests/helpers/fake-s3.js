// Minimál S3/R2-utánzat a tesztekhez: multipart feltöltés, GET, DELETE (memóriában).
const http = require('http');
function start() {
  const objects = new Map(), uploads = new Map();
  let nextId = 1;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const key = decodeURIComponent(u.pathname.split('/').slice(2).join('/'));
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (!/^AWS4-HMAC-SHA256 Credential=/.test(req.headers.authorization || '')) { res.statusCode = 403; return res.end('no auth'); }
      if (req.method === 'POST' && u.searchParams.has('uploads')) {
        const id = 'up' + (nextId++); uploads.set(id, { key, parts: {} });
        return res.end('<InitiateMultipartUploadResult><UploadId>' + id + '</UploadId></InitiateMultipartUploadResult>');
      }
      if (req.method === 'PUT' && u.searchParams.get('uploadId')) {
        const up = uploads.get(u.searchParams.get('uploadId'));
        up.parts[u.searchParams.get('partNumber')] = body;
        res.setHeader('etag', '"e' + u.searchParams.get('partNumber') + '"'); return res.end();
      }
      if (req.method === 'POST' && u.searchParams.get('uploadId')) {
        const up = uploads.get(u.searchParams.get('uploadId'));
        const nums = Object.keys(up.parts).map(Number).sort((a, b) => a - b);
        objects.set(up.key, Buffer.concat(nums.map((n) => up.parts[n]))); uploads.delete(u.searchParams.get('uploadId'));
        return res.end('<CompleteMultipartUploadResult/>');
      }
      if (req.method === 'DELETE' && u.searchParams.get('uploadId')) { uploads.delete(u.searchParams.get('uploadId')); res.statusCode = 204; return res.end(); }
      if (req.method === 'GET') { const o = objects.get(key); if (!o) { res.statusCode = 404; return res.end(); } return res.end(o); }
      if (req.method === 'DELETE') { objects.delete(key); res.statusCode = 204; return res.end(); }
      res.statusCode = 400; res.end();
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, objects, uploads, url: 'http://127.0.0.1:' + server.address().port })));
}
module.exports = { start };
