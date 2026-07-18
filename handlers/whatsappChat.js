// ============================================================
//  VallorSoft — handlers/whatsappChat.js
//
//  Ideiglenes WhatsApp-alapú "chat" — a Firebase-es belső chatet
//  a felület átmenetileg WhatsApp-nyitóra váltja:
//    - Sofőr: a chat-kártya a cég WhatsApp-számára ugrik (wa.me/…).
//    - Manager/Admin: a chat pane a saját sofőrjeit listázza; kattintva
//      a sofőr `users.tel` alapján nyílik a WhatsApp.
//
//  Ez a modul CSAK a következő RPC-ket adja:
//    - getCompanyWhatsapp     (Admin/Manager/Sofer, olvasás; company_id-szűrt)
//    - saveCompanyWhatsapp    (Admin/Manager, írás; audit)
//    - listDriversForWhatsapp (Admin/Manager, csak név/email/tel; company_id)
//
//  Multi-tenant: minden lekérdezés `company_id=$…` szerint szűr.
//  Paraméteres SQL, generikus RO hibaüzenet.
// ============================================================
const pool = require('../db');
const audit = require('../lib/audit');

const handlers = {};

function _user(req) { return (req && req.session && req.session.user) || null; }
function _am(req)   { const u = _user(req); return !!(u && (u.pozicio === 'Admin' || u.pozicio === 'Manager')); }
function _any(req)  { const u = _user(req); return !!(u && ['Admin', 'Manager', 'Sofer'].includes(u.pozicio)); }

// E.164 normalizálás WhatsApp-hoz: csak számjegyeket tart meg + opcionális
// '+'-t; `wa.me/<szam>` a '+'-t nem várja, ezért CSAK a számjegyeket adjuk
// vissza (max 15 hosszú). Üres/érvénytelen -> null.
function normalizePhone(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const digits = s.replace(/[^\d]/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return digits;
}

// ── Olvasás — mindenki (Admin/Manager/Sofer) ─────────────────
// A sofőr csak azt a számot kapja meg, amit a saját cége Manager/Adminja
// beállított. Nincs cross-tenant szivárgás.
handlers.getCompanyWhatsapp = async function (req, res) {
  try {
    if (!_any(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _user(req).company_id;
    if (!cid) return res.json({ result: { ok: true, number: null } });
    const r = await pool.query('SELECT whatsapp_number FROM companies WHERE id=$1', [cid]);
    const num = normalizePhone((r.rows[0] || {}).whatsapp_number);
    return res.json({ result: { ok: true, number: num } });
  } catch (err) {
    console.error('getCompanyWhatsapp hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ── Írás — Admin/Manager ─────────────────────────────────────
// args: [{ number: '+40712345678' | '0712 345 678' | '' }] — üres = törlés.
handlers.saveCompanyWhatsapp = async function (req, res, args) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _user(req).company_id;
    if (!cid) return res.json({ result: { ok: false, err: 'Acces interzis' } });

    const raw = (args && args[0] && args[0].number != null) ? String(args[0].number).trim() : '';
    let num = null;
    if (raw) {
      num = normalizePhone(raw);
      if (!num) return res.json({ result: { ok: false, err: 'Număr de telefon invalid.' } });
    }

    await pool.query('UPDATE companies SET whatsapp_number=$1 WHERE id=$2', [num, cid]);
    audit.fromReq(req, 'company.whatsapp_save', 'company', cid, { hasNumber: !!num });
    return res.json({ result: { ok: true, number: num } });
  } catch (err) {
    console.error('saveCompanyWhatsapp hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

// ── Sofőr-lista a WhatsApp-nyitóhoz (Admin/Manager) ──────────
// Csak a saját cég belső sofőrjei; csak név/email/tel/pozíció.
handlers.listDriversForWhatsapp = async function (req, res) {
  try {
    if (!_am(req)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
    const cid = _user(req).company_id;
    if (!cid) return res.json({ result: { ok: true, drivers: [] } });
    const r = await pool.query(
      `SELECT id, nume, email, tel, pozicio
         FROM users
        WHERE company_id=$1 AND pozicio='Sofer' AND COALESCE(blocked,false)=false
        ORDER BY LOWER(nume)`, [cid]);
    const drivers = r.rows.map(u => ({
      id: u.id,
      nume: u.nume || '',
      email: u.email || '',
      tel: u.tel || '',
      tel_normalized: normalizePhone(u.tel),
      pozicio: u.pozicio || 'Sofer',
    }));
    return res.json({ result: { ok: true, drivers } });
  } catch (err) {
    console.error('listDriversForWhatsapp hiba:', err);
    return res.json({ result: { ok: false, err: 'Eroare de server' } });
  }
};

module.exports = handlers;

// Belső segéd, tesztekhez elérhető — nem-enumerable, így a
// routes/execute.js Object.assign-alapú registry-je nem veszi föl,
// és `/api/execute`-en át NEM hívható.
Object.defineProperty(module.exports, '_normalizePhone', { enumerable: false, value: normalizePhone });
