// ============================================================
//  VallorSoft — Sofőr API: határátlépés, menetlevél, dokumentumok, PDF
//  Kivágva a régi server.js-ből, a kód-törzs változatlan.
// ============================================================
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const { calculateDiurna } = require('../lib/diurna');
const { genDocId } = require('../lib/ids');

router.post('/api/border-cross', async (req, res) => {
  try {
    if (!req.session.user) return res.json({ success: false, err: 'Nu sunteti autentificat' });
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
    res.json({ success: false, err: 'Eroare de server' });
  }
});

router.get('/api/diurna-stats', requireLogin, requireRole('Manager','Admin'), async (req,res) => {
  const cid = req.session.user.company_id;
  try {
    const sofors = await pool.query(`SELECT id, nume, email FROM users WHERE company_id=$1 AND pozicio='Sofer' ORDER BY nume`, [cid]);
    // Egyetlen lekérdezés az összes sofőrre (a korábbi sofőrönkénti, teljes
    // történetes körök helyett) — 90 napos ablak, mint a fuvarlevel-save-nél.
    const emails = sofors.rows.map(s => s.email);
    const byEmail = {};
    if (emails.length) {
      const cr = await pool.query(
        `SELECT email_sofer, CASE WHEN tip='Iesire' THEN 'OUT' WHEN tip='Intrare' THEN 'IN' ELSE tip END AS direction, created_at AS crossed_at
         FROM border_crossings WHERE email_sofer = ANY($1) AND created_at >= NOW() - INTERVAL '90 days'
         ORDER BY created_at ASC`, [emails]);
      for (const row of cr.rows) (byEmail[row.email_sofer] = byEmail[row.email_sofer] || []).push(row);
    }
    const result = sofors.rows.map(s => {
      const d = calculateDiurna(byEmail[s.email] || []);
      return { driver_id:s.id, nume:s.nume, email:s.email, externDays:d.externDays, internDays:d.internDays, crossingLog:d.crossingLog };
    });
    return res.json({ ok:true, data:result });
  } catch(err) { return res.json({ ok:false }); }
});

router.get('/api/document-series', requireLogin, requireRole('Manager','Admin'), async (req,res) => {
  const cid = req.session.user.company_id;
  const docType = (req.query.type||'MT').toUpperCase();
  const year = new Date().getFullYear();
  try {
    const r = await pool.query(`SELECT prefix, current_seq FROM document_series WHERE company_id=$1 AND doc_type=$2 AND year=$3`, [cid,docType,year]);
    return res.json({ ok:true, prefix: r.rows[0]?.prefix||docType, currentSeq: r.rows[0]?.current_seq||0 });
  } catch(err) { console.error('document-series GET hiba:', err); return res.json({ok:false, err: err.message}); }
});

router.post('/api/document-series', requireLogin, requireRole('Manager','Admin'), async (req,res) => {
  const cid = req.session.user.company_id;
  const { docType='MT', prefix } = req.body;
  const year = new Date().getFullYear();
  if (!prefix) return res.json({ok:false, err:'Prefixul este obligatoriu.'});
  try {
    // FONTOS: a prefix újramentése NEM nullázhatja a sorszámot — különben
    // már kiadott hivatalos bizonylatszámok ismétlődnének meg.
    await pool.query(`INSERT INTO document_series (company_id,doc_type,prefix,year,current_seq) VALUES ($1,$2,$3,$4,0) ON CONFLICT (company_id,doc_type,year) DO UPDATE SET prefix=$3, updated_at=NOW()`, [cid, docType.toUpperCase(), prefix.toUpperCase(), year]);
    return res.json({ok:true});
  } catch(err) { console.error('document-series POST hiba:', err); return res.json({ok:false, err: err.message}); }
});

router.post('/api/document-series/next', requireLogin, async (req,res) => {
  const cid = req.session.user.company_id;
  const docType = ((req.body&&req.body.docType)||'MT').toUpperCase();
  const year = new Date().getFullYear();
  try {
    const r = await pool.query(`INSERT INTO document_series (company_id,doc_type,prefix,year,current_seq) VALUES ($1,$2,$2,$3,1) ON CONFLICT (company_id,doc_type,year) DO UPDATE SET current_seq=document_series.current_seq+1, updated_at=NOW() RETURNING prefix, current_seq`, [cid, docType, year]);
    const {prefix, current_seq} = r.rows[0];
    const docNumber = `${prefix}-${year}-${String(current_seq).padStart(4,'0')}`;
    return res.json({ok:true, docNumber, seq:current_seq});
  } catch(err) { console.error('document-series/next hiba:', err); return res.json({ok:false, err: err.message}); }
});

