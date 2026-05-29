require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first'); // Render IPv6 -> IPv4 fix (ENETUNREACH)

// Gmail SMTP - App Password szukseges (nem a sima Gmail jelszo!)
// Gmail fiok -> Biztonsag -> 2 lepeses hitelesites -> Alkalmazasjelszavak -> "VallorSoft"
// Render env: MAIL_USER=te@gmail.com  MAIL_PASS=xxxx xxxx xxxx xxxx
const mailTransporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // STARTTLS
  family: 4,     // IPv4 (backup a dns fix mellett)
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

console.log('MAIL ready:', !!process.env.MAIL_USER, !!process.env.MAIL_PASS);

async function sendInviteEmail(toEmail, kod, pozicio, cegNev, igazgatoNev) {
  console.log('sendInviteEmail called:', toEmail, !!process.env.MAIL_USER);
  if (!process.env.MAIL_USER || !process.env.MAIL_PASS || !toEmail) {
    console.log('early return - MAIL_USER, MAIL_PASS vagy toEmail hianyzik');
    return;
  }
  const registerUrl = process.env.APP_URL || 'http://localhost:3000';
  const udvozles = igazgatoNev ? `Tisztelt ${igazgatoNev}!` : 'Tisztelt Partnerünk!';
  try {
    const info = await mailTransporter.sendMail({
      from: `"VallorSoft" <${process.env.MAIL_USER}>`,
      to: toEmail,
      subject: `VallorSoft — Meghívó (${cegNev || 'VallorSoft'})`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#05070b;color:#e9eef5;padding:32px;border-radius:16px;">
          <div style="font-size:24px;font-weight:800;margin-bottom:4px;">
            <span style="color:#fff;">vallor</span><span style="color:#e10b1a;">Soft</span>
          </div>
          <div style="font-size:12px;color:#8a97a8;margin-bottom:28px;">Fuvarmenedzsment Platform</div>
          <h2 style="font-size:20px;margin-bottom:8px;">${udvozles}</h2>
          <p style="color:#8a97a8;margin-bottom:16px;">
            A <b style="color:#fff;">VallorSoft</b> cégtől kapta ezt az emailt, előfizetésére vonatkozó meghívóval.
          </p>
          <p style="color:#8a97a8;margin-bottom:24px;">
            ${cegNev ? `A <b style="color:#fff;">${cegNev}</b> cég számára` : 'Az Ön számára'} aktiválva lett a VallorSoft platform hozzáférés <b style="color:#fff;">${pozicio}</b> szerepkörben.
          </p>
          <div style="background:#141c25;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:20px;margin-bottom:24px;text-align:center;">
            <div style="font-size:12px;color:#8a97a8;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px;">Meghívókódja</div>
            <div style="font-size:32px;font-weight:800;letter-spacing:4px;color:#fff;">${kod}</div>
          </div>
          <div style="background:#141c25;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:20px;margin-bottom:24px;">
            <div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:12px;">📋 Regisztráció lépései:</div>
            <ol style="color:#8a97a8;font-size:13px;line-height:1.8;padding-left:20px;margin:0;">
              <li>Nyissa meg: <a href="${registerUrl}/register" style="color:#3b82f6;">${registerUrl}/register</a></li>
              <li>Adja meg a nevét, email címét és egy jelszót</li>
              <li>A meghívókód mezőbe írja be: <b style="color:#fff;">${kod}</b></li>
              <li>Kattintson a <b style="color:#fff;">Regisztráció</b> gombra</li>
              <li>Ezután bejelentkezhet a <a href="${registerUrl}/login" style="color:#3b82f6;">${registerUrl}/login</a> oldalon</li>
            </ol>
          </div>
          <p style="font-size:11px;color:#8a97a8;margin:0;">Ez az email automatikusan lett elküldve a VallorSoft rendszer által. Ha nem várta ezt az üzenetet, kérjük hagyja figyelmen kívül.</p>
        </div>
      `,
    });
    console.log('Email elkulve:', info.messageId);
  } catch (err) {
    console.error('Email kuldesi hiba:', err.message, err.code);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// Adatbazis kapcsolat (a .env-bol)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

app.set('trust proxy', 1); // Render / reverse proxy mogotti HTTPS session fix
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Cookie es session kezeles
app.use(cookieParser());

app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'session',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 nap
  },
}));

// Middleware: csak bejelentkezett user-t enged tovabb
function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ success: false, message: 'Nincs bejelentkezve' });
  }
  next();
}

// Middleware: csak adott szerepkort enged tovabb
function requireRole(...roles) {
  return function(req, res, next) {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ success: false, message: 'Nincs bejelentkezve' });
    }
    if (!roles.includes(req.session.user.pozicio)) {
      return res.status(403).json({ success: false, message: 'Nincs jogosultsag' });
    }
    next();
  };
}

const getNowStr = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

// Firebase konfig endpoint — a frontend olvassa be (public config, nem titkos)
app.get('/api/firebase-config', requireLogin, (req, res) => {
  res.json({
    apiKey:        process.env.FIREBASE_API_KEY        || null,
    authDomain:    process.env.FIREBASE_AUTH_DOMAIN    || null,
    databaseURL:   process.env.FIREBASE_DB_URL         || null,
    projectId:     process.env.FIREBASE_PROJECT_ID     || null,
    appId:         process.env.FIREBASE_APP_ID         || null,
  });
});



// HTML oldalak
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/developer', (req, res) => res.sendFile(path.join(__dirname, 'public', 'developer.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/manager', (req, res) => res.sendFile(path.join(__dirname, 'public', 'manager.html')));
app.get('/sofer', (req, res) => res.sendFile(path.join(__dirname, 'public', 'sofer.html')));

// LOGIN (DB-bol, bcrypt-tel, session-nel)
app.post('/api/login', async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    if (!email || !password) {
      return res.json({ success: false, message: 'Email es jelszo kotelezo!' });
    }

    const result = await pool.query(
      'SELECT id, nume, email, tel, pozicio, password_hash, company_id, pozicio_dev FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.json({ success: false, message: 'Hibas email vagy jelszo!' });
    }

    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.json({ success: false, message: 'Hibas email vagy jelszo!' });
    }

    // Ceg ellenorzese (ha nem developer)
    if (!user.pozicio_dev && user.company_id) {
      const ceg = await pool.query('SELECT subscription_status, paid_until FROM companies WHERE id = $1', [user.company_id]);
      if (ceg.rows.length > 0) {
        const c = ceg.rows[0];
        if (c.subscription_status === 'inactive' || c.subscription_status === 'cancelled') {
          return res.json({ success: false, message: 'A cég előfizetése lejárt vagy törölve lett. Kérjük vegye fel a kapcsolatot az adminisztrátorral.' });
        }
        if (c.paid_until && new Date(c.paid_until) < new Date()) {
          return res.json({ success: false, message: 'A cég előfizetése lejárt (' + new Date(c.paid_until).toLocaleDateString('hu-HU') + '). Kérjük fizesse meg a következő időszakot.' });
        }
      }
    }

    req.session.user = {
      id: user.id,
      nume: user.nume,
      email: user.email,
      tel: user.tel,
      pozicio: user.pozicio,
      company_id: user.company_id,
      is_dev: user.pozicio_dev || false,
    };

    let redirect = '/sofer';
    if (user.pozicio_dev) redirect = '/developer';
    else if (user.pozicio === 'Admin') redirect = '/admin';
    else if (user.pozicio === 'Manager') redirect = '/manager';

    return res.json({
      success: true,
      redirect: redirect,
      user: req.session.user,
    });

  } catch (err) {
    console.error('Login hiba:', err);
    return res.status(500).json({ success: false, message: 'Szerver hiba' });
  }
});

// SOFER FUNKCIOK (DB-alapu)
app.post('/api/border-cross', async (req, res) => {
  try {
    if (!req.session.user) return res.json({ success: false, err: 'Nincs bejelentkezve' });
    const { tip, tara, locatie, gps_lat, gps_lng } = req.body;
    await pool.query(
      `INSERT INTO border_crossings (email_sofer, nume_sofer, tip, tara, locatie, gps_lat, gps_lng)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        req.session.user.email,
        req.session.user.nume,
        tip || 'Iesire',
        tara || null,
        locatie || null,
        gps_lat ? parseFloat(gps_lat) : null,
        gps_lng ? parseFloat(gps_lng) : null
      ]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('border-cross hiba:', err);
    res.json({ success: false, err: 'Szerver hiba' });
  }
});

