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

// Levél-napló (mail_log) best-effort segéd. Lazy require a körkörös
// függőség elkerülésére. SOHA nem buktatja a küldést (try/catch).
// Csak akkor naplóz, ha van company_id (multi-tenant) — különben kihagy.
function _logMail(companyId, toEmail, subject, type, status, providerId) {
  if (!companyId) return; // company_id nélkül NEM naplózunk
  try {
    const { logMail } = require('../handlers/mailLog');
    Promise.resolve(logMail(getPool(), {
      company_id: companyId, to_email: toEmail, subject: subject,
      type: type, status: status, provider_id: providerId || null,
    })).catch(() => {});
  } catch (_) { /* best-effort */ }
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
function buildInviteHtml({ kod, pozicio, cegNev, meghivottNev, registerUrl }) {
  const L = 'ro';
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
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;background:#1e1812;color:#faf6f0;padding:24px;border-radius:16px;">
          <div style="font-size:24px;font-weight:800;margin-bottom:4px;">
            <span style="color:#fff;">vallor</span><span style="color:#f6711e;">Soft</span>
          </div>
          <div style="font-size:12px;color:#fdba74;margin-bottom:24px;">${S.platform}</div>
          <h2 style="font-size:20px;margin-bottom:8px;line-height:1.3;">${S.greet}</h2>
          <p style="color:#e7d8c6;font-size:14px;line-height:1.6;margin-bottom:20px;">
            ${S.invited}${S.inRole}
          </p>
          <div style="background:#271f18;border:1px solid rgba(253,186,116,0.18);border-radius:12px;padding:18px;margin-bottom:20px;text-align:center;">
            <div style="font-size:11px;color:#fdba74;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px;">${S.yourCode}</div>
            <div style="font-size:28px;font-weight:800;letter-spacing:3px;color:#fff;word-break:break-word;">${kd}</div>
          </div>
          <div style="text-align:center;margin:24px 0;">
            <a href="${regLink}" style="display:inline-block;background:#f6711e;color:#fff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:10px;font-size:15px;">${S.openReg}</a>
          </div>
          <div style="background:#271f18;border:1px solid rgba(253,186,116,0.18);border-radius:12px;padding:18px;margin-bottom:20px;">
            <div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:10px;">${S.stepsTitle}</div>
            <ol style="color:#e7d8c6;font-size:13px;line-height:1.8;padding-left:20px;margin:0;">
              <li>${S.step1}</li>
              <li>${S.step2}</li>
              <li>${S.step3}</li>
              <li>${S.step4}</li>
            </ol>
          </div>
          <p style="font-size:12px;color:#fdba74;line-height:1.6;margin:0 0 6px;">${S.ifBtn}</p>
          <p style="word-break:break-all;font-size:12px;color:#f6517b;margin:0 0 20px;">${escHtml(regLink)}</p>
          <p style="font-size:11px;color:#b09a82;line-height:1.5;margin:0;">${S.footer}</p>
        </div>
      `;
}

// companyId (opcionális, additív): ha megadott, a kiküldés a mail_log-ba kerül.
async function sendInviteEmail(toEmail, kod, pozicio, cegNev, meghivottNev, lang, companyId) {
  console.log('sendInviteEmail called:', toEmail, !!BREVO_API_KEY);
  if (!BREVO_API_KEY || !BREVO_SENDER || !toEmail) {
    console.log('early return - BREVO_API_KEY, BREVO_SENDER vagy toEmail hianyzik');
    return;
  }
  const registerUrl = process.env.APP_URL || 'http://localhost:3000';

  // DB sablon felülírja a hardcoded-ot, ha be van állítva
  let html, subject;
  const tpl = await getEmailTemplate('email_sys_invite');
  if (tpl && tpl.subject && (tpl.body_ro || tpl.body_hu)) {
    const bodyText = tpl.body_ro || tpl.body_hu;
    const inviteHref = escHtml(registerUrl + '/register?kod=' + encodeURIComponent(kod || '')).replace(/"/g, '%22');
    const vars    = { nev: meghivottNev || '', ceg_nev: cegNev || '', pozicio: pozicio || '', register_url: registerUrl + '/register' };
    const rawVars = {
      invite_url_btn: `<a href="${inviteHref}" style="display:inline-block;background:#f6711e;color:#fff;text-decoration:none;font-weight:700;padding:14px 32px;border-radius:10px;font-size:15px;">Înregistrare</a>`,
      invite_url_link: `<a href="${inviteHref}" style="color:#f6517b;word-break:break-all;">${escHtml(registerUrl + '/register')}</a>`,
    };
    subject = applyTemplateVars(tpl.subject, vars, rawVars);
    html = applyTemplateVars(bodyText, vars, rawVars);
  } else {
    html = buildInviteHtml({ kod, pozicio, cegNev, meghivottNev, registerUrl });
    subject = `VallorSoft — Invitație (${cegNev || 'VallorSoft'})`;
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
      _logMail(companyId, toEmail, subject, 'invite', 'failed', null);
    } else {
      console.log('Email elkulve, messageId:', data.messageId);
      _logMail(companyId, toEmail, subject, 'invite', 'sent', data.messageId);
    }
  } catch (err) {
    console.error('Email kuldesi hiba:', err.message);
    _logMail(companyId, toEmail, subject, 'invite', 'failed', null);
  }
}

// ============ JELSZO-VISSZAALLITO EMAIL ============
// companyId (opcionális, additív): ha megadott, a kiküldés a mail_log-ba kerül.
async function sendResetEmail(toEmail, nume, resetUrl, lang, companyId) {
  console.log('sendResetEmail called:', toEmail, !!BREVO_API_KEY);
  if (!BREVO_API_KEY || !BREVO_SENDER || !toEmail) {
    console.log('early return - BREVO config vagy toEmail hianyzik');
    return false; // nincs e-mail-konfig → a hívó kecsesen kezeli (emailed:false)
  }
  const L = 'ro';

  // DB sablon ellenőrzés — ha van, azt küldjük
  const tpl = await getEmailTemplate('email_sys_reset');
  if (tpl && tpl.subject && (tpl.body_ro || tpl.body_hu)) {
    const bodyText = tpl.body_ro || tpl.body_hu;
    const safeUrl  = (resetUrl || '').replace(/"/g, '%22');
    const vars    = { nev: escHtml(nume || ''), reset_url: resetUrl || '' };
    const rawVars = {
      reset_url_btn:  `<a href="${safeUrl}" style="display:inline-block;background:#f6711e;color:#fff;text-decoration:none;font-weight:700;padding:14px 32px;border-radius:10px;font-size:15px;">Setează parolă nouă</a>`,
      reset_url_link: `<a href="${safeUrl}" style="color:#f6517b;word-break:break-all;">${escHtml(resetUrl || '')}</a>`,
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
      if (!resp.ok) { console.error('Reset email (tpl) Brevo hiba:', resp.status, JSON.stringify(data)); _logMail(companyId, toEmail, subject, 'reset', 'failed', null); return false; }
      console.log('Reset email (tpl) elküldve, messageId:', data.messageId);
      _logMail(companyId, toEmail, subject, 'reset', 'sent', data.messageId);
      return true;
    } catch (err) {
      console.error('Reset email (tpl) hiba:', err.message);
      _logMail(companyId, toEmail, subject, 'reset', 'failed', null);
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
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#1e1812;color:#faf6f0;padding:32px;border-radius:16px;">
          <div style="font-size:24px;font-weight:800;margin-bottom:4px;">
            <span style="color:#fff;">vallor</span><span style="color:#f6711e;">Soft</span>
          </div>
          <div style="font-size:12px;color:#fdba74;margin-bottom:28px;">${S.platform}</div>
          <h2 style="font-size:20px;margin-bottom:8px;">${S.greet}</h2>
          <p style="color:#e7d8c6;margin-bottom:16px;">${S.intro}</p>
          <div style="text-align:center;margin:28px 0;">
            <a href="${resetUrl}" style="display:inline-block;background:#f6711e;color:#fff;text-decoration:none;font-weight:700;padding:14px 32px;border-radius:10px;font-size:15px;">${S.btn}</a>
          </div>
          <p style="color:#e7d8c6;font-size:13px;margin-bottom:8px;">${S.or}</p>
          <p style="word-break:break-all;font-size:12px;color:#f6517b;margin-bottom:24px;">${resetUrl}</p>
          <div style="background:#271f18;border:1px solid rgba(253,186,116,0.18);border-radius:12px;padding:16px;margin-bottom:24px;">
            <p style="font-size:12px;color:#e7d8c6;margin:0;">${S.valid}</p>
          </div>
          <p style="font-size:11px;color:#b09a82;margin:0;">${S.footer}</p>
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
        subject: 'VallorSoft — Resetare parolă',
        htmlContent: html,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error('Reset email Brevo hiba:', resp.status, JSON.stringify(data));
      _logMail(companyId, toEmail, 'VallorSoft — Resetare parolă', 'reset', 'failed', null);
      return false; // Brevo elutasította → nem ment ki e-mail
    }
    console.log('Reset email elkulve, messageId:', data.messageId);
    _logMail(companyId, toEmail, 'VallorSoft — Resetare parolă', 'reset', 'sent', data.messageId);
    return true; // sikeres kiküldés
  } catch (err) {
    console.error('Reset email hiba:', err.message);
    _logMail(companyId, toEmail, 'VallorSoft — Resetare parolă', 'reset', 'failed', null);
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
    : `<div style="font-size:24px;font-weight:800;margin-bottom:16px;"><span style="color:#2a2018;">vallor</span><span style="color:#f6711e;">Soft</span></div>`;
  const bodyHtml = (opts.html || '').trim();
  const html =
    `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#2a2018;padding:24px;">` +
      header +
      `<div style="font-size:14px;line-height:1.6;color:#2a2018;white-space:normal;">${bodyHtml}</div>` +
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
  // opts.companyId (opcionális): ha megadott, a kiküldés a mail_log-ba kerül.
  const cid = opts.companyId;
  const mtype = opts.mailType || 'client';
  try {
    const resp = await fetchT('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) { _logMail(cid, opts.to, payload.subject, mtype, 'failed', null); return { ok: false, error: 'Brevo hiba (' + resp.status + '): ' + JSON.stringify(data).slice(0, 200) }; }
    _logMail(cid, opts.to, payload.subject, mtype, 'sent', data.messageId);
    return { ok: true, messageId: data.messageId };
  } catch (err) { _logMail(cid, opts.to, payload.subject, mtype, 'failed', null); return { ok: false, error: err.message }; }
}

// Developer által küldött sablonalapú email — VallorSoft branding wrapperrel
// companyId (opcionális, additív): ha megadott, a kiküldés a mail_log-ba kerül.
async function sendDeveloperEmail(toEmail, companyName, subject, htmlBody, companyId) {
  if (!BREVO_API_KEY || !BREVO_SENDER || !toEmail) {
    return { ok: false, error: 'BREVO_API_KEY / BREVO_SENDER nu este configurat.' };
  }
  const loginLink = (process.env.APP_URL || 'http://localhost:3000') + '/login';
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;background:#1e1812;color:#faf6f0;padding:24px;border-radius:16px;">
      <div style="font-size:24px;font-weight:800;margin-bottom:4px;">
        <span style="color:#fff;">Vallor</span><span style="color:#f6711e;">Soft</span>
      </div>
      <div style="font-size:12px;color:#fdba74;margin-bottom:24px;">Platformă de management transport</div>
      <div style="color:#faf6f0;font-size:14px;line-height:1.7;">${htmlBody}</div>
      <hr style="border:none;border-top:1px solid rgba(253,186,116,0.16);margin:24px 0;">
      <p style="font-size:11px;color:#b09a82;line-height:1.5;margin:0;">
        Acest e-mail a fost trimis automat de sistemul VallorSoft.<br>
        Autentificare: <a href="${escHtml(loginLink)}" style="color:#f6711e;">${escHtml(loginLink)}</a>
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
      _logMail(companyId, toEmail, subject, 'developer', 'failed', null);
      return { ok: false, error: 'Brevo error: ' + err.slice(0, 120) };
    }
    _logMail(companyId, toEmail, subject, 'developer', 'sent', null);
    return { ok: true };
  } catch (e) {
    _logMail(companyId, toEmail, subject, 'developer', 'failed', null);
    return { ok: false, error: e.message };
  }
}

