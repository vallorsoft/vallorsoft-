// ============================================================
//  VallorSoft — lib/backupFile.js
//  A cégenkénti biztonsági mentés fájlformátuma (.vsbk):
//
//    [ "VSBK" (4 bájt) ][ verzió (1 bájt = 1) ][ IV (12 bájt) ]
//    [ AES-256-GCM titkosított gzip(NDJSON) ... ][ GCM tag (16 bájt) ]
//
//  Az NDJSON sorai:
//    {"type":"meta", ...}                   — első sor (cég, időpont, verzió)
//    {"t":"<tábla>","r":{...sor...}}         — adatsorok
//    {"type":"end","counts":{...}}          — zárósor (táblánkénti darabszám)
//  Bináris (bytea) érték: {"$b64":"..."}.
//
//  A kulcs cégenként a mester-kulcsból származik (lib/crypto.deriveKey),
//  így a fájl a Drive-on olvashatatlan, és a cégek mentései egymás
//  kulcsával sem fejthetők vissza.
// ============================================================
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const { once } = require('events');
const { deriveKey } = require('./crypto');

const MAGIC = Buffer.from('VSBK');
const VERSION = 1;
const HEADER_LEN = MAGIC.length + 1 + 12;
const TAG_LEN = 16;

function companyKey(companyId) { return deriveKey('backup:company:' + companyId); }

// JSON-ba írás: a Buffer (bytea) ne {type:'Buffer',data:[...]} legyen.
function replacer(key, value) {
  if (value && value.type === 'Buffer' && Array.isArray(value.data)) {
    return { $b64: Buffer.from(value.data).toString('base64') };
  }
  return value;
}

// Író: createWriter(path, key) → { writeLine(obj), close() → {size} }
// A gzip → cipher → fájl lánc backpressure-t tart (await writeLine).
function createWriter(filePath, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const gzip = zlib.createGzip({ level: 6 });
  const out = fs.createWriteStream(filePath);
  out.write(Buffer.concat([MAGIC, Buffer.from([VERSION]), iv]));
  gzip.pipe(cipher).pipe(out, { end: false });
  const cipherEnded = once(cipher, 'end');
  let failed = null;
  [gzip, cipher, out].forEach((s) => s.on('error', (e) => { failed = failed || e; }));

  return {
    async writeLine(obj) {
      if (failed) throw failed;
      const line = JSON.stringify(obj, replacer) + '\n';
      if (!gzip.write(line)) await once(gzip, 'drain');
    },
    async close() {
      gzip.end();
      await cipherEnded;
      if (failed) throw failed;
      out.end(cipher.getAuthTag());
      await once(out, 'finish');
      return { size: fs.statSync(filePath).size };
    },
  };
}

// Olvasó (visszaállításhoz / ellenőrzéshez): az egész fájlt visszafejti és
// soronként hívja az onLine-t. A GCM-tag a fájl végén van, ezért a hitelesség
// csak a végén derül ki — a hívó addig NE írjon adatbázisba (gyűjtsön / ellenőrizzen).
async function readFile(filePath, key, onLine) {
  const stat = fs.statSync(filePath);
  if (stat.size < HEADER_LEN + TAG_LEN) throw new Error('Fișier de backup invalid');
  const fd = fs.openSync(filePath, 'r');
  let header, tag;
  try {
    header = Buffer.alloc(HEADER_LEN); fs.readSync(fd, header, 0, HEADER_LEN, 0);
    tag = Buffer.alloc(TAG_LEN); fs.readSync(fd, tag, 0, TAG_LEN, stat.size - TAG_LEN);
  } finally { fs.closeSync(fd); }
  if (!header.subarray(0, 4).equals(MAGIC)) throw new Error('Fișier de backup invalid');
  if (header[4] !== VERSION) throw new Error('Versiune de backup necunoscută');
  const iv = header.subarray(5, HEADER_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const src = fs.createReadStream(filePath, { start: HEADER_LEN, end: stat.size - TAG_LEN - 1 });
  const gunzip = zlib.createGunzip();
  let buf = '';
  const done = new Promise((resolve, reject) => {
    src.on('error', reject); decipher.on('error', reject); gunzip.on('error', reject);
    gunzip.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (line) onLine(JSON.parse(line));
      }
    });
    gunzip.on('end', () => { if (buf.trim()) onLine(JSON.parse(buf)); resolve(); });
  });
  src.pipe(decipher).pipe(gunzip);
  await done;
}

module.exports = { createWriter, readFile, companyKey, MAGIC, VERSION };