router.post('/api/fuvarlevel-save', async (req, res) => {
  try {
    if (!req.session.user) return res.json({ success: false, err: 'Nu sunteti autentificat' });
    const d = req.body;
    const soferNameClean = (req.session.user.nume || 'Sofer').replace(/\s+/g, '_');
    const id = genDocId('FUV');
    const fileName = `Menetlevel_${soferNameClean}_${id.slice(4)}.pdf`;
    const cid = req.session.user.company_id;
    const year = new Date().getFullYear();
    // Automatikus, cégenkénti sorszám (MT-YYYY-XXXX). Ha bármiért elszáll
    // (pl. hiányzó document_series tábla), a menetlevél mentése akkor is fusson.
    let autoDocNumber = null;
    try {
      const seqR = await pool.query(`INSERT INTO document_series (company_id,doc_type,prefix,year,current_seq) VALUES ($1,'MT','MT',$2,1) ON CONFLICT (company_id,doc_type,year) DO UPDATE SET current_seq=document_series.current_seq+1, updated_at=NOW() RETURNING prefix, current_seq`, [cid, year]);
      autoDocNumber = seqR.rows[0] ? `${seqR.rows[0].prefix}-${year}-${String(seqR.rows[0].current_seq).padStart(4,'0')}` : null;
    } catch (seqErr) {
      console.error('document_series sorszám hiba (a mentés folytatódik):', seqErr.message);
    }
    // Diurna számítása a sofőr által megadott indulás/érkezés + határátlépések alapján.
    // Hiba esetén 0/0, a menetlevél mentése akkor is fusson.
    let diurnaCalc = { externDays: 0, internDays: 0, crossingLog: [] };
    const indulasDt = d.indulasDt || null;
    const erkezesDt = d.erkezesDt || null;
    const hataratok = Array.isArray(d.hataratok) ? d.hataratok : [];
    try {
      diurnaCalc = calculateDiurna(indulasDt, erkezesDt, hataratok);
    } catch (diurnaErr) {
      console.error('diurna számítás hiba (a mentés folytatódik):', diurnaErr.message);
    }

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
        alte_mentiuni, alimentari, achizitii, tranzite, puncte, order_ids,
        indulas_dt, erkezes_dt, hataratok, company_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)`,
      [
        id, fileName, req.session.user.email, req.session.user.nume,
        d.numarCamion || null, d.numarRemorca || null, autoDocNumber || d.numarFisa || null, d.cursaSaptamanii || null,
        Number(d.kmInceput || 0), Number(d.kmSfarsit || 0), totalKm,
        d.locPlecare || null, d.locSosire || null, d.locDescTUR || null, d.locIncRETUR || null,
        diurnaCalc.externDays, diurnaCalc.internDays,  // a sofőr által megadott adatokból számolva
        cantInc, cantSf, motorinaFolosit, totalAlim, consum100,
        d.alteMentiuni || null,
        JSON.stringify(alimentari),
        JSON.stringify(Array.isArray(d.achizitii) ? d.achizitii : []),
        JSON.stringify(Array.isArray(d.tranzite) ? d.tranzite : []),
        JSON.stringify(puncte),
        JSON.stringify(orderIds),
        indulasDt ? new Date(indulasDt) : null,
        erkezesDt ? new Date(erkezesDt) : null,
        JSON.stringify(hataratok),
        cid   // company_id horgony — túléli a sofőr törlését
      ]
    );
    res.json({ success: true, id, docNumber: autoDocNumber });
  } catch (err) {
    console.error('fuvarlevel-save hiba:', err);
    res.json({ success: false, err: 'Eroare de server: ' + (err.message || 'necunoscut') });
  }
});

router.post('/api/doc-upload', async (req, res) => {
  try {
    if (!req.session.user) return res.json({ success: false, err: 'Nu sunteti autentificat' });
    const { numeFisier, base64, tip, orderId } = req.body;
    // POD: a fotó opcionálisan fuvarhoz köthető — de CSAK a sofőr SAJÁT
    // cégének fuvarjához (idegen cég fuvar-ID-jára ne lehessen csatolni).
    let safeOrderId = null;
    if (orderId && req.session.user.company_id) {
      const oc = await pool.query(
        'SELECT id FROM orders WHERE id = $1 AND company_id = $2',
        [String(orderId).slice(0, 20), req.session.user.company_id]);
      if (oc.rows.length) safeOrderId = oc.rows[0].id;
    }
    await pool.query(
      `INSERT INTO documents (email_sofer, nume_sofer, tip, file_name, storage_url, order_id, company_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        req.session.user.email,
        req.session.user.nume,
        tip || 'CMR',
        numeFisier || 'dokument',
        base64 || null,
        safeOrderId,
        req.session.user.company_id || null   // company_id horgony — túléli a sofőr törlését
      ]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('doc-upload hiba:', err);
    res.json({ success: false, err: 'Eroare de server' });
  }
});