// ============ CÉG SAJÁT FELADÓ-FIÓK (SMTP és/vagy cégenkénti Brevo) ============
// A kimenő ügyfél-/alvállalkozói leveleket a CÉG saját feladó-fiókjáról küldi,
// NEM a közös VallorSoft/Brevo címről. Tárolás: company_integrations
// (provider='email_sender'), credentials_enc = AES-256-GCM titkosított JSON:
//   { prefer:'smtp'|'brevo', from_name, from_email,
//     host, port, secure, user, pass,   // SMTP (nodemailer)
//     brevo_api_key }                    // cégenkénti Brevo (HTTP)
// SMTP elsőbbség (ha a tárhely engedi a kimenő kapcsolatot); ha a kapcsolat nem
// áll össze (pl. Render ingyenes csomag tiltja az 587/465-öt) ÉS van cég-Brevo,
// arra esik vissza — ez a felhasználó által választott "SMTP + Brevo fallback".

// A cég feladó-konfigjának betöltése + visszafejtése. null, ha nincs beállítva.
async function loadCompanySender(companyId) {
  if (!companyId) return null;
  try {
    const r = await getPool().query(
      `SELECT credentials_enc FROM company_integrations
        WHERE company_id=$1 AND provider='email_sender' AND enabled=true`, [companyId]);
    if (!r.rows.length || !r.rows[0].credentials_enc) return null;
    const { decrypt } = require('../lib/crypto');
    return JSON.parse(decrypt(r.rows[0].credentials_enc));
  } catch (_) { return null; }
}

