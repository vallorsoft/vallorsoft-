// VallorSoft — Trial csomag-választás link kezelő
// GET /api/trial/select-plan?cid=X&plan=Y&billing=monthly|annual&tok=Z
// Az emailből kattintva: BNR árfolyam + banki adatok + referencia-kód → fizetési email

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const pool    = require('../db');
const { sendClientEmail }  = require('../services/email');
const { fetchBnrEurRon }   = require('../services/bnr');

// HMAC token generálás / ellenőrzés
function makeToken(cid, planId, billing) {
  const secret = process.env.SESSION_SECRET || 'dev-secret';
  return crypto.createHmac('sha256', secret)
    .update(`${cid}:${planId}:${billing}`)
    .digest('hex').slice(0, 16);
}

// Fizetési referencia-kód generálás (VS-YYYYMM-XXXX)
async function generateReference(companyId) {
  const ym = new Date().toISOString().slice(0, 7).replace('-', '');
  const base = `VS-${ym}-${String(companyId).padStart(4, '0')}`;
  // Ha már létezik ilyen, suffix-et adunk
  const existing = await pool.query(
    'SELECT reference FROM payment_requests WHERE reference LIKE $1 ORDER BY created_at DESC LIMIT 5',
    [base + '%']
  );
  if (!existing.rows.length) return base;
  const last = existing.rows[0].reference;
  const m = last.match(/-(\d+)$/);
  const suffix = m ? parseInt(m[1]) + 1 : 2;
  return `${base}-${suffix}`;
}