// SOFOR DOKUMENTUM MEGTEKINTES / LETOLTES
router.get('/api/doc-download/:id', async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).send('Nu sunteti autentificat');
    // Sofőr CSAK a saját dokumentumát töltheti le; Admin/Manager (diszpécser)
    // a cégen belül bármelyiket. Az e-mail kisbetűsítve illeszkedik a tárolthoz.
    const isSofer = req.session.user.pozicio === 'Sofer';
    const params = [req.params.id, req.session.user.company_id];
    let ownClause = '';
    if (isSofer) {
      params.push((req.session.user.email || '').toLowerCase());
      ownClause = ' AND LOWER(d.email_sofer) = $3';
    }
    const r = await pool.query(
      `SELECT d.id, d.file_name, d.tip, d.storage_url
       FROM documents d
       WHERE d.id = $1
         AND (d.company_id = $2 OR d.email_sofer IN (SELECT email FROM users WHERE company_id = $2))${ownClause}`,
      params
    );
    if (!r.rows.length) return res.status(404).send('Nu a fost gasit');
    const doc = r.rows[0];
    const base64 = doc.storage_url || '';
    if (!base64) return res.status(404).send('Fara continut');
    const matches = base64.match(/^data:([^;]+);base64,(.+)$/s);
    if (matches) {
      const mime = matches[1];
      const data = Buffer.from(matches[2], 'base64');
      const fileName = encodeURIComponent(doc.file_name || ('dokument_' + doc.id));
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      return res.send(data);
    }
    const data = Buffer.from(base64, 'base64');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.file_name || 'dokument')}"`);
    return res.send(data);
  } catch (err) {
    console.error('doc-download hiba:', err);
    res.status(500).send('Eroare de server');
  }
});

// HTML-escape a DB-ből jövő (felhasználó által beküldött) mezőkhöz — tárolt XSS ellen
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// Dátum CSAK (óra nélkül), románul. UTC-ben formázunk, hogy a kiválasztott
// dátum stabil maradjon (a date-only mezőket UTC-éjfélként tároljuk).
function fmtDateRo(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  return escHtml(d.toLocaleDateString('ro-RO', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }));
}

