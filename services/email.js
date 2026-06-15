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

// Pool import a developer_settings sablon-lekéréshez
// (lazy require: csak ha szükséges, elkerüli a körkörös függőséget)
let _pool = null;
function getPool() {
  if (!_pool) _pool = require('../db');
  return _pool;
}

// Rendszer-email sablon lekérése DB-ből — async, best-effort.
// Ha nincs sablon, null-t ad vissza (a hívó a hardcoded szöveget használja).
async function getEmailTemplate(key) {
  try {
    const r = await getPool().query(
      'SELECT value FROM developer_settings WHERE key=$1', [key]
    );
    return r.rows.length ? r.rows[0].value : null;
  } catch (e) {
    console.warn('[email] sablon lekérés hiba (' + key + '):', e.message);
    return null;
  }
}

// Változókat ({{kulcs}}) biztonságosan cseréli le a sablon szövegben (XSS-védelem).
function applyTemplateVars(text, vars, rawVars) {
  if (!text) return '';
  return text.replace(/\{\{(\w+)\}\}/g, function(_, k) {
    if (rawVars && k in rawVars) return rawVars[k]; // megbízható HTML, nem escape-eljük
    return k in vars ? escHtml(String(vars[k])) : '';
  });
}

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
// lang: 'ro' (alap) | 'hu' — a cég e-mail-nyelve (admin állítja).
function buildInviteHtml({ kod, pozicio, cegNev, meghivottNev, registerUrl, lang }) {
  const L = lang === 'hu' ? 'hu' : 'ro';
  const regLink = `${registerUrl}/register`;
  const loginLink = `${registerUrl}/login`;
  const nm = escHtml(meghivottNev), cg = escHtml(cegNev), pz = escHtml(pozicio), kd = escHtml(kod);
  const S = {
    platform: { hu: 'Fuvarmenedzsment Platform', ro: 'Platformă de management transport' }[L],
    greet: meghivottNev ? ({ hu: 'Tisztelt ', ro: 'Stimate ' }[L] + nm + '!') : ({ hu: 'Tisztelt Címzett!', ro: 'Stimate destinatar!' }[L]),
    invited: cegNev
      ? ({ hu: `A <b style="color:#fff;">${cg}</b> meghívta Önt a VallorSoft platformra`, ro: `<b style="color:#fff;">${cg}</b> v-a invitat pe platforma VallorSoft` }[L])
      : ({ hu: 'Meghívást kapott a VallorSoft platformra', ro: 'Ați primit o invitație pe platforma VallorSoft' }[L]),
    inRole: { hu: ` <b style="color:#fff;">${pz}</b> szerepkörben.`, ro: ` în rolul de <b style="color:#fff;">${pz}</b>.` }[L],
    yourCode: { hu: 'Meghívókódja', ro: 'Codul dvs. de invitație' }[L],
    openReg: { hu: 'Regisztráció megnyitása', ro: 'Deschide înregistrarea' }[L],
    stepsTitle: { hu: '📋 Regisztráció lépései', ro: '📋 Pașii înregistrării' }[L],
    step1: { hu: 'Nyissa meg a fenti <b style="color:#fff;">Regisztráció</b> gombot.', ro: 'Deschideți butonul <b style="color:#fff;">Înregistrare</b> de mai sus.' }[L],
    step2: { hu: 'Adja meg a nevét, e-mail címét és egy jelszót.', ro: 'Introduceți numele, adresa de e-mail și o parolă.' }[L],
    step3: { hu: `A meghívókód mezőbe írja be: <b style="color:#fff;">${kd}</b>`, ro: `În câmpul cod de invitație introduceți: <b style="color:#fff;">${kd}</b>` }[L],
    step4: { hu: 'A regisztráció után jelentkezzen be a platformon.', ro: 'După înregistrare, autentificați-vă pe platformă.' }[L],
    ifBtn: { hu: 'Ha a gomb nem működik, másolja be ezt a linket a böngészőbe:', ro: 'Dacă butonul nu funcționează, copiați acest link în browser:' }[L],
    footer: { hu: `Ez az e-mail automatikusan lett elküldve a VallorSoft rendszer által. Ha nem várta ezt az üzenetet, kérjük hagyja figyelmen kívül. Bejelentkezés: ${escHtml(loginLink)}`, ro: `Acest e-mail a fost trimis automat de sistemul VallorSoft. Dacă nu așteptați acest mesaj, ignorați-l. Autentificare: ${escHtml(loginLink)}` }[L],
  };
  return `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;background:#05070b;color:#e9eef5;padding:24px;border-radius:16px;">
          <div style="font-size:24px;font-weight:800;margin-bottom:4px;">
            <span style="color:#fff;">vallor</span><span style="color:#e10b1a;">Soft</span>
          </div>
          <div style="font-size:12px;color:#8a97a8;margin-bottom:24px;">${S.platform}</div>
          <h2 style="font-size:20px;margin-bottom:8px;line-height:1.3;">${S.greet}</h2>
          <p style="color:#b8c2d0;font-size:14px;line-height:1.6;margin-bottom:20px;">
            ${S.invited}${S.inRole}
          </p>
          <div style="background:#141c25;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:18px;margin-bottom:20px;text-align:center;">
            <div style="font-size:11px;color:#8a97a8;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px;">${S.yourCode}</div>
            <div style="font-size:28px;font-weight:800;letter-spacing:3px;color:#fff;word-break:break-word;">${kd}</div>
          </div>
          <div style="text-align:center;margin:24px 0;">
            <a href="${regLink}" style="display:inline-block;background:#e10b1a;color:#fff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:10px;font-size:15px;">${S.openReg}</a>
          </div>
          <div style="background:#141c25;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:18px;margin-bottom:20px;">
            <div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:10px;">${S.stepsTitle}</div>
            <ol style="color:#b8c2d0;font-size:13px;line-height:1.8;padding-left:20px;margin:0;">
              <li>${S.step1}</li>
              <li>${S.step2}</li>
              <li>${S.step3}</li>
              <li>${S.step4}</li>
            </ol>
          </div>
          <p style="font-size:12px;color:#8a97a8;line-height:1.6;margin:0 0 6px;">${S.ifBtn}</p>
          <p style="word-break:break-all;font-size:12px;color:#3b82f6;margin:0 0 20px;">${escHtml(regLink)}</p>
          <p style="font-size:11px;color:#6b7689;line-height:1.5;margin:0;">${S.footer}</p>
        </div>
      `;
}

