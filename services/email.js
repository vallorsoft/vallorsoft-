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
  const html = buildInviteHtml({ kod, pozicio, cegNev, meghivottNev, registerUrl, lang: L });
  const subject = (L === 'hu' ? 'VallorSoft — Meghívó' : 'VallorSoft — Invitație') + ` (${cegNev || 'VallorSoft'})`;
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

module.exports = { sendInviteEmail, sendResetEmail, sendClientEmail, buildInviteHtml };
