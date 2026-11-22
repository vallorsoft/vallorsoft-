// ============================================================
//  VallorSoft — lib/zipStream.js
//  Folyamatos (streamelt) ZIP-író, STORE módban: a fájlokat egyenként írja a
//  kimenetre (pl. HTTP-válasz), így a teljes archívum soha nincs egyben a
//  memóriában (Fly 512 MB). A visszanyomást (drain) megvárja.
//  65 535-nél több bejegyzéshez ZIP64 záró rekordot ír.
// ============================================================
'use strict';
const { crc32, dosDateTime, uniqueName } = require('./zip');

const MAX_OFFSET = 0xFFFFFFFF;

function createZipStream(out) {
  const central = [];
  const used = new Set();
  let offset = 0, count = 0, closed = false;

  function write(buf) {
    offset += buf.length;
    if (out.write(buf)) return Promise.resolve();
    return new Promise((ok) => out.once('drain', ok));
  }

  async function add(name, data, when) {
    if (closed) throw new Error('zip closed');
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data == null ? '' : data), 'utf8');
    if (offset + buf.length + 400 > MAX_OFFSET) throw new Error('Arhiva depășește 4 GB.');
    const fname = uniqueName(name, used);
    const nameBuf = Buffer.from(fname, 'utf8');
    const crc = crc32(buf);
    const { time, date } = dosDateTime(when instanceof Date && !isNaN(when) ? when : new Date());
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(buf.length, 18);
    local.writeUInt32LE(buf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const at = offset;
    await write(local); await write(nameBuf); if (buf.length) await write(buf);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(45, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(buf.length, 20);
    cen.writeUInt32LE(buf.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(at, 42);
    central.push(cen, nameBuf);
    count++;
    return fname;
  }

  async function finish() {
    if (closed) return;
    closed = true;
    const cdStart = offset;
    for (const b of central) await write(b);
    const cdSize = offset - cdStart;
    if (count > 0xFFFF) {
      // ZIP64 end of central directory record + locator
      const z = Buffer.alloc(56);
      z.writeUInt32LE(0x06064b50, 0);
      z.writeBigUInt64LE(44n, 4);
      z.writeUInt16LE(45, 12); z.writeUInt16LE(45, 14);
      z.writeUInt32LE(0, 16); z.writeUInt32LE(0, 20);
      z.writeBigUInt64LE(BigInt(count), 24); z.writeBigUInt64LE(BigInt(count), 32);
      z.writeBigUInt64LE(BigInt(cdSize), 40); z.writeBigUInt64LE(BigInt(cdStart), 48);
      const zStart = offset;
      await write(z);
      const loc = Buffer.alloc(20);
      loc.writeUInt32LE(0x07064b50, 0); loc.writeUInt32LE(0, 4);
      loc.writeBigUInt64LE(BigInt(zStart), 8); loc.writeUInt32LE(1, 16);
      await write(loc);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Math.min(count, 0xFFFF), 8);
    end.writeUInt16LE(Math.min(count, 0xFFFF), 10);
    end.writeUInt32LE(cdSize, 12);
    end.writeUInt32LE(cdStart, 16);
    await write(end);
  }

  return { add, finish, get count() { return count; }, get bytes() { return offset; } };
}

module.exports = { createZipStream };