async function sendInviteEmail(toEmail, kod, pozicio, cegNev, meghivottNev, lang) {
  console.log('sendInviteEmail called:', toEmail, !!BREVO_API_KEY);
  if (!BREVO_API_KEY || !BREVO_SENDER || !toEmail) {
    console.log('early return - BREVO_API_KEY, BREVO_SENDER vagy toEmail hianyzik');
    return;
  }
  const L = lang === 'hu' ? 'hu' : 'ro';
  const registerUrl = process.env.APP_URL || 'http://localhost:3000';

  // DB sablon felülírja a hardcoded-ot, ha be van állítva
  let html, subject;
  const tpl = await getEmailTemplate('email_sys_invite');
  if (tpl && tpl.subject && (tpl.body_ro || tpl.body_hu)) {
    const bodyText = L === 'hu' ? (tpl.body_hu || tpl.body_ro) : (tpl.body_ro || tpl.body_hu);
    const vars = { nev: meghivottNev || '', ceg_nev: cegNev || '', pozicio: pozicio || '', register_url: registerUrl + '/register' };
    subject = applyTemplateVars(tpl.subject, vars);
    html = applyTemplateVars(bodyText, vars);
  } else {
    html = buildInviteHtml({ kod, pozicio, cegNev, meghivottNev, registerUrl, lang: L });
    subject = (L === 'hu' ? 'VallorSoft — Meghívó' : 'VallorSoft — Invitație') + ` (${cegNev || 'VallorSoft'})`;
  }

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
        subject: subject,
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
async function sendResetEmail(toEmail, nume, resetUrl, lang) {
  console.log('sendResetEmail called:', toEmail, !!BREVO_API_KEY);
  if (!BREVO_API_KEY || !BREVO_SENDER || !toEmail) {
    console.log('early return - BREVO config vagy toEmail hianyzik');
    return false; // nincs e-mail-konfig → a hívó kecsesen kezeli (emailed:false)
  }
  const L = lang === 'hu' ? 'hu' : 'ro';

  // DB sablon ellenőrzés — ha van, azt küldjük
  const tpl = await getEmailTemplate('email_sys_reset');
  if (tpl && tpl.subject && (tpl.body_ro || tpl.body_hu)) {
    const bodyText = L === 'hu' ? (tpl.body_hu || tpl.body_ro) : (tpl.body_ro || tpl.body_hu);
    const btnLabel = L === 'hu' ? 'Új jelszó beállítása' : 'Setează parolă nouă';
    const safeUrl  = (resetUrl || '').replace(/"/g, '%22');
    const vars    = { nev: escHtml(nume || ''), reset_url: resetUrl || '' };
    const rawVars = {
      reset_url_btn:  `<a href="${safeUrl}" style="display:inline-block;background:#e10b1a;color:#fff;text-decoration:none;font-weight:700;padding:14px 32px;border-radius:10px;font-size:15px;">${btnLabel}</a>`,
      reset_url_link: `<a href="${safeUrl}" style="color:#3b82f6;word-break:break-all;">${escHtml(resetUrl || '')}</a>`,
    };
    const subject = applyTemplateVars(tpl.subject, vars, rawVars);
    const htmlContent = applyTemplateVars(bodyText, vars, rawVars);
    try {
      const resp = await fetchT('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', 'accept': 'application/json' },
        body: JSON.stringify({ sender: { name: 'VallorSoft', email: BREVO_SENDER }, to: [{ email: toEmail }], subject, htmlContent }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) { console.error('Reset email (tpl) Brevo hiba:', resp.status, JSON.stringify(data)); return false; }
      console.log('Reset email (tpl) elküldve, messageId:', data.messageId);
      return true;
    } catch (err) {
      console.error('Reset email (tpl) hiba:', err.message);
      return false;
    }
  }

  const nm = escHtml(nume);
  const S = {
    platform: { hu: 'Fuvarmenedzsment Platform', ro: 'Platformă de management transport' }[L],
    greet: nume ? ({ hu: 'Tisztelt ', ro: 'Stimate ' }[L] + nm + '!') : ({ hu: 'Tisztelt Felhasználónk!', ro: 'Stimate utilizator!' }[L]),
    intro: { hu: 'Jelszó-visszaállítási kérelmet kaptunk a fiókjához. Ha Ön kérte, kattintson az alábbi gombra egy új jelszó beállításához.', ro: 'Am primit o cerere de resetare a parolei pentru contul dvs. Dacă ați solicitat-o, apăsați butonul de mai jos pentru a seta o parolă nouă.' }[L],
    btn: { hu: 'Új jelszó beállítása', ro: 'Setează parolă nouă' }[L],
    or: { hu: 'Vagy másolja be ezt a linket a böngészőbe:', ro: 'Sau copiați acest link în browser:' }[L],
    valid: { hu: '⏱️ Ez a link <b style="color:#fff;">1 óráig</b> érvényes. Ha nem Ön kérte a visszaállítást, hagyja figyelmen kívül ezt az emailt — a jelszava változatlan marad.', ro: '⏱️ Acest link este valabil <b style="color:#fff;">1 oră</b>. Dacă nu ați solicitat resetarea, ignorați acest e-mail — parola rămâne neschimbată.' }[L],
    footer: { hu: 'Ez az email automatikusan lett elküldve a VallorSoft rendszer által.', ro: 'Acest e-mail a fost trimis automat de sistemul VallorSoft.' }[L],
  };
  const html = `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#05070b;color:#e9eef5;padding:32px;border-radius:16px;">
          <div style="font-size:24px;font-weight:800;margin-bottom:4px;">
            <span style="color:#fff;">vallor</span><span style="color:#e10b1a;">Soft</span>
          </div>
          <div style="font-size:12px;color:#8a97a8;margin-bottom:28px;">${S.platform}</div>
          <h2 style="font-size:20px;margin-bottom:8px;">${S.greet}</h2>
          <p style="color:#8a97a8;margin-bottom:16px;">${S.intro}</p>
          <div style="text-align:center;margin:28px 0;">
            <a href="${resetUrl}" style="display:inline-block;background:#e10b1a;color:#fff;text-decoration:none;font-weight:700;padding:14px 32px;border-radius:10px;font-size:15px;">${S.btn}</a>
          </div>
          <p style="color:#8a97a8;font-size:13px;margin-bottom:8px;">${S.or}</p>
          <p style="word-break:break-all;font-size:12px;color:#3b82f6;margin-bottom:24px;">${resetUrl}</p>
          <div style="background:#141c25;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:16px;margin-bottom:24px;">
            <p style="font-size:12px;color:#8a97a8;margin:0;">${S.valid}</p>
          </div>
          <p style="font-size:11px;color:#8a97a8;margin:0;">${S.footer}</p>
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
        subject: L === 'hu' ? 'VallorSoft — Jelszó visszaállítás' : 'VallorSoft — Resetare parolă',
        htmlContent: html,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error('Reset email Brevo hiba:', resp.status, JSON.stringify(data));
      return false; // Brevo elutasította → nem ment ki e-mail
    }
    console.log('Reset email elkulve, messageId:', data.messageId);
    return true; // sikeres kiküldés
  } catch (err) {
    console.error('Reset email hiba:', err.message);
    return false; // hálózati/egyéb hiba → nem ment ki e-mail
  }
}

// ============ KLIENS-E-MAIL (általános küldés: válasz/beszélgetés) ============
// Brevo HTTP API-n megy (mint a többi). A fejlécbe a cég logója kerül (ha van),
// különben a nagy „vallorSoft” felirat. opts: { to, subject, html, replyTo, senderName, logoUrl, attachments }
//   attachments: [{ name, contentBase64 }]
async function sendClientEmail(opts) {
  if (!BREVO_API_KEY || !BREVO_SENDER) return { ok: false, error: 'BREVO_API_KEY / BREVO_SENDER nu este configurat (.env).' };
  if (!opts || !opts.to) return { ok: false, error: 'Lipsește destinatarul.' };
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

// Developer által küldött sablonalapú email — VallorSoft branding wrapperrel
async function sendDeveloperEmail(toEmail, companyName, subject, htmlBody) {
  if (!BREVO_API_KEY || !BREVO_SENDER || !toEmail) {
    return { ok: false, error: 'BREVO_API_KEY / BREVO_SENDER nu este configurat.' };
  }
  const loginLink = (process.env.APP_URL || 'http://localhost:3000') + '/login';
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;background:#05070b;color:#e9eef5;padding:24px;border-radius:16px;">
      <div style="font-size:24px;font-weight:800;margin-bottom:4px;">
        <span style="color:#fff;">Vallor</span><span style="color:#6366f1;">Soft</span>
      </div>
      <div style="font-size:12px;color:#8a97a8;margin-bottom:24px;">Platformă de management transport</div>
      <div style="color:#e9eef5;font-size:14px;line-height:1.7;">${htmlBody}</div>
      <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:24px 0;">
      <p style="font-size:11px;color:#6b7689;line-height:1.5;margin:0;">
        Acest e-mail a fost trimis automat de sistemul VallorSoft.<br>
        Autentificare: <a href="${escHtml(loginLink)}" style="color:#6366f1;">${escHtml(loginLink)}</a>
      </p>
    </div>`;
  try {
    const resp = await fetchT('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify({
        sender: { name: 'VallorSoft', email: BREVO_SENDER },
        to: [{ email: toEmail, name: companyName || toEmail }],
        subject: subject,
        htmlContent: html,
      }),
    });
    if (!resp.ok) {
      const err = await resp.text().catch(() => '');
      return { ok: false, error: 'Brevo error: ' + err.slice(0, 120) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { sendInviteEmail, sendResetEmail, sendClientEmail, buildInviteHtml, sendDeveloperEmail, getEmailTemplate };