// Fizetési email HTML generálás
function buildPaymentEmailHtml({ company, plan, billing, amountEur, amountRon, tvaRon, totalRon, bnrRate, reference, bankDetails, appUrl }) {
  const isAnnual   = billing === 'annual';
  const perioadas = isAnnual ? 'anual (11 luni facturate, 12 luni acces)' : 'lunar';
  const rateStr    = bnrRate ? bnrRate.toFixed(4) : '—';
  const eurStr     = amountEur ? amountEur.toFixed(2) : '—';
  const ronStr     = amountRon ? amountRon.toFixed(2) : '—';
  const tvaStr     = tvaRon   ? tvaRon.toFixed(2)    : '—';
  const totalStr   = totalRon ? totalRon.toFixed(2)  : '—';

  const bankHtml = bankDetails
    ? `<table style="width:100%;border-collapse:collapse;margin:12px 0;">
        <tr><td style="padding:6px 0;color:#475569;font-size:13px;">Titular cont</td>
            <td style="padding:6px 0;font-weight:600;font-size:13px;">${escH(bankDetails.holder || '')}</td></tr>
        <tr><td style="padding:6px 0;color:#475569;font-size:13px;">IBAN</td>
            <td style="padding:6px 0;font-weight:600;font-size:13px;font-family:monospace;">${escH(bankDetails.iban || '')}</td></tr>
        <tr><td style="padding:6px 0;color:#475569;font-size:13px;">Bancă</td>
            <td style="padding:6px 0;font-weight:600;font-size:13px;">${escH(bankDetails.bank || '')}</td></tr>
        ${bankDetails.swift ? `<tr><td style="padding:6px 0;color:#475569;font-size:13px;">SWIFT/BIC</td>
            <td style="padding:6px 0;font-weight:600;font-size:13px;font-family:monospace;">${escH(bankDetails.swift)}</td></tr>` : ''}
       </table>`
    : '<p style="color:#ef4444;font-size:13px;">Datele bancare nu sunt configurate. Contactați: vallorsoft@gmail.com</p>';

  return `<div style="font-family:sans-serif;max-width:580px;margin:0 auto;color:#0f172a;">
  <div style="background:linear-gradient(135deg,#6366f1,#3b82f6);padding:28px 32px;border-radius:12px 12px 0 0;">
    <h1 style="margin:0;color:#fff;font-size:22px;">vallor<span style="color:#c7d2fe;">Soft</span></h1>
    <p style="margin:8px 0 0;color:rgba(255,255,255,.8);font-size:14px;">Detalii plată</p>
  </div>
  <div style="background:#fff;padding:28px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;">

    <p style="margin:0 0 20px;font-size:15px;">Ați selectat pachetul <strong>${escH(plan.name)}</strong> (${perioadas}) pentru compania <em>${escH(company.nev)}</em>.</p>

    <!-- Összesítő táblázat -->
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;margin-bottom:20px;">
      <div style="font-size:13px;color:#475569;margin-bottom:8px;font-weight:600;">REZUMAT PLATĂ</div>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:4px 0;font-size:13px;color:#64748b;">Pachet</td>
            <td style="padding:4px 0;font-size:13px;text-align:right;">${escH(plan.name)} (${perioadas})</td></tr>
        <tr><td style="padding:4px 0;font-size:13px;color:#64748b;">Preț net EUR</td>
            <td style="padding:4px 0;font-size:13px;text-align:right;">€${eurStr}</td></tr>
        <tr><td style="padding:4px 0;font-size:13px;color:#64748b;">Curs BNR EUR/RON</td>
            <td style="padding:4px 0;font-size:13px;text-align:right;">${rateStr} RON/€</td></tr>
        <tr><td style="padding:4px 0;font-size:13px;color:#64748b;">Preț net RON</td>
            <td style="padding:4px 0;font-size:13px;text-align:right;">${ronStr} RON</td></tr>
        <tr><td style="padding:4px 0;font-size:13px;color:#64748b;">TVA 21%</td>
            <td style="padding:4px 0;font-size:13px;text-align:right;">${tvaStr} RON</td></tr>
        <tr style="border-top:2px solid #6366f1;">
          <td style="padding:8px 0 4px;font-size:15px;font-weight:700;">TOTAL</td>
          <td style="padding:8px 0 4px;font-size:15px;font-weight:700;text-align:right;color:#6366f1;">${totalStr} RON</td>
        </tr>
      </table>
    </div>

    <!-- Banki adatok -->
    <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:16px 20px;margin-bottom:20px;">
      <div style="font-size:13px;color:#166534;font-weight:700;margin-bottom:8px;">DATE CONT BANCAR</div>
      ${bankHtml}
    </div>

    <!-- Referencia kód -->
    <div style="background:linear-gradient(135deg,rgba(99,102,241,.08),rgba(59,130,246,.08));border:2px solid #6366f1;border-radius:10px;padding:16px 20px;margin-bottom:20px;text-align:center;">
      <div style="font-size:12px;color:#6366f1;font-weight:700;letter-spacing:.5px;margin-bottom:6px;">REFERINȚĂ PLATĂ</div>
      <div style="font-size:26px;font-weight:800;font-family:monospace;letter-spacing:2px;color:#0f172a;">${escH(reference)}</div>
      <div style="font-size:12px;color:#475569;margin-top:6px;">Scrieți acest cod în câmpul „Observații" al ordinului de plată.</div>
    </div>

    <p style="font-size:13px;color:#475569;margin:0 0 20px;">
      Vă rugăm efectuați plata în termen de <strong>5 zile lucrătoare</strong>.
      Abonamentul va fi activat în maxim 24h de la confirmarea plății.
    </p>

    <a href="${appUrl}/admin" style="display:inline-block;background:linear-gradient(180deg,#3b82f6,#2563eb);color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:600;font-size:14px;">
      Intră în aplicație
    </a>

    <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;">
      Întrebări? <a href="mailto:vallorsoft@gmail.com" style="color:#6366f1;">vallorsoft@gmail.com</a>
      · <a href="${appUrl}/terms" style="color:#6366f1;">Termeni</a>
    </p>
  </div>
</div>`;
}

