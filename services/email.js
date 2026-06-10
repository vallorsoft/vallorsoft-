// ============================================================
//  VallorSoft — Email küldés (Brevo HTTP API)
//  Kivágva a régi server.js-ből, a kód-törzs változatlan.
// ============================================================
// ===== EMAIL KULDES: Brevo HTTP API (port 443, Render NEM blokkolja) =====
// Az SMTP (587/465) NEM mukodik Render ingyenes csomagon -> HTTP API kell.
// Brevo ingyenes 300 email/nap. Domain NEM kell, csak felado-cim hitelesites.
// Render env: BREVO_API_KEY=xkeysib-...   BREVO_SENDER=vallorteam.office@gmail.com
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SENDER  = process.env.BREVO_SENDER || process.env.MAIL_USER;

console.log('BREVO ready:', !!BREVO_API_KEY, '| sender:', BREVO_SENDER);

// HTML-escape a sablonokba kerülő (felhasználó által megadható) értékekre —
// egy cég-/usernév nem injektálhat markupot a VallorSoft-os levelekbe.
function escHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// fetch timeouttal — beragadt Brevo-kapcsolat ne tartsa fogva a user kérését.
async function fetchT(url, init, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

// A meghívó-e-mail HTML törzse — tiszta (mellékhatás nélküli) függvény, hogy
// egységteszttel ellenőrizhető legyen (a MEGHÍVOTT nevével köszön, reszponzív).
function buildInviteHtml({ kod, pozicio, cegNev, meghivottNev, registerUrl }) {
  const udvozles = meghivottNev ? `Tisztelt ${escHtml(meghivottNev)}!` : 'Tisztelt Címzett!';
  const regLink = `${registerUrl}/register`;
  const loginLink = `${registerUrl}/login`;
  return `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;background:#05070b;color:#e9eef5;padding:24px;border-radius:16px;">
          <div style="font-size:24px;font-weight:800;margin-bottom:4px;">
            <span style="color:#fff;">vallor</span><span style="color:#e10b1a;">Soft</span>
          </div>
          <div style="font-size:12px;color:#8a97a8;margin-bottom:24px;">Fuvarmenedzsment Platform</div>
          <h2 style="font-size:20px;margin-bottom:8px;line-height:1.3;">${udvozles}</h2>
          <p style="color:#b8c2d0;font-size:14px;line-height:1.6;margin-bottom:20px;">
            ${cegNev
              ? `A <b style="color:#fff;">${escHtml(cegNev)}</b> meghívta Önt a VallorSoft platformra`
              : 'Meghívást kapott a VallorSoft platformra'}
            <b style="color:#fff;">${escHtml(pozicio)}</b> szerepkörben.
          </p>
          <div style="background:#141c25;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:18px;margin-bottom:20px;text-align:center;">
            <div style="font-size:11px;color:#8a97a8;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px;">Meghívókódja</div>
            <div style="font-size:28px;font-weight:800;letter-spacing:3px;color:#fff;word-break:break-word;">${escHtml(kod)}</div>
          </div>
          <div style="text-align:center;margin:24px 0;">
            <a href="${regLink}" style="display:inline-block;background:#e10b1a;color:#fff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:10px;font-size:15px;">Regisztráció megnyitása</a>
          </div>
          <div style="background:#141c25;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:18px;margin-bottom:20px;">
            <div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:10px;">📋 Regisztráció lépései</div>
            <ol style="color:#b8c2d0;font-size:13px;line-height:1.8;padding-left:20px;margin:0;">
              <li>Nyissa meg a fenti <b style="color:#fff;">Regisztráció</b> gombot.</li>
              <li>Adja meg a nevét, e-mail címét és egy jelszót.</li>
              <li>A meghívókód mezőbe írja be: <b style="color:#fff;">${escHtml(kod)}</b></li>
              <li>A regisztráció után jelentkezzen be a platformon.</li>
            </ol>
          </div>
          <p style="font-size:12px;color:#8a97a8;line-height:1.6;margin:0 0 6px;">Ha a gomb nem működik, másolja be ezt a linket a böngészőbe:</p>
          <p style="word-break:break-all;font-size:12px;color:#3b82f6;margin:0 0 20px;">${escHtml(regLink)}</p>
          <p style="font-size:11px;color:#6b7689;line-height:1.5;margin:0;">Ez az e-mail automatikusan lett elküldve a VallorSoft rendszer által. Ha nem várta ezt az üzenetet, kérjük hagyja figyelmen kívül. Bejelentkezés: ${escHtml(loginLink)}</p>
        </div>
      `;
}

async function sendInviteEmail(toEmail, kod, pozicio, cegNev, meghivottNev) {
  console.log('sendInviteEmail called:', toEmail, !!BREVO_API_KEY);
  if (!BREVO_API_KEY || !BREVO_SENDER || !toEmail) {
    console.log('early return - BREVO_API_KEY, BREVO_SENDER vagy toEmail hianyzik');
    return;
  }
  const registerUrl = process.env.APP_URL || 'http://localhost:3000';
  const html = buildInviteHtml({ kod, pozicio, cegNev, meghivottNev, registerUrl });
  try {
    const resp = await fetchT('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'VallorSoft', email: BREVO_SENDER },
        to: [{ email: toEmail }],
        subject: `VallorSoft — Meghívó (${cegNev || 'VallorSoft'})`,
        htmlContent: html,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error('Brevo hiba:', resp.status, JSON.stringify(data));
    } else {
      console.log('Email elkulve, messageId:', data.messageId);
    }
  } catch (err) {
    console.error('Email kuldesi hiba:', err.message);
  }
}

// ============ JELSZO-VISSZAALLITO EMAIL ============
async function sendResetEmail(toEmail, nume, resetUrl) {
  console.log('sendResetEmail called:', toEmail, !!BREVO_API_KEY);
  if (!BREVO_API_KEY || !BREVO_SENDER || !toEmail) {
    console.log('early return - BREVO config vagy toEmail hianyzik');
    return;
  }
  const udvozles = nume ? `Tisztelt ${escHtml(nume)}!` : 'Tisztelt Felhasználónk!';
  const html = `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#05070b;color:#e9eef5;padding:32px;border-radius:16px;">
          <div style="font-size:24px;font-weight:800;margin-bottom:4px;">
            <span style="color:#fff;">vallor</span><span style="color:#e10b1a;">Soft</span>
          </div>
          <div style="font-size:12px;color:#8a97a8;margin-bottom:28px;">Fuvarmenedzsment Platform</div>
          <h2 style="font-size:20px;margin-bottom:8px;">${udvozles}</h2>
          <p style="color:#8a97a8;margin-bottom:16px;">
            Jelszó-visszaállítási kérelmet kaptunk a fiókjához. Ha Ön kérte, kattintson az alábbi gombra egy új jelszó beállításához.
          </p>
          <div style="text-align:center;margin:28px 0;">
            <a href="${resetUrl}" style="display:inline-block;background:#e10b1a;color:#fff;text-decoration:none;font-weight:700;padding:14px 32px;border-radius:10px;font-size:15px;">Új jelszó beállítása</a>
          </div>
          <p style="color:#8a97a8;font-size:13px;margin-bottom:8px;">Vagy másolja be ezt a linket a böngészőbe:</p>
          <p style="word-break:break-all;font-size:12px;color:#3b82f6;margin-bottom:24px;">${resetUrl}</p>
          <div style="background:#141c25;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:16px;margin-bottom:24px;">
            <p style="font-size:12px;color:#8a97a8;margin:0;">⏱️ Ez a link <b style="color:#fff;">1 óráig</b> érvényes. Ha nem Ön kérte a visszaállítást, hagyja figyelmen kívül ezt az emailt — a jelszava változatlan marad.</p>
          </div>
          <p style="font-size:11px;color:#8a97a8;margin:0;">Ez az email automatikusan lett elküldve a VallorSoft rendszer által.</p>
        </div>
      `;
  try {
    const resp = await fetchT('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'VallorSoft', email: BREVO_SENDER },
        to: [{ email: toEmail }],
        subject: 'VallorSoft — Jelszó visszaállítás',
        htmlContent: html,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error('Reset email Brevo hiba:', resp.status, JSON.stringify(data));
    } else {
      console.log('Reset email elkulve, messageId:', data.messageId);
    }
  } catch (err) {
    console.error('Reset email hiba:', err.message);
  }
}

// ============ KLIENS-E-MAIL (általános küldés: válasz/beszélgetés) ============
// Brevo HTTP API-n megy (mint a többi). A fejlécbe a cég logója kerül (ha van),
// különben a nagy „vallorSoft” felirat. opts: { to, subject, html, replyTo, senderName, logoUrl, attachments }
//   attachments: [{ name, contentBase64 }]
async function sendClientEmail(opts) {
  if (!BREVO_API_KEY || !BREVO_SENDER) return { ok: false, error: 'Nincs beállítva a BREVO_API_KEY / BREVO_SENDER (.env).' };
  if (!opts || !opts.to) return { ok: false, error: 'Hiányzik a címzett.' };
  const senderName = opts.senderName || 'VallorSoft';
  // Logo csak biztonságos URL-sémával kerülhet a levélbe (markup-injektálás ellen)
  const safeLogo = opts.logoUrl && /^(https?:\/\/|data:image\/)/i.test(String(opts.logoUrl)) ? String(opts.logoUrl) : null;
  const header = safeLogo
    ? `<img src="${escHtml(safeLogo)}" alt="${escHtml(senderName)}" style="max-height:48px;max-width:220px;display:block;margin-bottom:16px;">`
    : `<div style="font-size:24px;font-weight:800;margin-bottom:16px;"><span style="color:#0b0f14;">vallor</span><span style="color:#e10b1a;">Soft</span></div>`;
  const bodyHtml = (opts.html || '').trim();
  const html =
    `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0b0f14;padding:24px;">` +
      header +
      `<div style="font-size:14px;line-height:1.6;color:#1c2630;white-space:normal;">${bodyHtml}</div>` +
    `</div>`;
  const payload = {
    sender: { name: senderName, email: BREVO_SENDER },
    to: [{ email: opts.to }],
    subject: opts.subject || '(nincs tárgy)',
    htmlContent: html,
  };
  if (opts.replyTo) payload.replyTo = { email: opts.replyTo };
  if (Array.isArray(opts.attachments) && opts.attachments.length) {
    payload.attachment = opts.attachments
      .filter(a => a && a.contentBase64 && a.name)
      .map(a => ({ content: a.contentBase64, name: a.name }));
  }
  try {
    const resp = await fetchT('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return { ok: false, error: 'Brevo hiba (' + resp.status + '): ' + JSON.stringify(data).slice(0, 200) };
    return { ok: true, messageId: data.messageId };
  } catch (err) { return { ok: false, error: err.message }; }
}

module.exports = { sendInviteEmail, sendResetEmail, sendClientEmail, buildInviteHtml };
