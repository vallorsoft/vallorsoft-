// ============================================================
//  VallorSoft — Sofőr API: határátlépés, menetlevél, dokumentumok, PDF
//  Kivágva a régi server.js-ből, a kód-törzs változatlan.
// ============================================================
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const { calculateDiurna } = require('../lib/diurna');

router.post('/api/border-cross', async (req, res) => {
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

router.get('/api/diurna-stats', requireLogin, requireRole('Manager','Admin'), async (req,res) => {
  const cid = req.session.user.company_id;
  try {
    const sofors = await pool.query(`SELECT id, nume, email FROM users WHERE company_id=$1 AND pozicio='Sofer' ORDER BY nume`, [cid]);
    const result = [];
    for (const s of sofors.rows) {
      const cr = await pool.query(`SELECT CASE WHEN tip='Iesire' THEN 'OUT' WHEN tip='Intrare' THEN 'IN' ELSE tip END AS direction, created_at AS crossed_at FROM border_crossings WHERE email_sofer=$1 ORDER BY created_at ASC`, [s.email]);
      const d = calculateDiurna(cr.rows);
      result.push({ driver_id:s.id, nume:s.nume, email:s.email, externDays:d.externDays, internDays:d.internDays, crossingLog:d.crossingLog });
    }
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
  if (!prefix) return res.json({ok:false, err:'Prefix kötelező.'});
  try {
    await pool.query(`INSERT INTO document_series (company_id,doc_type,prefix,year,current_seq) VALUES ($1,$2,$3,$4,0) ON CONFLICT (company_id,doc_type,year) DO UPDATE SET prefix=$3, current_seq=0, updated_at=NOW()`, [cid, docType.toUpperCase(), prefix.toUpperCase(), year]);
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
    if (!req.session.user) return res.json({ success: false, err: 'Nincs bejelentkezve' });
    const d = req.body;
    const randId = Math.floor(1000 + Math.random() * 9000);
    const soferNameClean = (req.session.user.nume || 'Sofer').replace(/\s+/g, '_');
    const id = "FUV-" + randId;
    const fileName = `Menetlevel_${soferNameClean}_${randId}.pdf`;
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
    // Diurna automatikus számítása a határátlépésekből. Hiba esetén 0/0,
    // a menetlevél mentése akkor is fusson.
    let diurnaCalc = { externDays: 0, internDays: 0, crossingLog: [] };
    try {
      const crossR = await pool.query(`SELECT CASE WHEN tip='Iesire' THEN 'OUT' WHEN tip='Intrare' THEN 'IN' ELSE tip END AS direction, created_at AS crossed_at FROM border_crossings WHERE email_sofer=$1 AND created_at >= NOW()-INTERVAL '90 days' ORDER BY created_at ASC`, [req.session.user.email]);
      diurnaCalc = calculateDiurna(crossR.rows);
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
        alte_mentiuni, alimentari, achizitii, tranzite, puncte, order_ids
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)`,
      [
        id, fileName, req.session.user.email, req.session.user.nume,
        d.numarCamion || null, d.numarRemorca || null, autoDocNumber || d.numarFisa || null, d.cursaSaptamanii || null,
        Number(d.kmInceput || 0), Number(d.kmSfarsit || 0), totalKm,
        d.locPlecare || null, d.locSosire || null, d.locDescTUR || null, d.locIncRETUR || null,
        diurnaCalc.externDays, diurnaCalc.internDays,  // automatikusan a határátlépésekből
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
    res.json({ success: false, err: 'Szerver hiba: ' + (err.message || 'ismeretlen') });
  }
});

router.post('/api/doc-upload', async (req, res) => {
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

// SOFOR DOKUMENTUM MEGTEKINTES / LETOLTES
router.get('/api/doc-download/:id', async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).send('Nincs bejelentkezve');
    const r = await pool.query(
      `SELECT d.id, d.file_name, d.tip, d.storage_url
       FROM documents d
       JOIN users u ON u.email = d.email_sofer
       WHERE d.id = $1 AND u.company_id = $2`,
      [req.params.id, req.session.user.company_id]
    );
    if (!r.rows.length) return res.status(404).send('Nem talalhato');
    const doc = r.rows[0];
    const base64 = doc.storage_url || '';
    if (!base64) return res.status(404).send('Nincs tartalom');
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
    res.status(500).send('Szerver hiba');
  }
});

// PDF DOWNLOAD (DB-bol)
router.get('/api/pdf-download/:id', async (req, res) => {
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
      <tr><td colspan="2"><b>Fuvar ID-k:</b> ${orderIdsStr}</td></tr>
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

module.exports = router;