app.post('/api/fuvarlevel-save', async (req, res) => {
  try {
    if (!req.session.user) return res.json({ success: false, err: 'Nincs bejelentkezve' });
    const d = req.body;
    const randId = Math.floor(1000 + Math.random() * 9000);
    const soferNameClean = req.session.user.nume.replace(/\s+/g, '_');
    const id = "FUV-" + randId;
    const fileName = `Menetlevel_${soferNameClean}_${randId}.pdf`;

    const totalKm = Math.max(0, Number(d.kmSfarsit || 0) - Number(d.kmInceput || 0));
    let totalAlim = 0;
    const alimentari = Array.isArray(d.alimentari) ? d.alimentari : [];
    alimentari.forEach(a => { totalAlim += Number(a.litru || 0); });
    const cantInc = Number(d.cantInceput || 0);
    const cantSf = Number(d.cantSfarsit || 0);
    const motorinaFolosit = Math.max(0, cantInc + totalAlim - cantSf);
    const consum100 = totalKm > 0 ? Math.round((motorinaFolosit / totalKm * 100) * 100) / 100 : 0;

    const puncte = Array.isArray(d.puncte) ? d.puncte : [];
    const orderIds = Array.isArray(d.orderIds) ? d.orderIds : [];

    await pool.query(
      `INSERT INTO fuvarlevelek (
        id, file_name, email_sofer, nume_sofer,
        numar_camion, numar_remorca, numar_fisa, cursa_saptamanii,
        km_inceput, km_sfarsit, total_km,
        loc_plecare, loc_sosire, loc_desc_tur, loc_inc_retur,
        diurna_externa, diurna_interna,
        cant_inceput, cant_sfarsit, motorina_folosit, total_alim, consum_100,
        alte_mentiuni, alimentari, achizitii, tranzite, puncte, order_ids
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)`,
      [
        id, fileName, req.session.user.email, req.session.user.nume,
        d.numarCamion || null, d.numarRemorca || null, d.numarFisa || null, d.cursaSaptamanii || null,
        Number(d.kmInceput || 0), Number(d.kmSfarsit || 0), totalKm,
        d.locPlecare || null, d.locSosire || null, d.locDescTUR || null, d.locIncRETUR || null,
        parseInt(d.diurnaExterna || 0), parseInt(d.diurnaInterna || 0),
        cantInc, cantSf, motorinaFolosit, totalAlim, consum100,
        d.alteMentiuni || null,
        JSON.stringify(alimentari),
        JSON.stringify(Array.isArray(d.achizitii) ? d.achizitii : []),
        JSON.stringify(Array.isArray(d.tranzite) ? d.tranzite : []),
        JSON.stringify(puncte),
        JSON.stringify(orderIds)
      ]
    );
    res.json({ success: true, id });
  } catch (err) {
    console.error('fuvarlevel-save hiba:', err);
    res.json({ success: false, err: 'Szerver hiba' });
  }
});