// PDF DOWNLOAD (DB-bol) — csak bejelentkezve, csak a saját cég menetlevele
router.get('/api/pdf-download/:id', async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).send('Nu sunteti autentificat');
    // Sofőr CSAK a saját menetlevelét nézheti/töltheti le; Admin/Manager
    // (diszpécser) a cégen belül bármelyiket. E-mail kisbetűsítve illeszkedik.
    const isSofer = req.session.user.pozicio === 'Sofer';
    const params = [req.params.id, req.session.user.company_id];
    let ownClause = '';
    if (isSofer) {
      params.push((req.session.user.email || '').toLowerCase());
      ownClause = ' AND LOWER(f.email_sofer) = $3';
    }
    const r = await pool.query(
      `SELECT f.*, c.nev AS company_denumire
       FROM fuvarlevelek f
       JOIN companies c ON c.id = $2
       WHERE f.id = $1
         AND (f.company_id = $2 OR f.email_sofer IN (SELECT email FROM users WHERE company_id = $2))${ownClause}`,
      params
    );
    if (!r.rows.length) return res.status(404).send('Nu a fost gasit.');
    const f = r.rows[0];
    const companyName = f.company_denumire || 'VallorSoft';

    const alimentari = Array.isArray(f.alimentari) ? f.alimentari : [];
    const achizitii  = Array.isArray(f.achizitii)  ? f.achizitii  : [];
    const puncte     = Array.isArray(f.puncte)      ? f.puncte     : [];
    const orderIds   = Array.isArray(f.order_ids)   ? f.order_ids  : [];

    // Útvonal pontok HTML
    let puncteHtml = '';
    if (puncte.length > 0) {
      puncte.forEach((p, i) => {
        puncteHtml += `<tr><td>${i+1}.</td><td>${escHtml(p.tip || '—')}</td><td>${escHtml(p.loc || '—')}</td><td>${escHtml(p.data || '—')}</td></tr>`;
      });
    } else {
      // Ha nincs puncte, a régi loc_plecare/loc_sosire mutatjuk
      if (f.loc_plecare) puncteHtml += `<tr><td>1.</td><td>Plecare</td><td>${escHtml(f.loc_plecare)}</td><td>—</td></tr>`;
      if (f.loc_sosire)  puncteHtml += `<tr><td>2.</td><td>Sosire</td><td>${escHtml(f.loc_sosire)}</td><td>—</td></tr>`;
      if (!puncteHtml)   puncteHtml  = '<tr><td colspan="4">—</td></tr>';
    }

    // Tankolások HTML — külön Loc / Data oszlop (a Data mostantól per-tétel)
    const _fmtItemDate = (v) => {
      if (!v) return '—';
      const s = String(v);
      // Elfogadja YYYY-MM-DD / ISO / TIMESTAMPTZ formát; csak a dátum-részt
      // mutatjuk (a menetlevélen mindig napra pontos, óra nincs).
      const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
      return m ? m[1] : escHtml(s);
    };
    let alimHtml = '';
    if (alimentari.length > 0) {
      alimentari.forEach((a, i) => {
        alimHtml += `<tr>
          <td>${i+1}. ${escHtml(a.loc || '—')}</td>
          <td>${_fmtItemDate(a.data)}</td>
          <td>${escHtml(a.tip || 'Motorină')}</td>
          <td>${escHtml(a.litru || 0)} L</td>
          <td>${escHtml(a.km || 0)} km</td>
          <td>${escHtml(a.plata || '—')}</td>
          <td>${a.suma ? escHtml(a.suma) + ' RON' : '—'}</td>
        </tr>`;
      });
    } else {
      alimHtml = '<tr><td colspan="7">Nu a fost inregistrata nicio alimentare.</td></tr>';
    }

    // Kiadások HTML — külön Loc / Data oszlop (a Data mostantól per-tétel)
    let achHtml = '';
    if (achizitii.length > 0) {
      achizitii.forEach((ach, i) => {
        achHtml += `<tr>
          <td>${i+1}. ${escHtml(ach.loc || '—')}</td>
          <td>${_fmtItemDate(ach.data)}</td>
          <td>${escHtml(ach.produs || '—')}</td>
          <td>${escHtml(ach.pret || 0)} RON</td>
          <td>${escHtml(ach.plata || '—')}</td>
        </tr>`;
      });
    } else {
      achHtml = '<tr><td colspan="5">Nu a fost inregistrata nicio cheltuiala.</td></tr>';
    }

    // Fuvar ID-k
    const orderIdsStr = orderIds.length ? escHtml(orderIds.join(', ')) : '—';

    res.send(`
  <html>
  <head>
    <title>${escHtml(f.file_name)}</title>
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
    <div class="no-print" style="margin-bottom:16px;display:flex;gap:10px;flex-wrap:wrap;">
      <button onclick="window.close();setTimeout(function(){if(!window.closed){if(history.length>1){history.back();}else{location.href='/';}}},150);" style="padding:10px 24px;background:#555;color:#fff;font-weight:bold;cursor:pointer;border:none;border-radius:4px;font-size:14px;">← Inapoi</button>
      <button onclick="window.print()" style="padding:10px 24px;background:#000;color:#fff;font-weight:bold;cursor:pointer;border:none;border-radius:4px;font-size:14px;">🖨️ Tipareste / Salveaza PDF</button>
    </div>
    <div class="header-box">${escHtml(companyName)}<br><span style="font-size:14px;">Foi de Parcurs</span><br><span style="font-size:15px;color:#b00;letter-spacing:1px;">Serie / Nr.: ${escHtml(f.numar_fisa || '—')}</span></div>

    <table class="grid-table">
      <tr><td width="50%"><b>Nume șofer:</b> ${escHtml(f.nume_sofer || '—')}</td><td><b>Serie / Număr:</b> ${escHtml(f.numar_fisa || '—')}</td></tr>
      <tr><td><b>Număr camion:</b> ${escHtml(f.numar_camion || '—')}</td><td><b>Număr remorcă:</b> ${escHtml(f.numar_remorca || '—')}</td></tr>
      <tr><td colspan="2"><b>ID-uri cursă:</b> ${orderIdsStr}</td></tr>
      <tr><td><b>Data plecare:</b> ${fmtDateRo(f.indulas_dt)}</td><td><b>Data sosire:</b> ${fmtDateRo(f.erkezes_dt)}</td></tr>
      <tr><td><b>Km început:</b> ${f.km_inceput || 0} km</td><td><b>Km sfârșit:</b> ${f.km_sfarsit || 0} km</td></tr>
      <tr><td colspan="2"><b>Total kilometri parcurși: ${f.total_km || 0} km</b></td></tr>
      <tr><td><b>Diurnă externă:</b> ${f.diurna_externa || 0} zile</td><td><b>Diurnă internă:</b> ${f.diurna_interna || 0} zile</td></tr>
    </table>

    <div class="sec-title">Puncte de traseu</div>
    <table class="grid-table">
      <tr><th>#</th><th>Tip</th><th>Localitate / Adresă</th><th>Dată</th></tr>
      ${puncteHtml}
    </table>

    <div class="sec-title">Alimentări</div>
    <table class="grid-table">
      <tr><th>Loc</th><th>Data</th><th>Combustibil</th><th>Litri</th><th>Km</th><th>Plată</th><th>Sumă</th></tr>
      ${alimHtml}
    </table>

    <div class="sec-title">Calcul consum combustibil</div>
    <table class="grid-table">
      <tr><td><b>Cantitate început:</b> ${f.cant_inceput || 0} L</td><td><b>Cantitate sfârșit:</b> ${f.cant_sfarsit || 0} L</td></tr>
      <tr><td><b>Total alimentări:</b> ${f.total_alim || 0} L</td><td><b>Motorină folosită:</b> ${f.motorina_folosit || 0} L</td></tr>
      <tr><td colspan="2"><b>Consum mediu / 100 km: ${f.consum_100 || 0} L</b></td></tr>
    </table>

    <div class="sec-title">Achiziții / Cheltuieli</div>
    <table class="grid-table">
      <tr><th>Loc</th><th>Data</th><th>Produs / Serviciu</th><th>Preț</th><th>Metodă plată</th></tr>
      ${achHtml}
    </table>

    <div class="sec-title">Alte mențiuni</div>
    <div style="border:1px solid #000;padding:10px;min-height:40px;">${escHtml(f.alte_mentiuni || '—')}</div>

    <div style="margin-top:30px;display:flex;justify-content:space-between;">
      <div style="text-align:center;"><div style="border-top:1px solid #000;width:180px;margin:0 auto;padding-top:4px;">Semnătura șofer</div></div>
      <div style="text-align:center;"><div style="border-top:1px solid #000;width:180px;margin:0 auto;padding-top:4px;">Semnătura dispecer</div></div>
    </div>
    <script>
      // Ha in-app iframe-ben (PWA-nézet) nyílik meg, a beágyazó modal adja a
      // Vissza/Nyomtatás vezérlést — rejtsük a saját gombsávot.
      if (window.self !== window.top) {
        var _tb = document.querySelector('.no-print');
        if (_tb) _tb.style.display = 'none';
      }
    </script>
  </body>
  </html>`);
  } catch (err) {
    console.error('pdf-download hiba:', err);
    res.status(500).send('Eroare de server');
  }
});

module.exports = router;
