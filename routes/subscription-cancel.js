// ============================================================
//  VallorSoft — Előfizetés-lemondás visszavonása e-mail linkről
//  GET /abonament/reactivare?cid=X&tok=Y
//  Az értesítő e-mail "M-am răzgândit" gombja ide mutat. Bejelentkezés
//  NÉLKÜL működik — a HMAC token (a lemondás időpontjához kötve) hitelesít.
//  Sikeres ellenőrzés után törli a lemondás-jelzőt (az előfizetés aktív marad).
// ============================================================
const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const crypto  = require('crypto');
const { makeReactivateToken } = require('../lib/trialToken');

function escH(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Egyszerű, meleg arculatú önálló visszajelző oldal (RO).
function page(title, msg, ok, appUrl) {
  const accent = ok ? '#16a34a' : '#ef4444';
  const icon = ok ? '✓' : '⚠';
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escH(title)} — VallorSoft</title>
<style>
  body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#f4efe9;color:#2a2018;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;}
  .card{max-width:480px;width:100%;background:#fff;border:1px solid #ece3d8;border-radius:16px;overflow:hidden;box-shadow:0 14px 40px -20px rgba(60,40,20,.4);}
  .hd{background:linear-gradient(135deg,#fb8c3a,#f6517b);padding:26px 28px;}
  .hd h1{margin:0;color:#fff;font-size:22px;}
  .bd{padding:30px 28px;text-align:center;}
  .ic{width:64px;height:64px;line-height:64px;border-radius:50%;background:${accent};color:#fff;font-size:32px;margin:0 auto 18px;}
  .bd h2{margin:0 0 10px;font-size:20px;color:${accent};}
  .bd p{margin:0 0 20px;font-size:15px;line-height:1.7;color:#5a4636;}
  .btn{display:inline-block;background:linear-gradient(180deg,#fb8c3a,#f6711e);color:#fff;text-decoration:none;padding:12px 26px;border-radius:9px;font-weight:700;font-size:14px;}
</style></head><body>
  <div class="card">
    <div class="hd"><h1>vallor<span style="color:#fdba74;">Soft</span></h1></div>
    <div class="bd">
      <div class="ic">${icon}</div>
      <h2>${escH(title)}</h2>
      <p>${escH(msg)}</p>
      <a class="btn" href="${escH((appUrl || '') + '/login')}">Autentificare</a>
    </div>
  </div>
</body></html>`;
}

router.get('/abonament/reactivare', async (req, res) => {
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  const cid = parseInt(req.query.cid, 10);
  const tok = String(req.query.tok || '');
  if (!cid || !tok) {
    return res.status(400).send(page('Link invalid', 'Lipsesc date din link. Deschideți din nou e-mailul.', false, appUrl));
  }
  try {
    const r = await pool.query(
      'SELECT nev, subscription_cancel_at FROM companies WHERE id=$1', [cid]);
    if (!r.rows.length) {
      return res.status(404).send(page('Negăsit', 'Compania nu a fost găsită.', false, appUrl));
    }
    const c = r.rows[0];
    if (!c.subscription_cancel_at) {
      // Nincs folyamatban lemondás — vagy már visszavonták, vagy sosem volt.
      return res.send(page('Abonament activ', 'Abonamentul este deja activ — nu este nimic de reactivat.', true, appUrl));
    }
    const sec = Math.floor(new Date(c.subscription_cancel_at).getTime() / 1000);
    const expected = makeReactivateToken(cid, sec);
    const a = Buffer.from(tok), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(403).send(page('Link invalid', 'Acest link nu mai este valid. Reactivați din cont sau contactați-ne.', false, appUrl));
    }
    await pool.query(
      'UPDATE companies SET subscription_cancel_at=NULL, cancel_lastday_notified=false WHERE id=$1', [cid]);
    return res.send(page('Bine ați revenit!', 'Anularea a fost anulată — abonamentul rămâne activ. Vă mulțumim că rămâneți alături de noi!', true, appUrl));
  } catch (e) {
    console.error('reactivare hiba:', e.message);
    return res.status(500).send(page('Eroare', 'A apărut o eroare. Vă rugăm încercați din nou.', false, appUrl));
  }
});

module.exports = router;
