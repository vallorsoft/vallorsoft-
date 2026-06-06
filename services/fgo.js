// services/fgo.js
// FGO adapter (v7.1). Hash SHA-1 uppercase:
//   emitere   = SHA1(CodUnic + PrivateKey + Client.Denumire)
//   numar-ops = SHA1(CodUnic + PrivateKey + Numar)         (getstatus, anulare, stornare, print)
//   articole  = SHA1(CodUnic + PrivateKey)                  (articol/list, gestiune)
//   nomenclatoare = publikus GET, hash nélkül
// Teszt: api-testuat.fgo.ro/v1 · Prod: api.fgo.ro/v1

const crypto = require('crypto');
const HOSTS = { production: 'https://api.fgo.ro/v1', test: 'https://api-testuat.fgo.ro/v1' };
const TIMEOUT_MS = 20000;

const sha1U = (s) => crypto.createHash('sha1').update(s, 'utf8').digest('hex').toUpperCase();
const base = (creds) => HOSTS[creds.environment === 'production' ? 'production' : 'test'];

async function call(url, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (_) { data = { Success: false, Message: text }; }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') { const x = new Error('FGO időtúllépés (15 mp).'); x.status = 504; throw x; }
    throw e;
  } finally { clearTimeout(t); }
}
const post = (creds, path, body) => call(base(creds) + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

// Számla kiállítás. invoice = a normalizált modell (lásd invoice-adapter.js) + extra mezők.
async function emit(creds, invoice) {
  const c = invoice.client || {};
  const body = {
    CodUnic: creds.CodUnic,
    Hash: sha1U(creds.CodUnic + creds.PrivateKey + (c.name || '')),
    PlatformaUrl: creds.PlatformaUrl,
    Serie: invoice.serie,
    Valuta: invoice.currency || 'RON',
    TipFactura: invoice.type || 'Factura',
    DataEmitere: invoice.issueDate || undefined,     // yyyy-mm-dd; ha üres, FGO a mait veszi
    DataScadenta: invoice.dueDate || undefined,
    Text: invoice.text || undefined,                 // INFO 1
    Explicatii: invoice.notes || undefined,          // INFO 2
    // Numar: szándékosan NEM küldjük -> FGO automatikusan adja a következő számot
    Client: {
      Denumire: c.name, Tip: c.type || 'PJ', Tara: c.country || 'RO',
      Judet: c.county || undefined, CodUnic: c.cui || undefined,
      NrRegCom: c.regCom || undefined, Adresa: c.address || undefined,
      Localitate: c.city || undefined, Email: c.email || undefined, Telefon: c.phone || undefined,
    },
    Continut: (invoice.lines || []).map((l) => ({
      Denumire: l.name,
      Descriere: l.description || undefined,
      UM: l.unit || 'BUC',
      NrProduse: l.qty,
      CotaTVA: invoice.reverseCharge ? 0 : l.vatRate,
      PretUnitar: l.unitPrice,                        // NETTÓ egységár (klasszikus irány)
      CodArticol: l.code || undefined,
      CodGestiune: l.gestiune || undefined,
      CodCentruCost: l.costCenter || undefined,
    })),
  };
  const data = await post(creds, '/factura/emitere', body);
  if (!data.Success) return { ok: false, message: data.Message || 'Ismeretlen FGO hiba.' };
  const f = data.Factura || {};
  return { ok: true, serie: f.Serie || invoice.serie, numar: f.Numar, pdf_link: f.Link || null, pay_link: f.LinkPlata || null, raw: data };
}

async function getStatus(creds, ref) {
  const data = await post(creds, '/factura/getstatus', {
    CodUnic: creds.CodUnic, Hash: sha1U(creds.CodUnic + creds.PrivateKey + String(ref.numar)),
    PlatformaUrl: creds.PlatformaUrl, Numar: ref.numar, Serie: ref.serie,
  });
  if (!data.Success) return { ok: false, message: data.Message };
  const f = data.Factura || {};
  return { ok: true, value: f.Valoare, paid: f.ValoareAchitata, raw: data };
}

async function testConnection(creds) {
  if (!creds.CodUnic || !creds.PrivateKey) return { ok: false, message: 'Hiányzó CodUnic / PrivateKey.' };
  return { ok: true, message: 'Adatok rögzítve. Az éles ellenőrzés az első kiállításnál történik.' };
}

// Publikus nomenklátor (tipfactura, tva, ...) — GET, hash nélkül.
async function getNomenclator(creds, name) {
  const data = await call(`${base(creds)}/nomenclator/${encodeURIComponent(name)}`, { method: 'GET' });
  if (!data.Success) return [];
  return (data.List || []).map((x) => x.Nume);
}

// Mentett cikkek (csak ENTERPRISE!). Hiba/üres esetén [] -> a felület szabad szövegre vált.
async function listArticles(creds, page = 1, perPage = 200) {
  try {
    const data = await post(creds, '/articol/list', {
      CodUnic: creds.CodUnic, Hash: sha1U(creds.CodUnic + creds.PrivateKey),
      PlatformaUrl: creds.PlatformaUrl, NrPagina: page, NrArticole: perPage,
    });
    if (!data.Success || !data.Result) return [];
    return (data.Result.List || []).map((a) => ({
      name: a.Nume, um: a.UM || null, vat: a.CotaTva != null ? Math.round(a.CotaTva * 100) : null, price: a.PretUnitar,
    }));
  } catch (_) { return []; }
}

module.exports = { emit, getStatus, testConnection, getNomenclator, listArticles, provider: 'fgo' };
