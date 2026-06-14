// ============================================================
//  VallorSoft — lib/zip.js
//  Minimális, FÜGGŐSÉG NÉLKÜLI ZIP-író (STORE / tömörítés nélkül).
//  A könyvelői felület tömeges (havi) dokumentum-letöltéséhez: több
//  fájlt egyetlen .zip Bufferré fűz. A PDF-ek/képek már eleve tömörek,
//  ezért a tárolós (store) mód bőven elég és gyors.
// ============================================================

// CRC32 tábla
const CRC_TABLE = (function () {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(d) {
  const dt = d || new Date();
  const time = ((dt.getHours() & 0x1F) << 11) | ((dt.getMinutes() & 0x3F) << 5) | ((dt.getSeconds() / 2) & 0x1F);
  const date = (((dt.getFullYear() - 1980) & 0x7F) << 9) | (((dt.getMonth() + 1) & 0x0F) << 5) | (dt.getDate() & 0x1F);
  return { time: time & 0xFFFF, date: date & 0xFFFF };
}

// Egyedi, ütközésmentes fájlnevek (azonos nevűekhez sorszám).
// A `/` MEGMARAD mappa-elválasztóként (ZIP-szabvány) — minden útvonal-szegmenst
// külön sanitizálunk (a Windows-tiltott karaktereket cseréljük, a `..`-t kivédjük).
function uniqueName(name, used) {
  const segs = String(name || 'fajl').split('/')
    .map((s) => s.replace(/[\\:*?"<>|]/g, '_').replace(/^\.+$/, '_').trim())
    .filter((s) => s.length > 0);
  let n = (segs.length ? segs.join('/') : 'fajl').slice(0, 250);
  if (!used.has(n)) { used.add(n); return n; }
  const slash = n.lastIndexOf('/');
  const dir = slash >= 0 ? n.slice(0, slash + 1) : '';
  const file = slash >= 0 ? n.slice(slash + 1) : n;
  const dot = file.lastIndexOf('.');
  const base = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot) : '';
  let i = 2;
  while (used.has(dir + base + '-' + i + ext)) i++;
  const out = dir + base + '-' + i + ext;
  used.add(out);
  return out;
}

// files: [{ name, buffer(Buffer), date? }] → Buffer (.zip)
function buildZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const used = new Set();

  for (const f of files) {
    const name = uniqueName(f.name, used);
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(f.buffer) ? f.buffer : Buffer.from(f.buffer || '');
    const crc = crc32(data);
    const { time, date } = dosDateTime(f.date);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0x0800, 6);        // flag: UTF-8 név
    local.writeUInt16LE(0, 8);             // compression: store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);  // comp size
    local.writeUInt32LE(data.length, 22);  // uncomp size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);            // extra len
    chunks.push(local, nameBuf, data);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);              // version made by
    cen.writeUInt16LE(20, 6);             // version needed
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);             // comment len
    cen.writeUInt16LE(0, 34);             // disk #
    cen.writeUInt16LE(0, 36);             // internal attr
    cen.writeUInt32LE(0, 38);             // external attr
    cen.writeUInt32LE(offset, 42);        // local header offset
    central.push(Buffer.concat([cen, nameBuf]));

    offset += local.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, end]);
}

module.exports = { buildZip };