function _smtpTransport(cfg) {
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport({
    host: cfg.host,
    port: parseInt(cfg.port, 10) || 587,
    secure: !!cfg.secure,           // true = 465 (implicit TLS), false = 587 (STARTTLS)
    auth: { user: cfg.user, pass: cfg.pass || '' },
    connectionTimeout: 15000, greetingTimeout: 12000, socketTimeout: 20000,
  });
}

async function _brevoSendCompany(cfg, opts) {
  const fromEmail = cfg.from_email || cfg.user;
  const payload = {
    sender: { name: opts.senderName || cfg.from_name || fromEmail, email: fromEmail },
    to: [{ email: opts.to }],
    subject: opts.subject || '(fără subiect)',
    htmlContent: opts.html || '',
  };
  if (opts.replyTo) payload.replyTo = { email: opts.replyTo };
  const resp = await fetchT('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': cfg.brevo_api_key, 'Content-Type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) return { ok: false, error: 'Brevo (' + resp.status + '): ' + JSON.stringify(data).slice(0, 160) };
  return { ok: true, messageId: data.messageId };
}

// Batch-mailer: EGYSZER feloldja a feladási módot (SMTP-verify → szükség esetén
// cég-Brevo fallback), majd a .send()-del küld minden címzettre + mail_log naplóz.
// Visszatérés: { ok, noConfig?, error?, method, from, send(opts) } — vagy hiba.
async function getCompanyMailer(companyId) {
  const cfg = await loadCompanySender(companyId);
  if (!cfg) return { ok: false, noConfig: true, error: 'Niciun cont expeditor configurat.' };
  const smtpOk = !!(cfg.host && cfg.user && cfg.pass);
  const brevoOk = !!(cfg.brevo_api_key && (cfg.from_email || cfg.user));
  if (!smtpOk && !brevoOk) return { ok: false, noConfig: true, error: 'Cont expeditor incomplet.' };

  const prefer = cfg.prefer === 'brevo' ? 'brevo' : 'smtp';
  let method = null, transport = null;

  const trySmtp = async () => {
    const t = _smtpTransport(cfg);
    try { await t.verify(); method = 'smtp'; transport = t; return true; }
    catch (e) {
      if (brevoOk) { method = 'brevo'; return true; }
      return { ok: false, error: 'SMTP: ' + (e.message || 'eroare de conexiune') };
    }
  };

  if (prefer === 'brevo' && brevoOk) { method = 'brevo'; }
  else if (smtpOk) { const r = await trySmtp(); if (r !== true) return r; }
  else { method = 'brevo'; }

  const fromEmail = cfg.from_email || cfg.user;
  const fromName = cfg.from_name || fromEmail;

  async function send(opts) {
    const cid = companyId;
    const mtype = opts.mailType || 'builder';
    const subject = opts.subject || '(fără subiect)';
    try {
      if (method === 'smtp') {
        const info = await transport.sendMail({
          from: fromName ? '"' + String(fromName).replace(/"/g, '') + '" <' + fromEmail + '>' : fromEmail,
          to: opts.to,
          subject: subject,
          html: opts.html || '',
          replyTo: opts.replyTo || undefined,
        });
        _logMail(cid, opts.to, subject, mtype, 'sent', info && info.messageId);
        return { ok: true, messageId: info && info.messageId };
      }
      const r = await _brevoSendCompany(cfg, { to: opts.to, subject: subject, html: opts.html, senderName: fromName, replyTo: opts.replyTo });
      _logMail(cid, opts.to, subject, mtype, r.ok ? 'sent' : 'failed', r.messageId || null);
      return r;
    } catch (err) {
      _logMail(cid, opts.to, subject, mtype, 'failed', null);
      return { ok: false, error: err.message };
    }
  }

  return { ok: true, method: method, from: fromEmail, send: send };
}

module.exports = { sendInviteEmail, sendResetEmail, sendClientEmail, buildInviteHtml, sendDeveloperEmail, getEmailTemplate, loadCompanySender, getCompanyMailer };