app.post('/api/doc-upload', async (req, res) => {
  try {
    if (!req.session.user) return res.json({ success: false, err: 'Nincs bejelentkezve' });
    const { numeFisier, base64, tip } = req.body;
    await pool.query(
      `INSERT INTO documents (email_sofer, nume_sofer, tip, file_name, storage_url)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.session.user.email,
        req.session.user.nume,
        tip || 'CMR',
        numeFisier || 'dokument',
        base64 || null
      ]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('doc-upload hiba:', err);
    res.json({ success: false, err: 'Szerver hiba' });
  }
});

// PDF DOWNLOAD (DB-bol)
app.get('/api/pdf-download/:id', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM fuvarlevelek WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).send('Nem található.');
    const f = r.rows[0];

    const alimentari = Array.isArray(f.alimentari) ? f.alimentari : [];
    const achizitii  = Array.isArray(f.achizitii)  ? f.achizitii  : [];
    const puncte     = Array.isArray(f.puncte)      ? f.puncte     : [];
    const orderIds   = Array.isArray(f.order_ids)   ? f.order_ids  : [];

    // Útvonal pontok HTML
    let puncteHtml = '';
    if (puncte.length > 0) {
      puncte.forEach((p, i) => {
        puncteHtml += `<tr><td>${i+1}.</td><td>${p.tip || '—'}</td><td>${p.loc || '—'}</td><td>${p.data || '—'}</td></tr>`;
      });
    } else {
      // Ha nincs puncte, a régi loc_plecare/loc_sosire mutatjuk
      if (f.loc_plecare) puncteHtml += `<tr><td>1.</td><td>Plecare</td><td>${f.loc_plecare}</td><td>—</td></tr>`;
      if (f.loc_sosire)  puncteHtml += `<tr><td>2.</td><td>Sosire</td><td>${f.loc_sosire}</td><td>—</td></tr>`;
      if (!puncteHtml)   puncteHtml  = '<tr><td colspan="4">—</td></tr>';
    }

    // Tankolások HTML
    let alimHtml = '';
    if (alimentari.length > 0) {
      alimentari.forEach((a, i) => {
        alimHtml += `<tr>
          <td>${i+1}. ${a.loc || '—'}</td>
          <td>${a.tip || 'Motorină'}</td>
          <td>${a.litru || 0} L</td>
          <td>${a.km || 0} km</td>
          <td>${a.plata || '—'}</td>
          <td>${a.suma ? a.suma + ' RON' : '—'}</td>
        </tr>`;
      });
    } else {
      alimHtml = '<tr><td colspan="6">Nem lett rögzítve tankolás.</td></tr>';
    }

    // Kiadások HTML
    let achHtml = '';
    if (achizitii.length > 0) {
      achizitii.forEach((ach, i) => {
        achHtml += `<tr>
          <td>${i+1}. ${ach.loc || '—'}</td>
          <td>${ach.produs || '—'}</td>
          <td>${ach.pret || 0} RON</td>
          <td>${ach.plata || '—'}</td>
        </tr>`;
      });
    } else {
      achHtml = '<tr><td colspan="4">Nem lett rögzítve kiadás.</td></tr>';
    }

    // Fuvar ID-k
    const orderIdsStr = orderIds.length ? orderIds.join(', ') : '—';

    res.send(`
  <html>
  <head>
    <title>${f.file_name}</title>
    <meta charset="UTF-8">
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; line-height: 1.5; color:#000; font-size:13px; }
      .header-box { text-align:center; font-weight:bold; font-size:17px; border-bottom:2px solid #000; padding-bottom:10px; margin-bottom:18px; }
      .grid-table { width:100%; border-collapse:collapse; margin-bottom:14px; }
      .grid-table td { border:1px solid #000; padding:5px 7px; vertical-align:top; }
      .grid-table th { border:1px solid #000; padding:5px 7px; background:#e8e8e8; font-weight:bold; text-align:left; }
      .sec-title { font-weight:bold; background:#d0d0d0; text-transform:uppercase; padding:5px 7px; border:1px solid #000; margin-top:14px; margin-bottom:0; font-size:12px; letter-spacing:.5px; }
      @media print { .no-print { display:none; } body { padding:10px; } }
    </style>
  </head>
  <body>
    <div class="no-print" style="margin-bottom:16px;">
      <button onclick="window.print()" style="padding:10px 24px;background:#000;color:#fff;font-weight:bold;cursor:pointer;border:none;border-radius:4px;font-size:14px;">🖨️ Nyomtatás / PDF mentés</button>
    </div>
    <div class="header-box">VALLOR TEAM SRL<br><span style="font-size:14px;">FIȘĂ DE CURSĂ SĂPTĂMÂNALĂ</span></div>

    <table class="grid-table">
      <tr><td width="50%"><b>Nume șofer:</b> ${f.nume_sofer || '—'}</td><td><b>Număr fișă:</b> ${f.numar_fisa || '—'}</td></tr>
      <tr><td><b>Număr camion:</b> ${f.numar_camion || '—'}</td><td><b>Număr remorcă:</b> ${f.numar_remorca || '—'}</td></tr>
      <tr><td><b>Cursa săptămânii:</b> ${f.cursa_saptamanii || '—'}</td><td><b>Fuvar ID-k:</b> ${orderIdsStr}</td></tr>
      <tr><td><b>Km început:</b> ${f.km_inceput || 0} km</td><td><b>Km sfârșit:</b> ${f.km_sfarsit || 0} km</td></tr>
      <tr><td colspan="2"><b>Total kilometri parcurși: ${f.total_km || 0} km</b></td></tr>
      <tr><td><b>Diurnă externă:</b> ${f.diurna_externa || 0} nap</td><td><b>Diurnă internă:</b> ${f.diurna_interna || 0} nap</td></tr>
    </table>

    <div class="sec-title">Puncte de traseu (Útvonal pontok)</div>
    <table class="grid-table">
      <tr><th>#</th><th>Tip</th><th>Localitate / Adresă</th><th>Dată</th></tr>
      ${puncteHtml}
    </table>

    <div class="sec-title">Alimentări (Tankolások)</div>
    <table class="grid-table">
      <tr><th>Loc & Data</th><th>Combustibil</th><th>Litri</th><th>Km</th><th>Plată</th><th>Sumă</th></tr>
      ${alimHtml}
    </table>

    <div class="sec-title">Calcul consum combustibil</div>
    <table class="grid-table">
      <tr><td><b>Cantitate început:</b> ${f.cant_inceput || 0} L</td><td><b>Cantitate sfârșit:</b> ${f.cant_sfarsit || 0} L</td></tr>
      <tr><td><b>Total alimentări:</b> ${f.total_alim || 0} L</td><td><b>Motorină folosită:</b> ${f.motorina_folosit || 0} L</td></tr>
      <tr><td colspan="2"><b>Consum mediu / 100 km: ${f.consum_100 || 0} L</b></td></tr>
    </table>

    <div class="sec-title">Achiziții / Cheltuieli (Kiadások)</div>
    <table class="grid-table">
      <tr><th>Loc & Data</th><th>Produs / Serviciu</th><th>Preț</th><th>Metodă plată</th></tr>
      ${achHtml}
    </table>

    <div class="sec-title">Alte mențiuni (Megjegyzések)</div>
    <div style="border:1px solid #000;padding:10px;min-height:40px;">${f.alte_mentiuni || '—'}</div>

    <div style="margin-top:30px;display:flex;justify-content:space-between;">
      <div style="text-align:center;"><div style="border-top:1px solid #000;width:180px;margin:0 auto;padding-top:4px;">Semnătura șofer</div></div>
      <div style="text-align:center;"><div style="border-top:1px solid #000;width:180px;margin:0 auto;padding-top:4px;">Semnătura dispecer</div></div>
    </div>
  </body>
  </html>`);
  } catch (err) {
    console.error('pdf-download hiba:', err);
    res.status(500).send('Szerver hiba');
  }
});



// GENERIKUS DISPATCHER (regi GAS-szeru hivasok)
app.post('/api/execute', async (req, res) => {
  const { functionName, arguments: args } = req.body;

  // AUTH ME (session-bol)
  if (functionName === 'authMe') {
    return res.json({ result: req.session.user || null });
  }

  // LOGOUT
  if (functionName === 'authLogout') {
    req.session.destroy(function(err) {
      if (err) {
        return res.json({ result: { ok: false, err: 'Logout hiba' } });
      }
      res.clearCookie('connect.sid');
      return res.json({ result: { ok: true } });
    });
    return;
  }

  // REGISZTRACIO MEGHIVOKODDAL (DB-bol)
  if (functionName === 'authRegister') {
    try {
      const p = args[0] || {};
      const nume = String(p.nume || '').trim();
      const email = String(p.email || '').trim().toLowerCase();
      const tel = String(p.tel || '').trim();
      const jelszo = String(p.jelszo || '');
      const kod = String(p.kod || '').trim().toUpperCase();

      if (!nume || !email || !jelszo || !kod) {
        return res.json({ result: { ok: false, err: 'Minden mezo kotelezo.' } });
      }
      if (jelszo.length < 6) {
        return res.json({ result: { ok: false, err: 'A jelszo legalabb 6 karakter legyen.' } });
      }

      const invResult = await pool.query(
        'SELECT id, pozicio, email, status, company_id FROM invites WHERE kod = $1',
        [kod]
      );

      if (invResult.rows.length === 0) {
        return res.json({ result: { ok: false, err: 'Ismeretlen meghivokod.' } });
      }

      const invite = invResult.rows[0];

      if (invite.status && invite.status.toLowerCase().startsWith('felhaszn')) {
        return res.json({ result: { ok: false, err: 'Ezt a meghivokodot mar felhasznaltak.' } });
      }
      if (invite.email && invite.email.toLowerCase() !== email) {
        return res.json({ result: { ok: false, err: 'A meghivo nem ehhez az email-cimhez tartozik.' } });
      }

      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        return res.json({ result: { ok: false, err: 'Ez az email mar regisztralt.' } });
      }

      const passwordHash = await bcrypt.hash(jelszo, 10);
      await pool.query(
        `INSERT INTO users (nume, email, tel, pozicio, password_hash, company_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [nume, email, tel, invite.pozicio, passwordHash, invite.company_id || null]
      );

      await pool.query(
        `UPDATE invites SET status = 'Felhasznalva', used_by = $1 WHERE id = $2`,
        [email, invite.id]
      );

      return res.json({
        result: { ok: true, msg: 'Sikeres regisztracio. Most mar bejelentkezhet.', pozicio: invite.pozicio }
      });

    } catch (err) {
      console.error('Register hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // HATARATLEPESEK LISTAJA (DB)
  if (functionName === 'getBorderLogs') {
    try {
      if (!req.session.user) return res.json({ result: [] });
      const cid = req.session.user.company_id;
      const isAdmin = ['Admin', 'Manager'].includes(req.session.user.pozicio);
      const r = isAdmin
        ? await pool.query('SELECT bc.* FROM border_crossings bc JOIN users u ON u.email = bc.email_sofer WHERE u.company_id = $1 ORDER BY bc.created_at DESC LIMIT 200', [cid])
        : await pool.query('SELECT * FROM border_crossings WHERE email_sofer = $1 ORDER BY created_at DESC', [req.session.user.email]);
      return res.json({ result: r.rows });
    } catch (err) {
      console.error('getBorderLogs hiba:', err);
      return res.json({ result: [] });
    }
  }

  // MENETLEVELEK LISTAJA (DB)
  if (functionName === 'getFuvarlevelek') {
    try {
      if (!req.session.user) return res.json({ result: [] });
      const me = req.session.user;
      const cid = me.company_id;
      const isAdmin = ['Admin', 'Manager'].includes(me.pozicio);
      let r;
      if (isAdmin && cid) {
        // Cég összes sofőrjének menetlevelei — email lista alapján (nem JOIN, megbízhatóbb online)
        const sofors = await pool.query(
          'SELECT email FROM users WHERE company_id = $1 AND pozicio = $2', [cid, 'Sofer']
        );
        const emails = sofors.rows.map(u => u.email);
        if (!emails.length) return res.json({ result: [] });
        r = await pool.query(
          `SELECT id, file_name, email_sofer, nume_sofer, data_completare, total_km, consum_100, order_ids
           FROM fuvarlevelek WHERE email_sofer = ANY($1)
           ORDER BY data_completare DESC LIMIT 200`,
          [emails]
        );
      } else {
        r = await pool.query(
          `SELECT id, file_name, email_sofer, nume_sofer, data_completare, total_km, consum_100, order_ids
           FROM fuvarlevelek WHERE email_sofer = $1
           ORDER BY data_completare DESC`,
          [me.email]
        );
      }
      return res.json({ result: r.rows });
    } catch (err) {
      console.error('getFuvarlevelek hiba:', err);
      return res.json({ result: [] });
    }
  }

  // SOFER DOKUMENTUMOK LISTAJA (DB)
  if (functionName === 'getDriverDocs') {
    try {
      if (!req.session.user) return res.json({ result: [] });
      const cid = req.session.user.company_id;
      const isAdmin = ['Admin', 'Manager'].includes(req.session.user.pozicio);
      const r = isAdmin
        ? await pool.query('SELECT d.id, d.email_sofer, d.nume_sofer, d.tip, d.file_name, d.created_at FROM documents d JOIN users u ON u.email = d.email_sofer WHERE u.company_id = $1 ORDER BY d.created_at DESC LIMIT 200', [cid])
        : await pool.query('SELECT id, email_sofer, nume_sofer, tip, file_name, created_at FROM documents WHERE email_sofer = $1 ORDER BY created_at DESC', [req.session.user.email]);
      return res.json({ result: r.rows });
    } catch (err) {
      console.error('getDriverDocs hiba:', err);
      return res.json({ result: [] });
    }
  }
  if (functionName === 'userListAll') {
    try {
      const cid = req.session.user ? req.session.user.company_id : null;
      const r = cid
        ? await pool.query('SELECT id, nume, email, tel, pozicio FROM users WHERE company_id = $1 ORDER BY id', [cid])
        : await pool.query('SELECT id, nume, email, tel, pozicio FROM users ORDER BY id');
      return res.json({ result: r.rows });
    } catch (e) {
      console.error(e);
      return res.json({ result: [] });
    }
  }
  // MEGHIVOKODOK LISTAJA (DB-bol)
  if (functionName === 'invListAll') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const r = await pool.query(
        `SELECT kod, pozicio, email, status FROM invites WHERE company_id = $1 ORDER BY id DESC`,
        [req.session.user.company_id]
      );
      const list = r.rows.map(row => ({
        kod: row.kod, pozicio: row.pozicio, email: row.email, statusz: row.status,
      }));
      return res.json({ result: list });
    } catch (err) {
      console.error('invListAll hiba:', err);
      return res.json({ result: [] });
    }
  }

  // UJ MEGHIVOKOD GENERALAS (DB-be)
  if (functionName === 'invCreate') {
    try {
      // Admin barmit, Manager csak Sofer meghivot
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }

      const pozicio = String(args[0] || '').trim();

      // 🔒 Manager csak Sofer meghivot kuldhet
      if (req.session.user.pozicio === 'Manager' && pozicio !== 'Sofer') {
        return res.json({ result: { ok: false, err: 'Manager csak Sofer meghivot generalhat.' } });
      }
    
      const email = String(args[1] || '').trim().toLowerCase();

      if (!['Admin', 'Manager', 'Sofer'].includes(pozicio)) {
        return res.json({ result: { ok: false, err: 'Ervenytelen pozicio.' } });
      }

      // veletlen kod generalas - hasonloan a regi _genCode-hoz
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let kod = 'VS-';
      for (let i = 0; i < 6; i++) {
        kod += chars.charAt(Math.floor(Math.random() * chars.length));
      }

      await pool.query(
        `INSERT INTO invites (kod, pozicio, email, status, company_id) VALUES ($1, $2, $3, $4, $5)`,
        [kod, pozicio, email, 'Aktiv', req.session.user.company_id || null]
      );

      // Email kuldese ha van email cim
      if (email) {
        const cegRes = await pool.query('SELECT nev, igazgato_nev FROM companies WHERE id = $1', [req.session.user.company_id]);
        const cegNev = cegRes.rows[0]?.nev || '';
        const igazgatoNev = cegRes.rows[0]?.igazgato_nev || null;
        sendInviteEmail(email, kod, pozicio, cegNev, igazgatoNev)
          .catch(e => console.error('Email hatter hiba:', e.message));
      }

      return res.json({ result: { ok: true, kod: kod } });

    } catch (err) {
      console.error('invCreate hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // MEGHIVOKOD VISSZAVONAS (jovobeli admin funkcioknak)
  if (functionName === 'invRevoke') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const kod = String(args[0] || '').trim().toUpperCase();

      // 🔒 Manager csak Sofer meghivot vonhat vissza
      if (req.session.user.pozicio === 'Manager') {
        const check = await pool.query('SELECT pozicio FROM invites WHERE kod = $1', [kod]);
        if (check.rows.length === 0) {
          return res.json({ result: { ok: false, err: 'Nem talalhato.' } });
        }
        if (check.rows[0].pozicio !== 'Sofer') {
          return res.json({ result: { ok: false, err: 'Manager csak Sofer meghivot vonhat vissza.' } });
        }
      }

      const r = await pool.query(
        `UPDATE invites SET status = 'Visszavonva' WHERE kod = $1`,
        [kod]
      );
      if (r.rowCount === 0) {
        return res.json({ result: { ok: false, err: 'Nem talalhato.' } });
      }
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('invRevoke hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }
  // PECSET / ALAIRAS - felhasznalonkent az adatbazisban (stamps tabla)
  if (functionName === 'stampGet') {
    try {
      if (!req.session.user) return res.json({ result: { ok: false, err: 'Nincs bejelentkezve' } });
      const email = req.session.user.email;
      const r = await pool.query('SELECT base64_png FROM stamps WHERE email = $1', [email]);
      if (r.rows.length && r.rows[0].base64_png) {
        return res.json({ result: { ok: true, base64: r.rows[0].base64_png } });
      }
      return res.json({ result: { ok: true, base64: null } });
    } catch (err) {
      console.error('stampGet hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }
  if (functionName === 'stampSave') {
    try {
      if (!req.session.user) return res.json({ result: { ok: false, err: 'Nincs bejelentkezve' } });
      const email = req.session.user.email;
      const b64 = args[0];
      if (!b64) return res.json({ result: { ok: false, err: 'Hianyzo kep' } });
      await pool.query(
        `INSERT INTO stamps (email, base64_png, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (email)
         DO UPDATE SET base64_png = EXCLUDED.base64_png, updated_at = NOW()`,
        [email, b64]
      );
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('stampSave hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }
  // EGY FUVAR ADATAI + SZAKASZOK (szerkeszto modal)
  if (functionName === 'getOrderById') {
    try {
      if (!req.session.user || !['Admin','Manager'].includes(req.session.user.pozicio))
        return res.json({ result: null, legs: [] });
      const id = String(args[0] || '').trim();
      const cid = req.session.user.company_id;
      const or = await pool.query(
        'SELECT * FROM orders WHERE id = $1 AND company_id = $2',
        [id, cid]
      );
      const order = or.rows[0] || null;
      let legs = [];
      if (order) {
        const lr = await pool.query(
          'SELECT * FROM order_legs WHERE order_id = $1 ORDER BY leg_number',
          [id]
        );
        legs = lr.rows;
      }
      return res.json({ result: order, legs });
    } catch (err) {
      console.error('getOrderById hiba:', err);
      return res.json({ result: null, legs: [] });
    }
  }

  // FUVARFELADATOK LISTAJA (DB-bol)
  if (functionName === 'comList') {
    try {
      if (!req.session.user) return res.json({ result: [] });
      const me = req.session.user;
      const cid = me.company_id;
      let r;
      if (me.pozicio === 'Admin' || me.pozicio === 'Manager') {
        r = await pool.query(
          `SELECT id, client, ref, loc_incarcare, loc_descarcare,
                  pret, km, status, sofer_type, email_sofer, nume_sofer,
                  firma_extern, telefon_extern, rendszam_camion, rendszam_remorca
           FROM orders WHERE company_id = $1 ORDER BY created_at DESC`,
          [cid]
        );
      } else {
        // Sofernek csak a sajat nevere kiosztott fuvarok latszanak
        r = await pool.query(
          `SELECT id, client, ref, loc_incarcare, loc_descarcare,
                  pret, km, status, sofer_type, email_sofer, nume_sofer,
                  firma_extern, telefon_extern, rendszam_camion, rendszam_remorca
           FROM orders
           WHERE company_id = $1 AND LOWER(email_sofer) = LOWER($2)
           ORDER BY created_at DESC`,
          [cid, me.email]
        );
      }
      return res.json({ result: r.rows });
    } catch (err) {
      console.error('comList hiba:', err);
      return res.json({ result: [] });
    }
  }

  // SOFER SAJÁT KIOSZTOTT FUVARJAI (menetlevélhez való kiválasztáshoz)
  if (functionName === 'getMySoferOrders') {
    try {
      if (!req.session.user) return res.json({ result: [] });
      const me = req.session.user;
      const r = await pool.query(
        `SELECT id, client, ref, loc_incarcare, loc_descarcare, km, rendszam_camion, rendszam_remorca, status
         FROM orders
         WHERE company_id = $1 AND LOWER(email_sofer) = LOWER($2)
           AND status IN ('Alocat','In Curs')
         ORDER BY created_at DESC`,
        [me.company_id, me.email]
      );
      return res.json({ result: r.rows });
    } catch (err) {
      console.error('getMySoferOrders hiba:', err);
      return res.json({ result: [] });
    }
  }

 // UJ FUVARFELADAT (Admin/Manager)
  if (functionName === 'comCreate') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }

      const o = args[0] || {};
      const id = "CMD-" + Math.floor(1000 + Math.random() * 9000);
      const client = String(o.client || '').trim();
      const ref = String(o.ref || '').trim();
      const pret = Number(o.pret || 0);
      const km = Number(o.km || 0);
      const loc_incarcare = String(o.loc_incarcare || '').trim();
      const loc_descarcare = String(o.loc_descarcare || '').trim();
      const data_incarcare = o.data_incarcare || null;
      const data_descarcare = o.data_descarcare || null;
      const sofer_type = o.sofer_type || null;
      const email_sofer = o.email_sofer ? String(o.email_sofer).trim().toLowerCase() : null;
      const nume_sofer = o.nume_sofer ? String(o.nume_sofer).trim() : null;
      const firma_extern = o.firma_extern ? String(o.firma_extern).trim() : null;
      const telefon_extern = o.telefon_extern ? String(o.telefon_extern).trim() : null;
      const external_driver_id = o.external_driver_id ? parseInt(o.external_driver_id, 10) : null;
      const rendszam_camion = o.rendszam_camion ? String(o.rendszam_camion).trim().toUpperCase() : null;
      const rendszam_remorca = o.rendszam_remorca ? String(o.rendszam_remorca).trim().toUpperCase() : null;
      const company_id = req.session.user.company_id;

      let status = 'Disponibil';
      if (sofer_type === 'Intern' && email_sofer) status = 'Alocat';
      else if (sofer_type === 'Extern') status = 'Extern';

      await pool.query(
        `INSERT INTO orders (
          id, client, ref, loc_incarcare, loc_descarcare,
          data_incarcare, data_descarcare, pret, km,
          sofer_type, email_sofer, nume_sofer,
          firma_extern, telefon_extern, external_driver_id,
          rendszam_camion, rendszam_remorca, status, company_id
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
        )`,
        [
          id, client, ref, loc_incarcare, loc_descarcare,
          data_incarcare, data_descarcare, pret, km,
          sofer_type, email_sofer, nume_sofer,
          firma_extern, telefon_extern, external_driver_id,
          rendszam_camion, rendszam_remorca, status, company_id
        ]
      );

      await pool.query(
        `INSERT INTO order_legs (
          order_id, leg_number, sofer_type, email_sofer, nume_sofer,
          firma_extern, telefon_extern, external_driver_id,
          rendszam_camion, rendszam_remorca,
          loc_preluare, data_preluare, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          id, 1, sofer_type, email_sofer, nume_sofer,
          firma_extern, telefon_extern, external_driver_id,
          rendszam_camion, rendszam_remorca,
          loc_incarcare, data_incarcare, company_id
        ]
      );

      return res.json({ result: { ok: true, id: id } });
    } catch (err) {
      console.error('comCreate hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // FELHASZNALO ADATOK MODOSITASA (DB-ben)
  if (functionName === 'userUpdate') {
    try {
      // Admin es Manager hivhatja, de a Manager korlatozott (lejjebb)
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }

      const targetEmail = String(args[0] || '').trim().toLowerCase();
      const fields = args[1] || {};

      if (!targetEmail) {
        return res.json({ result: { ok: false, err: 'Email kotelezo.' } });
      }

      // Lekerjuk a cel-felhasznalot a DB-bol
      const targetRes = await pool.query(
        'SELECT id, email, pozicio, company_id FROM users WHERE email = $1',
        [targetEmail]
      );
      if (targetRes.rows.length === 0) {
        return res.json({ result: { ok: false, err: 'Felhasznalo nem talalhato.' } });
      }
      const targetUser = targetRes.rows[0];
      const isSelf = targetEmail === req.session.user.email.toLowerCase();
      const callerRole = req.session.user.pozicio;

      // 🔒 Ceg-szures: csak sajat ceg useret modosithatja
      if (targetUser.company_id !== req.session.user.company_id) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag.' } });
      }

      // 🔒 Manager nem modosithatja Admin vagy mas Manager adatait
      if (callerRole === 'Manager' && !isSelf && targetUser.pozicio !== 'Sofer') {
        return res.json({ result: { ok: false, err: 'Manager csak Sofer adatait modosithatja.' } });
      }

      // 🔒 Admin nem modosithatja mas Admin jelszavat vagy emailjet
      if (callerRole === 'Admin' && !isSelf && targetUser.pozicio === 'Admin') {
        if (fields.jelszo) {
          return res.json({ result: { ok: false, err: 'Admin mas Admin jelszavat nem valtoztathatja.' } });
        }
      }

      // dinamikusan epitjuk az UPDATE-et csak azokra a mezokre, amik vannak
      const updates = [];
      const values = [];
      let i = 1;

      if (fields.nume !== undefined) {
        updates.push(`nume = $${i++}`);
        values.push(fields.nume);
      }
      if (fields.tel !== undefined) {
        updates.push(`tel = $${i++}`);
        values.push(fields.tel);
      }
      if (fields.pozicio !== undefined) {
        if (!['Admin', 'Manager', 'Sofer'].includes(fields.pozicio)) {
          return res.json({ result: { ok: false, err: 'Ervenytelen pozicio.' } });
        }

        // 🔒 1. SZABALY: Admin ne tudja a SAJAT poziciojat megvaltoztatni (lefokozas tiltva)
        if (isSelf && fields.pozicio !== targetUser.pozicio) {
          return res.json({ result: { ok: false, err: 'Sajat poziciodat nem modosithatod.' } });
        }

        // 🔒 3. SZABALY: Manager / Sofer pozicio szerkezeti vedelme
        // - utolso Admin nem fokozhato le (rendszer mindig kell legyen egy Admin)
        if (targetUser.pozicio === 'Admin' && fields.pozicio !== 'Admin') {
          const adminCount = await pool.query(
            "SELECT COUNT(*)::int AS db FROM users WHERE pozicio = 'Admin'"
          );
          if (adminCount.rows[0].db <= 1) {
            return res.json({ result: { ok: false, err: 'Nem maradhat a rendszer Admin nelkul.' } });
          }
        }

        updates.push(`pozicio = $${i++}`);
        values.push(fields.pozicio);
      }
      if (fields.jelszo) {
        const hash = await bcrypt.hash(fields.jelszo, 10);
        updates.push(`password_hash = $${i++}`);
        values.push(hash);
      }

      if (updates.length === 0) {
        return res.json({ result: { ok: false, err: 'Nincs mit modositani.' } });
      }

      values.push(targetEmail);
      const sql = `UPDATE users SET ${updates.join(', ')} WHERE email = $${i}`;
      const r = await pool.query(sql, values);

      if (r.rowCount === 0) {
        return res.json({ result: { ok: false, err: 'Felhasznalo nem talalhato.' } });
      }

      return res.json({ result: { ok: true } });

    } catch (err) {
      console.error('userUpdate hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // FELHASZNALO TORLES (Admin / Manager)
  if (functionName === 'userDelete') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const targetEmail = String(args[0] || '').trim().toLowerCase();
      if (!targetEmail) {
        return res.json({ result: { ok: false, err: 'Email kotelezo.' } });
      }

      // 🔒 2. SZABALY: ne torolhesse sajat magat
      if (targetEmail === req.session.user.email.toLowerCase()) {
        return res.json({ result: { ok: false, err: 'Sajat magadat nem torolheted.' } });
      }

      // 🔒 Lekerjuk a cel-felhasznalo poziciojat es ceg-id-jet
      const targetRes = await pool.query(
        'SELECT pozicio, company_id FROM users WHERE email = $1',
        [targetEmail]
      );
      if (targetRes.rows.length === 0) {
        return res.json({ result: { ok: false, err: 'Felhasznalo nem talalhato.' } });
      }

      // 🔒 Csak sajat ceg useret torolheti
      if (targetRes.rows[0].company_id !== req.session.user.company_id) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag.' } });
      }

      // 🔒 Manager csak Sofer felhasznalot torolhet
      if (req.session.user.pozicio === 'Manager' && targetRes.rows[0].pozicio !== 'Sofer') {
        return res.json({ result: { ok: false, err: 'Manager csak Sofer felhasznalot torolhet.' } });
      }

      // 🔒 KIEGESZITES: utolso Admin torlese sem engedett
      if (targetRes.rows[0].pozicio === 'Admin') {
        const adminCount = await pool.query(
          "SELECT COUNT(*)::int AS db FROM users WHERE pozicio = 'Admin'"
        );
        if (adminCount.rows[0].db <= 1) {
          return res.json({ result: { ok: false, err: 'Az utolso Admin nem torolheto.' } });
        }
      }

      const r = await pool.query('DELETE FROM users WHERE email = $1', [targetEmail]);
      if (r.rowCount === 0) {
        return res.json({ result: { ok: false, err: 'Felhasznalo nem talalhato.' } });
      }
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('userDelete hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // JARMU LISTA LEKERDEZESE
  if (functionName === 'vehicleList') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: [] });
      }
      const r = await pool.query(
        'SELECT * FROM vehicles WHERE company_id = $1 ORDER BY tip, rendszam',
        [req.session.user.company_id]
      );
      return res.json({ result: r.rows });
    } catch (err) {
      console.error('vehicleList hiba:', err);
      return res.json({ result: [] });
    }
  }

  // UJ JARMU LETREHOZASA
  if (functionName === 'vehicleCreate') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }

      const v = args[0] || {};
      const rendszam = String(v.rendszam || '').trim().toUpperCase();
      const tip = String(v.tip || '').trim();
      const marca = v.marca ? String(v.marca).trim() : null;
      const model = v.model ? String(v.model).trim() : null;
      const an = v.an ? parseInt(v.an, 10) : null;
      const nota = v.nota ? String(v.nota).trim() : null;

      if (!rendszam) {
        return res.json({ result: { ok: false, err: 'A rendszam kotelezo.' } });
      }
      if (!['Vontato', 'Potkocsi'].includes(tip)) {
        return res.json({ result: { ok: false, err: 'Ervenytelen tipus.' } });
      }

      await pool.query(
        `INSERT INTO vehicles (rendszam, tip, marca, model, an, nota, company_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [rendszam, tip, marca, model, an, nota, req.session.user.company_id]
      );
      return res.json({ result: { ok: true } });
    } catch (err) {
      if (err.code === '23505') {
        return res.json({ result: { ok: false, err: 'Ez a rendszam mar letezik.' } });
      }
      console.error('vehicleCreate hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // JARMU MODOSITAS
  if (functionName === 'vehicleUpdate') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }

      const id = parseInt(args[0], 10);
      const f = args[1] || {};
      if (!id) {
        return res.json({ result: { ok: false, err: 'ID kotelezo.' } });
      }

      const updates = [];
      const values = [];
      let i = 1;

      if (f.rendszam !== undefined) {
        updates.push(`rendszam = $${i++}`);
        values.push(String(f.rendszam).trim().toUpperCase());
      }
      if (f.tip !== undefined) {
        if (!['Vontato', 'Potkocsi'].includes(f.tip)) {
          return res.json({ result: { ok: false, err: 'Ervenytelen tipus.' } });
        }
        updates.push(`tip = $${i++}`);
        values.push(f.tip);
      }
      if (f.marca !== undefined) {
        updates.push(`marca = $${i++}`);
        values.push(f.marca);
      }
      if (f.model !== undefined) {
        updates.push(`model = $${i++}`);
        values.push(f.model);
      }
      if (f.an !== undefined) {
        updates.push(`an = $${i++}`);
        values.push(f.an ? parseInt(f.an, 10) : null);
      }
      if (f.nota !== undefined) {
        updates.push(`nota = $${i++}`);
        values.push(f.nota);
      }
      if (f.activ !== undefined) {
        updates.push(`activ = $${i++}`);
        values.push(!!f.activ);
      }

      if (updates.length === 0) {
        return res.json({ result: { ok: false, err: 'Nincs mit modositani.' } });
      }

      updates.push(`updated_at = NOW()`);
      values.push(id);
      const sql = `UPDATE vehicles SET ${updates.join(', ')} WHERE id = $${i}`;
      const r = await pool.query(sql, values);

      if (r.rowCount === 0) {
        return res.json({ result: { ok: false, err: 'Nem talalhato.' } });
      }
      return res.json({ result: { ok: true } });
    } catch (err) {
      if (err.code === '23505') {
        return res.json({ result: { ok: false, err: 'Ez a rendszam mar letezik.' } });
      }
      console.error('vehicleUpdate hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // JARMU TORLES
  if (functionName === 'vehicleDelete') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const id = parseInt(args[0], 10);
      if (!id) {
        return res.json({ result: { ok: false, err: 'ID kotelezo.' } });
      }
      const r = await pool.query('DELETE FROM vehicles WHERE id = $1 AND company_id = $2', [id, req.session.user.company_id]);
      if (r.rowCount === 0) {
        return res.json({ result: { ok: false, err: 'Nem talalhato.' } });
      }
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('vehicleDelete hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }
  // ===========================================================
  //   KULSO SOFOROK KEZELESE (external_drivers)
  // ===========================================================

  // LISTA
  if (functionName === 'extDriverList') {
    try {
      if (!req.session.user) {
        return res.json({ result: [] });
      }
      const r = await pool.query(
        `SELECT id, nume, firma, telefon, email, rendszam_camion, rendszam_remorca, nota, created_at
         FROM external_drivers WHERE company_id = $1 ORDER BY nume, firma`,
        [req.session.user.company_id]
      );
      return res.json({ result: r.rows });
    } catch (err) {
      console.error('extDriverList hiba:', err);
      return res.json({ result: [] });
    }
  }

  // UJ KULSO SOFOR
  if (functionName === 'extDriverCreate') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }

      const d = args[0] || {};
      const nume = d.nume ? String(d.nume).trim() : null;
      const firma = d.firma ? String(d.firma).trim() : null;
      const telefon = d.telefon ? String(d.telefon).trim() : null;
      const email = d.email ? String(d.email).trim().toLowerCase() : null;
      const rendszam_camion = d.rendszam_camion ? String(d.rendszam_camion).trim().toUpperCase() : null;
      const rendszam_remorca = d.rendszam_remorca ? String(d.rendszam_remorca).trim().toUpperCase() : null;
      const nota = d.nota ? String(d.nota).trim() : null;

      // legalabb egy mezo kotelezo (nume vagy firma)
      if (!nume && !firma) {
        return res.json({ result: { ok: false, err: 'A nev vagy a ceg neve kotelezo.' } });
      }

      const r = await pool.query(
        `INSERT INTO external_drivers (nume, firma, telefon, email, rendszam_camion, rendszam_remorca, nota, company_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [nume, firma, telefon, email, rendszam_camion, rendszam_remorca, nota, req.session.user.company_id]
      );
      return res.json({ result: { ok: true, id: r.rows[0].id } });
    } catch (err) {
      console.error('extDriverCreate hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // KULSO SOFOR MODOSITAS
  if (functionName === 'extDriverUpdate') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }

      const id = parseInt(args[0], 10);
      const f = args[1] || {};
      if (!id) {
        return res.json({ result: { ok: false, err: 'ID kotelezo.' } });
      }

      const updates = [];
      const values = [];
      let i = 1;

      if (f.nume !== undefined) {
        updates.push(`nume = $${i++}`);
        values.push(f.nume ? String(f.nume).trim() : null);
      }
      if (f.firma !== undefined) {
        updates.push(`firma = $${i++}`);
        values.push(f.firma ? String(f.firma).trim() : null);
      }
      if (f.telefon !== undefined) {
        updates.push(`telefon = $${i++}`);
        values.push(f.telefon ? String(f.telefon).trim() : null);
      }
      if (f.email !== undefined) {
        updates.push(`email = $${i++}`);
        values.push(f.email ? String(f.email).trim().toLowerCase() : null);
      }
      if (f.rendszam_camion !== undefined) {
        updates.push(`rendszam_camion = $${i++}`);
        values.push(f.rendszam_camion ? String(f.rendszam_camion).trim().toUpperCase() : null);
      }
      if (f.rendszam_remorca !== undefined) {
        updates.push(`rendszam_remorca = $${i++}`);
        values.push(f.rendszam_remorca ? String(f.rendszam_remorca).trim().toUpperCase() : null);
      }
      if (f.nota !== undefined) {
        updates.push(`nota = $${i++}`);
        values.push(f.nota ? String(f.nota).trim() : null);
      }

      if (updates.length === 0) {
        return res.json({ result: { ok: false, err: 'Nincs mit modositani.' } });
      }

      updates.push(`updated_at = NOW()`);
      values.push(id);
      const sql = `UPDATE external_drivers SET ${updates.join(', ')} WHERE id = $${i}`;
      const r = await pool.query(sql, values);

      if (r.rowCount === 0) {
        return res.json({ result: { ok: false, err: 'Nem talalhato.' } });
      }
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('extDriverUpdate hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // KULSO SOFOR TORLES
  if (functionName === 'extDriverDelete') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const id = parseInt(args[0], 10);
      if (!id) {
        return res.json({ result: { ok: false, err: 'ID kotelezo.' } });
      }
      const r = await pool.query('DELETE FROM external_drivers WHERE id = $1 AND company_id = $2', [id, req.session.user.company_id]);
      if (r.rowCount === 0) {
        return res.json({ result: { ok: false, err: 'Nem talalhato.' } });
      }
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('extDriverDelete hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }
  
  // FUVAR MODOSITAS (Admin/Manager)
  if (functionName === 'comUpdate') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }

      const id = String(args[0] || '').trim();
      const o = args[1] || {};

      if (!id) {
        return res.json({ result: { ok: false, err: 'ID kotelezo.' } });
      }

      const updates = [];
      const values = [];
      let i = 1;

      if (o.client !== undefined) { updates.push(`client = $${i++}`); values.push(o.client); }
      if (o.ref !== undefined) { updates.push(`ref = $${i++}`); values.push(o.ref); }
      if (o.loc_incarcare !== undefined) { updates.push(`loc_incarcare = $${i++}`); values.push(o.loc_incarcare); }
      if (o.loc_descarcare !== undefined) { updates.push(`loc_descarcare = $${i++}`); values.push(o.loc_descarcare); }
      if (o.data_incarcare !== undefined) { updates.push(`data_incarcare = $${i++}`); values.push(o.data_incarcare || null); }
      if (o.data_descarcare !== undefined) { updates.push(`data_descarcare = $${i++}`); values.push(o.data_descarcare || null); }
      if (o.pret !== undefined) { updates.push(`pret = $${i++}`); values.push(Number(o.pret || 0)); }
      if (o.km !== undefined) { updates.push(`km = $${i++}`); values.push(Number(o.km || 0)); }
      if (o.status !== undefined) {
        if (!['Disponibil','Alocat','Extern','In Curs','Finalizat','Anulat'].includes(o.status)) {
          return res.json({ result: { ok: false, err: 'Ervenytelen statusz.' } });
        }
        updates.push(`status = $${i++}`); values.push(o.status);
      }
      if (o.sofer_type !== undefined) { updates.push(`sofer_type = $${i++}`); values.push(o.sofer_type || null); }
      if (o.email_sofer !== undefined) { updates.push(`email_sofer = $${i++}`); values.push(o.email_sofer || null); }
      if (o.nume_sofer !== undefined) { updates.push(`nume_sofer = $${i++}`); values.push(o.nume_sofer || null); }
      if (o.firma_extern !== undefined) { updates.push(`firma_extern = $${i++}`); values.push(o.firma_extern || null); }
      if (o.telefon_extern !== undefined) { updates.push(`telefon_extern = $${i++}`); values.push(o.telefon_extern || null); }
      if (o.rendszam_camion !== undefined) { updates.push(`rendszam_camion = $${i++}`); values.push(o.rendszam_camion ? o.rendszam_camion.toUpperCase() : null); }
      if (o.rendszam_remorca !== undefined) { updates.push(`rendszam_remorca = $${i++}`); values.push(o.rendszam_remorca ? o.rendszam_remorca.toUpperCase() : null); }

      if (updates.length === 0) {
        return res.json({ result: { ok: false, err: 'Nincs mit modositani.' } });
      }

      updates.push(`updated_at = NOW()`);
      values.push(id);
      const sql = `UPDATE orders SET ${updates.join(', ')} WHERE id = $${i}`;
      const r = await pool.query(sql, values);

      if (r.rowCount === 0) {
        return res.json({ result: { ok: false, err: 'Fuvar nem talalhato.' } });
      }
      return res.json({ result: { ok: true } });

    } catch (err) {
      console.error('comUpdate hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // FUVAR TORLES (Admin/Manager)
  if (functionName === 'comDelete') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const id = String(args[0] || '').trim();
      if (!id) {
        return res.json({ result: { ok: false, err: 'ID kotelezo.' } });
      }
      await pool.query('DELETE FROM order_legs WHERE order_id = $1', [id]);
      const r = await pool.query('DELETE FROM orders WHERE id = $1', [id]);
      if (r.rowCount === 0) {
        return res.json({ result: { ok: false, err: 'Fuvar nem talalhato.' } });
      }
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('comDelete hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // ============================================
  //  DASHBOARD STATISZTIKA
  // ============================================
  if (functionName === 'dashStats') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const cid = req.session.user.company_id;

      // Fuvarok statusz szerint
      const statusR = await pool.query(
        `SELECT status, COUNT(*)::int AS db FROM orders WHERE company_id = $1 GROUP BY status`,
        [cid]
      );

      // Havi bevétel (elmúlt 12 hónap)
      const bevR = await pool.query(
        `SELECT TO_CHAR(created_at, 'YYYY-MM') AS ho, SUM(pret)::numeric AS osszeg
         FROM orders WHERE company_id = $1 AND created_at >= NOW() - INTERVAL '12 months'
         GROUP BY ho ORDER BY ho`,
        [cid]
      );

      // Sofőrök km összesítő
      const kmR = await pool.query(
        `SELECT nume_sofer, SUM(km)::numeric AS total_km
         FROM orders WHERE company_id = $1 AND km > 0 AND nume_sofer IS NOT NULL
         GROUP BY nume_sofer ORDER BY total_km DESC LIMIT 10`,
        [cid]
      );

      // Járművek kihasználtsága (hány fuvarhoz rendelték)
      const jarmuR = await pool.query(
        `SELECT rendszam_camion AS rendszam, COUNT(*)::int AS fuvarok
         FROM orders WHERE company_id = $1 AND rendszam_camion IS NOT NULL
         GROUP BY rendszam_camion ORDER BY fuvarok DESC LIMIT 10`,
        [cid]
      );

      // Cég neve
      const cegR = await pool.query('SELECT nev FROM companies WHERE id = $1', [cid]);

      return res.json({ result: {
        ok: true,
        ceg_nev: cegR.rows[0]?.nev || '—',
        statuszok: statusR.rows,
        havi_bevetel: bevR.rows,
        sofor_km: kmR.rows,
        jarmu_kihasznaltsag: jarmuR.rows
      }});
    } catch (err) {
      console.error('dashStats hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // ============================================
  //  MEGRENDELO DOKUMENTUMOK (Order Documents)
  // ============================================

  // Lista egy fuvarhoz
  if (functionName === 'orderDocList') {
    try {
      if (!req.session.user) return res.json({ result: [] });
      const orderId = String(args[0] || '').trim();
      if (!orderId) return res.json({ result: [] });
      const r = await pool.query(
        `SELECT od.id, od.file_name, od.uploaded_by, od.created_at,
                (od.signed_base64 IS NOT NULL) AS has_signed
         FROM order_documents od
         JOIN orders o ON o.id = od.order_id
         WHERE od.order_id = $1 AND o.company_id = $2
         ORDER BY od.created_at DESC`,
        [orderId, req.session.user.company_id]
      );
      return res.json({ result: r.rows });
    } catch (err) {
      console.error('orderDocList hiba:', err);
      return res.json({ result: [] });
    }
  }

  // Uj megrendelo feltoltese (PDF base64)
  if (functionName === 'orderDocUpload') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const orderId = String(args[0] || '').trim();
      const fileName = String(args[1] || '').trim();
      const b64 = args[2];
      if (!orderId || !fileName || !b64) {
        return res.json({ result: { ok: false, err: 'Hianyzo adat' } });
      }
      const r = await pool.query(
        `INSERT INTO order_documents (order_id, file_name, original_base64, uploaded_by, company_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [orderId, fileName, b64, req.session.user.nume || req.session.user.email, req.session.user.company_id]
      );
      return res.json({ result: { ok: true, docId: r.rows[0].id } });
    } catch (err) {
      console.error('orderDocUpload hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // Egy dokumentum lekerese (original | signed)
  if (functionName === 'orderDocGet') {
    try {
      if (!req.session.user) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      const docId = parseInt(args[0], 10);
      const which = args[1] === 'signed' ? 'signed' : 'original';
      if (!docId) return res.json({ result: { ok: false, err: 'Hianyzo azonosito' } });
      const r = await pool.query(
        `SELECT file_name, original_base64, signed_base64 FROM order_documents WHERE id = $1`,
        [docId]
      );
      if (!r.rows.length) return res.json({ result: { ok: false, err: 'Nem talalhato' } });
      const row = r.rows[0];
      const base64 = which === 'signed' ? row.signed_base64 : row.original_base64;
      if (!base64) return res.json({ result: { ok: false, err: 'Nincs ilyen valtozat' } });
      return res.json({ result: { ok: true, base64, fileName: row.file_name } });
    } catch (err) {
      console.error('orderDocGet hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // Alairt valtozat mentese
  if (functionName === 'orderDocSaveSigned') {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
      }
      const docId = parseInt(args[0], 10);
      const b64 = args[1];
      if (!docId || !b64) return res.json({ result: { ok: false, err: 'Hianyzo adat' } });
      const r = await pool.query(
        `UPDATE order_documents SET signed_base64 = $1, updated_at = NOW()
         WHERE id = $2 RETURNING id`,
        [b64, docId]
      );
      if (!r.rows.length) return res.json({ result: { ok: false, err: 'Nem talalhato' } });
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('orderDocSaveSigned hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  // ============================================
  //  DEVELOPER VEGPONTOK
  // ============================================
  const isDev = req.session.user && req.session.user.is_dev;

  if (functionName === 'devCompanyList') {
    if (!isDev) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    try {
      const r = await pool.query(`
        SELECT c.*, 
          (SELECT COUNT(*)::int FROM users u WHERE u.company_id = c.id) AS user_count,
          (SELECT COUNT(*)::int FROM orders o WHERE o.company_id = c.id) AS order_count
        FROM companies c ORDER BY c.created_at DESC
      `);
      return res.json({ result: r.rows });
    } catch (err) { return res.json({ result: [] }); }
  }

  if (functionName === 'devCompanyUpdate') {
    if (!isDev) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    try {
      const id = parseInt(args[0], 10);
      const f = args[1] || {};
      const updates = []; const values = []; let i = 1;
      if (f.nev !== undefined) { updates.push(`nev=$${i++}`); values.push(f.nev); }
      if (f.subscription_status !== undefined) { updates.push(`subscription_status=$${i++}`); values.push(f.subscription_status); }
      if (f.paid_until !== undefined) { updates.push(`paid_until=$${i++}`); values.push(f.paid_until || null); }
      if (f.email_contact !== undefined) { updates.push(`email_contact=$${i++}`); values.push(f.email_contact); }
      if (f.telefon !== undefined) { updates.push(`telefon=$${i++}`); values.push(f.telefon); }
      if (f.max_users !== undefined) { updates.push(`max_users=$${i++}`); values.push(parseInt(f.max_users)); }
      if (f.max_trucks !== undefined) { updates.push(`max_trucks=$${i++}`); values.push(parseInt(f.max_trucks)); }
      if (f.igazgato_nev !== undefined) { updates.push(`igazgato_nev=$${i++}`); values.push(f.igazgato_nev); }
      if (!updates.length) return res.json({ result: { ok: false, err: 'Nincs mit modositani' } });
      values.push(id);
      await pool.query(`UPDATE companies SET ${updates.join(',')} WHERE id=$${i}`, values);
      return res.json({ result: { ok: true } });
    } catch (err) { return res.json({ result: { ok: false, err: 'Szerver hiba' } }); }
  }

  if (functionName === 'devCompanyCreate') {
    if (!isDev) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    try {
      const f = args[0] || {};
      const r = await pool.query(
        `INSERT INTO companies (nev, subscription_status, paid_until, email_contact, telefon, max_users, max_trucks, igazgato_nev)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [f.nev, f.subscription_status||'active', f.paid_until||null, f.email_contact||null, f.telefon||null, f.max_users||10, f.max_trucks||10, f.igazgato_nev||null]
      );
      const companyId = r.rows[0].id;

      // Auto Admin meghivokod generalas
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let kod = 'VS-';
      for (let i = 0; i < 6; i++) kod += chars.charAt(Math.floor(Math.random() * chars.length));

      await pool.query(
        `INSERT INTO invites (kod, pozicio, email, status, company_id) VALUES ($1, $2, $3, $4, $5)`,
        [kod, 'Admin', f.email_contact||null, 'Aktiv', companyId]
      );

      if (f.email_contact) {
        sendInviteEmail(f.email_contact, kod, 'Admin', f.nev, f.igazgato_nev||null)
          .catch(e => console.error('Email hatter hiba:', e.message));
      }

      return res.json({ result: { ok: true, id: companyId, invite_kod: kod } });
    } catch (err) { return res.json({ result: { ok: false, err: 'Szerver hiba' } }); }
  }

  if (functionName === 'devCompanyDelete') {
    if (!isDev) return res.json({ result: { ok: false, err: 'Nincs jogosultsag' } });
    try {
      const id = parseInt(args[0], 10);
      const kod = String(args[1] || '');
      if (kod !== 'vallorsoftcegtorlo1') {
        return res.json({ result: { ok: false, err: 'Helytelen megerosito kod.' } });
      }
      // Cascade torles
      const users = await pool.query('SELECT email FROM users WHERE company_id = $1', [id]);
      const emails = users.rows.map(u => u.email);
      if (emails.length > 0) {
        await pool.query('DELETE FROM border_crossings WHERE email_sofer = ANY($1)', [emails]);
        await pool.query('DELETE FROM documents WHERE email_sofer = ANY($1)', [emails]);
        await pool.query('DELETE FROM fuvarlevelek WHERE email_sofer = ANY($1)', [emails]);
        await pool.query('DELETE FROM stamps WHERE email = ANY($1)', [emails]);
      }
      const orderIds = await pool.query('SELECT id FROM orders WHERE company_id = $1', [id]);
      if (orderIds.rows.length > 0) {
        const oids = orderIds.rows.map(o => o.id);
        await pool.query('DELETE FROM order_documents WHERE order_id = ANY($1)', [oids]);
        await pool.query('DELETE FROM order_legs WHERE order_id = ANY($1)', [oids]);
      }
      await pool.query('DELETE FROM orders WHERE company_id = $1', [id]);
      await pool.query('DELETE FROM invites WHERE company_id = $1', [id]);
      await pool.query('DELETE FROM users WHERE company_id = $1', [id]);
      await pool.query('DELETE FROM companies WHERE id = $1', [id]);
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('devCompanyDelete hiba:', err);
      return res.json({ result: { ok: false, err: 'Szerver hiba' } });
    }
  }

  if (functionName === 'devUserList') {
    if (!isDev) return res.json({ result: [] });
    try {
      const r = await pool.query(`
        SELECT u.id, u.nume, u.email, u.pozicio, u.company_id, c.nev AS ceg_nev
        FROM users u LEFT JOIN companies c ON c.id = u.company_id
        ORDER BY c.nev, u.pozicio
      `);
      return res.json({ result: r.rows });
    } catch (err) { return res.json({ result: [] }); }
  }

  if (functionName === 'devStats') {
    if (!isDev) return res.json({ result: { ok: false } });
    try {
      const cegek = await pool.query('SELECT COUNT(*)::int AS db FROM companies');
      const userek = await pool.query('SELECT COUNT(*)::int AS db FROM users WHERE pozicio_dev IS NOT TRUE');
      const fuvarok = await pool.query('SELECT COUNT(*)::int AS db FROM orders');
      const aktiv = await pool.query("SELECT COUNT(*)::int AS db FROM companies WHERE subscription_status='active'");
      return res.json({ result: { ok: true,
        cegek: cegek.rows[0].db,
        userek: userek.rows[0].db,
        fuvarok: fuvarok.rows[0].db,
        aktiv_cegek: aktiv.rows[0].db
      }});
    } catch (err) { return res.json({ result: { ok: false } }); }
  }

  // Ismeretlen funkcio
  return res.json({ result: { ok: false, err: 'Ismeretlen funkcio: ' + functionName } });
});

// SZERVER INDITAS
app.listen(PORT, () => {
  console.log('Szerver fut a http://localhost:' + PORT + ' cimen');
});