function escH(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

router.get('/api/trial/select-plan', async (req, res) => {
  const { cid, plan, billing = 'monthly', tok } = req.query;
  const appUrl = process.env.APP_URL || 'https://app.vallorsoft.com';

  // Token ellenőrzés
  if (!cid || !plan || !tok || tok !== makeToken(cid, plan, billing)) {
    return res.status(400).send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px;">
      <h2 style="color:#ef4444;">Link invalid sau expirat</h2>
      <p>Contactați: <a href="mailto:vallorsoft@gmail.com">vallorsoft@gmail.com</a></p>
    </body></html>`);
  }

  try {
    // Cég és csomag adatok lekérése
    const [compR, planR, bankR] = await Promise.all([
      pool.query('SELECT id, nev, email_contact FROM companies WHERE id=$1', [cid]),
      pool.query('SELECT id, name, price_net FROM subscription_plans WHERE id=$1', [plan]),
      pool.query("SELECT value FROM developer_settings WHERE key='bank_details'"),
    ]);

    if (!compR.rows.length || !planR.rows.length) {
      return res.status(404).send('<html><body style="font-family:sans-serif;text-align:center;padding:60px;"><h2>Companie sau pachet negăsit.</h2></body></html>');
    }

    const company     = compR.rows[0];
    const planData    = planR.rows[0];
    const bankDetails = bankR.rows[0]?.value || null;
    const isAnnual    = billing === 'annual';

    // Ár számítás
    const monthlyEur  = parseFloat(planData.price_net) || 0;
    const amountEur   = isAnnual ? monthlyEur * 11 : monthlyEur;

    // BNR árfolyam
    const bnrRate  = await fetchBnrEurRon();
    const amountRon = bnrRate ? Math.round(amountEur * bnrRate * 100) / 100 : null;
    const tvaRon    = amountRon ? Math.round(amountRon * 0.21 * 100) / 100 : null;
    const totalRon  = amountRon && tvaRon ? Math.round((amountRon + tvaRon) * 100) / 100 : null;

    // Referencia-kód generálás
    const reference = await generateReference(cid);

    // Mentés DB-be
    await pool.query(
      `INSERT INTO payment_requests
         (company_id, plan_id, billing_type, reference, amount_eur, amount_ron, tva_ron, total_ron, bnr_rate, email_sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
      [cid, plan, billing, reference, amountEur, amountRon, tvaRon, totalRon, bnrRate]
    );

    // Fizetési email küldés
    if (monthlyEur > 0 && company.email_contact) {
      const emailHtml = buildPaymentEmailHtml({
        company, plan: planData, billing, amountEur, amountRon, tvaRon, totalRon, bnrRate, reference, bankDetails, appUrl
      });
      await sendClientEmail({
        to:      company.email_contact,
        subject: `VallorSoft — Detalii plată: ${planData.name} · ${reference}`,
        html:    emailHtml,
      }).catch((e) => console.warn('[trial-select] Fizetési email hiba:', e.message));
    }

    // Köszönő oldal
    return res.send(`<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VallorSoft — Mulțumim</title>
<style>body{font-family:sans-serif;background:#f7f9fc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
.box{background:#fff;border-radius:16px;padding:40px;max-width:520px;text-align:center;box-shadow:0 4px 24px rgba(15,23,42,.08);border:1px solid #e2e8f0;}
h1{font-size:22px;color:#0f172a;margin-bottom:8px;}
p{color:#475569;line-height:1.6;font-size:15px;}
.ref{font-size:28px;font-weight:800;font-family:monospace;color:#6366f1;letter-spacing:2px;background:rgba(99,102,241,.08);padding:10px 20px;border-radius:8px;display:inline-block;margin:12px 0;}
a.btn{display:inline-block;margin-top:20px;background:linear-gradient(180deg,#3b82f6,#2563eb);color:#fff;text-decoration:none;padding:11px 24px;border-radius:8px;font-weight:600;}</style>
</head>
<body><div class="box">
  <div style="font-size:48px;margin-bottom:12px;">✅</div>
  <h1>Mulțumim!</h1>
  <p>Am primit solicitarea dvs. pentru pachetul <strong>${escH(planData.name)}</strong>.<br>
  Am trimis detaliile de plată la <strong>${escH(company.email_contact)}</strong>.</p>
  <div class="ref">${escH(reference)}</div>
  <p style="font-size:13px;">Scrieți acest cod în câmpul observații al ordinului de plată.</p>
  <a class="btn" href="${appUrl}/admin">Intră în aplicație</a>
</div></body></html>`);

  } catch (err) {
    console.error('[trial-select] Hiba:', err.message);
    return res.status(500).send('<html><body style="font-family:sans-serif;text-align:center;padding:60px;"><h2>Eroare de server</h2></body></html>');
  }
});

module.exports = router;
