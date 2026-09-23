// ============================================================
//  VallorSoft — Sofőr API: határátlépés, menetlevél, dokumentumok, PDF
//  Kivágva a régi server.js-ből, a kód-törzs változatlan.
// ============================================================
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const { calculateDiurna } = require('../lib/diurna');
const { computeFuelTotals } = require('../lib/waybillTotals');
const { normalizeCategory } = require('../lib/expenseCategories');
const { fetchTripCrossings } = require('../lib/tripCrossings');
const { genDocId } = require('../lib/ids');

// A sofőr a főoldali „🇷🇴 BE / KI" gombokat idő-picker modalon át erősíti
// meg: alap a mostani idő, de szerkeszthető, ha lekésett a nyomással.
// Csak józan ész-korlát (max 7 nap múlt, kb. 2 perc jövő), különben
// created_at = NOW() marad. A validációhoz ugyanaz a szűrő, mint a
// milestone/stop-event végpontokban (ordersRest.js parseAtInput).
const MAX_BACKDATE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_MS   = 2 * 60 * 1000;
function _parseBorderAt(at) {
  if (at === undefined || at === null || at === '') return null;
  const d = new Date(String(at));
  if (!(d instanceof Date) || isNaN(d.getTime())) return null;
  const now = Date.now();
  const t = d.getTime();
  if (t > now + MAX_FUTURE_MS) return null;
  if (t < now - MAX_BACKDATE_MS) return null;
  return d.toISOString();
}

// A kiadás-sorok kategóriája fehérlistázva (a kliens bármit küldhet; a
// Gemini bon-kiolvasás is javasol egyet). Ismeretlen → `altele`, így a
// kiadás sosem vész el amiatt, hogy a kategóriát nem sikerült felismerni.
// A kiadás-kategória RO felirata a nyomtatott menetlevélre. A kulcsok a
// `lib/expenseCategories.js` fehérlistájából jönnek; a felület i18n-je
// (sof.cat.*) ugyanezeket adja RO+HU-ban.
const CAT_RO = {
  taxa_drum: 'Taxă drum', feribot: 'Feribot', parcare: 'Parcare',
  spalare: 'Spălare', reparatie: 'Reparație', piese: 'Piese',
  cazare: 'Cazare', mancare: 'Mâncare', amenda: 'Amendă', altele: 'Altele'
};

function normalizeAchizitii(list) {
  if (!Array.isArray(list)) return [];
  return list.map(a => Object.assign({}, a, { categorie: normalizeCategory(a && a.categorie) }));
}

router.post('/api/border-cross', async (req, res) => {
  try {
    if (!req.session.user) return res.json({ success: false, err: 'Nu sunteti autentificat' });
    const { tip, tara, locatie, gps_lat, gps_lng, at } = req.body;
    // Bemenet-védelem: `tip` fehérlista (a schema.sql-en VARCHAR(20) volt,
    // csendes megcsonkolás lett belőle); a `tara`/`locatie` hossz-korlát a
    // schema-oszlop szélességéhez igazodik; a `gps_lat`/`lng` numerikusan
    // ellenőrzött (NaN/Infinity/tartományon kívüli érték kizárva). Ez a
    // teljes védelme a `borderLogList` renderrel párban áll (esc a
    // kliensen), de itt is szigorítunk, hogy a DB-ben csak legit érték
    // legyen.
    const tipSafe = (tip === 'Intrare' || tip === 'Iesire') ? tip : 'Iesire';
    const taraSafe = tara ? String(tara).slice(0, 50) : null;
    const locSafe = locatie ? String(locatie).slice(0, 255) : null;
    const validGps = (v) => {
      const n = parseFloat(v);
      return (Number.isFinite(n) && Math.abs(n) <= 180) ? n : null;
    };
    const eventAt = _parseBorderAt(at);
    if (eventAt) {
      await pool.query(
        `INSERT INTO border_crossings
           (email_sofer, nume_sofer, tip, tara, locatie, gps_lat, gps_lng, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)`,
        [
          req.session.user.email,
          req.session.user.nume,
          tipSafe, taraSafe, locSafe,
          validGps(gps_lat), validGps(gps_lng),
          eventAt,
        ]
      );
    } else {
      await pool.query(
        `INSERT INTO border_crossings (email_sofer, nume_sofer, tip, tara, locatie, gps_lat, gps_lng)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          req.session.user.email,
          req.session.user.nume,
          tipSafe, taraSafe, locSafe,
          validGps(gps_lat), validGps(gps_lng)
        ]
      );
    }
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
    // Diurna számítása a menetlevél indulás/érkezés ablakából + a sofőr
    // GPS-alapú határátlépéseiből. A határátlépés KIZÁRÓLAG a főoldali két
    // gombból származik (`border_crossings`) — a menetlevélen nincs kézi
    // bevitel, és a klienstől érkező `hataratok` mezőt SZÁNDÉKOSAN eldobjuk
    // (régi, gyorsítótárazott sofer.js még küldhetné).
    // Hiba esetén 0/0, a menetlevél mentése akkor is fusson.
    let diurnaCalc = { externDays: 0, internDays: 0, crossingLog: [] };
    const indulasDt = d.indulasDt || null;
    const erkezesDt = d.erkezesDt || null;
    let hataratok = [];
    try {
      const tc = await fetchTripCrossings(pool, req.session.user.email, indulasDt, erkezesDt);
      hataratok = tc.inWindow;                     // ez kerül a menetlevélbe (napló)
      diurnaCalc = calculateDiurna(indulasDt, erkezesDt, tc.forCalc);
    } catch (diurnaErr) {
      console.error('diurna számítás hiba (a mentés folytatódik):', diurnaErr.message);
    }

    const totalKm = Math.max(0, Number(d.kmSfarsit || 0) - Number(d.kmInceput || 0));
    const alimentari = Array.isArray(d.alimentari) ? d.alimentari : [];
    const cantInc = Number(d.cantInceput || 0);
    const cantSf = Number(d.cantSfarsit || 0);
    // Az AdBlue KÜLÖN számít (nem dízel) — a közös `lib/waybillTotals.js`-ben,
    // hogy a beküldés / admin-szerkesztés / kézi létrehozás ne térhessen el.
    const { totalAlim, totalAdblue, motorinaFolosit, consum100 } =
      computeFuelTotals(alimentari, cantInc, cantSf, totalKm);

    const puncte = Array.isArray(d.puncte) ? d.puncte : [];
    const orderIds = Array.isArray(d.orderIds) ? d.orderIds : [];

    await pool.query(
      `INSERT INTO fuvarlevelek (
        id, file_name, email_sofer, nume_sofer,
        numar_camion, numar_remorca, numar_fisa,
        km_inceput, km_sfarsit, total_km,
        loc_plecare, loc_sosire,
        diurna_externa, diurna_interna,
        cant_inceput, cant_sfarsit, motorina_folosit, total_alim, total_adblue, consum_100,
        alte_mentiuni, alimentari, achizitii, puncte, order_ids,
        indulas_dt, erkezes_dt, hataratok, company_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)`,
      [
        id, fileName, req.session.user.email, req.session.user.nume,
        d.numarCamion || null, d.numarRemorca || null, autoDocNumber || d.numarFisa || null,
        Number(d.kmInceput || 0), Number(d.kmSfarsit || 0), totalKm,
        d.locPlecare || null, d.locSosire || null,
        diurnaCalc.externDays, diurnaCalc.internDays,  // a sofőr által megadott adatokból számolva
        cantInc, cantSf, motorinaFolosit, totalAlim, totalAdblue, consum100,
        d.alteMentiuni || null,
        JSON.stringify(alimentari),
        JSON.stringify(normalizeAchizitii(d.achizitii)),
        JSON.stringify(puncte),
        JSON.stringify(orderIds),
        indulasDt ? new Date(indulasDt) : null,
        erkezesDt ? new Date(erkezesDt) : null,
        JSON.stringify(hataratok),
        cid   // company_id horgony — túléli a sofőr törlését
      ]
    );
    // A driver által megadott felrakási/lerakási dátumok átvitele a
    // konkrét order_stops sorra (per-stop menetlevél-jelölés). A kliens
    // `puncte[i].orderId` + `puncte[i].role` ('loading'|'unloading') +
    // (új:) `puncte[i].stopId` tag-ekkel jelöli, hogy a sor melyik fuvar
    // melyik konkrét stopjához tartozik. Ha nincs stopId (régi kliens vagy
    // 1-1 pontos fuvar), az első még nem waybill-ezett kind-ű stopra írjuk.
    // A `orders.*_at` mirror mezőket a trigger frissíti. Best-effort;
    // multi-tenant: mindig cégre szűrt WHERE.
    //
    // FONTOS SZABÁLY (2026-08-06, PR: driver-controls-events):
    //   A menetlevél EGY DOKUMENTUM — nem esemény. A tényleges felrakás/
    //   lerakás időpontját a belső sofőr a fuvar-kártya állomás-gombjaival
    //   rögzíti (arrive/done), a menetlevél csak listázza. Ezért:
    //     - BELSŐ sofőrhöz kiosztott fuvarnál (van `email_sofer`, nem
    //       Extern) a menetlevél CSAK waybilled_at-et jelöl; a done_at-et
    //       a driver az „Elvégeztem" gombbal állítja. Auto-Finalizat SEM
    //       kerül elő ilyenkor — a lezárás a driver kezében marad.
    //     - EXTERN / nincs internal driver esetén (nincs email_sofer VAGY
    //       status='Extern') megőrizzük a régi viselkedést: done_at is
    //       beállítódik a menetlevél dátumára, és a fuvar Finalizat lesz
    //       (a külsős fuvarnál nincs milestone-gomb).
    //   Így egy péntek beadott menetlevél, ami a hétfői tervezett lerakást
    //   is felsorolja, NEM zárja le a fuvart — a driver hétfőn nyomja meg
    //   a lerakás gombot (a menetlevél-picker türelmi ideje ezt megvárja).
    const _waybilledOrders = new Set(); // amelyik fuvar puncte-sort kapott
    // Cache: orderId → { driver: bool } (driver=true, ha belső sofőrhöz
    // van kiosztva ÉS nem Extern → menetlevél NE állítson done_at-et)
    const _orderMode = new Map();
    async function _orderIsDriverOwned(orderId) {
      if (_orderMode.has(orderId)) return _orderMode.get(orderId);
      const q = await pool.query(
        `SELECT status, email_sofer FROM orders
          WHERE id = $1 AND company_id = $2`,
        [orderId, cid]);
      const r = q.rows[0];
      // Belső sofőr: van email_sofer ÉS a státusz nem Extern (a régi
      // Alocat/In Curs/Parkolt/Raktarban/Finalizat mind belső ág).
      const owned = !!(r && r.email_sofer && r.status !== 'Extern');
      _orderMode.set(orderId, owned);
      return owned;
    }
    try {
      for (const p of puncte) {
        if (!p || !p.orderId || !p.role || !p.data) continue;
        const kind = p.role === 'loading' ? 'pickup'
                  : p.role === 'unloading' ? 'delivery' : null;
        if (!kind) continue;
        const dateStr = String(p.data).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
        // A puncte sor DÁTUM-mezőt tárol (óra nélkül); a nap közepére állítjuk,
        // hogy a helyi időzóna 00:00-ja ne csúszhasson át az előző napra.
        const ts = new Date(dateStr + 'T12:00:00Z');
        if (isNaN(ts.getTime())) continue;

        const driverOwned = await _orderIsDriverOwned(p.orderId);

        // 1) Cél stop kiválasztása: preferált stopId ownership-ellenőrzéssel
        let stopId = null;
        if (p.stopId) {
          const chk = await pool.query(
            `SELECT id FROM order_stops
              WHERE id = $1 AND order_id = $2 AND company_id = $3 AND kind = $4`,
            [p.stopId, p.orderId, cid, kind]);
          if (chk.rows.length) stopId = chk.rows[0].id;
        }
        // 2) Fallback: első még nem waybill-ezett kind-ű stop
        if (!stopId) {
          const nx = await pool.query(
            `SELECT id FROM order_stops
              WHERE order_id = $1 AND company_id = $2 AND kind = $3
                AND waybilled_at IS NULL
              ORDER BY stop_index ASC LIMIT 1`,
            [p.orderId, cid, kind]);
          if (nx.rows.length) stopId = nx.rows[0].id;
        }

        if (stopId) {
          if (driverOwned) {
            // Belső sofőrhöz kiosztott → CSAK waybilled_at. A done_at-et
            // a driver az „Elvégeztem" milestone-gombbal állítja.
            await pool.query(
              `UPDATE order_stops
                  SET waybilled_at = COALESCE(waybilled_at, $1),
                      updated_at = NOW()
                WHERE id = $2`,
              [ts, stopId]);
          } else {
            // Extern / nincs internal driver → done_at is (régi viselkedés).
            await pool.query(
              `UPDATE order_stops
                  SET done_at = COALESCE(done_at, $1),
                      waybilled_at = COALESCE(waybilled_at, $1),
                      updated_at = NOW()
                WHERE id = $2`,
              [ts, stopId]);
          }
        } else if (!driverOwned) {
          // Legacy fallback CSAK Extern/nincs-driver esetben: nem-migrált
          // fuvar (nincs egy stop se) — a régi orders.*_at mezőt frissítjük
          // direktben. Belső sofőrnél ezt is kihagyjuk, hogy a menetlevél
          // sose lépjen automatikusan Finalizat felé.
          const col = kind === 'pickup' ? 'incarcat_at' : 'descarcat_at';
          await pool.query(
            `UPDATE orders SET ${col} = $1 WHERE id = $2 AND company_id = $3`,
            [ts, p.orderId, cid]);
        }
        _waybilledOrders.add(p.orderId);
      }
    } catch (uErr) {
      console.error('driver puncte → stops/orders update hiba (a mentés sikeres):', uErr.message);
    }
    // Ha ÖSSZES delivery done_at be van állítva → a trigger updateli az
    // orders.descarcat_at-ot NOT NULL-ra, és a státusz Finalizat lehet.
    // Aktív fuvar (Alocat/In Curs) descarcat_at IS NOT NULL → Finalizat.
    // Extern/Parkolt/Raktarban érintetlen (azokat a diszpécser zárja le).
    // FONTOS: ez CSAK a nem-belső-sofőr fuvaroknál fut. Belső sofőr esetén
    // a lezárást a driver az „Elvégeztem" gomb utolsó megnyomása oldja meg
    // (routes/ordersRest.js `_applyStopEvent`), így a menetlevél soha nem
    // tudja lezárni a fuvart a driver akarata nélkül.
    try {
      const externOrders = Array.from(_waybilledOrders).filter((oid) => !_orderMode.get(oid));
      if (externOrders.length) {
        await pool.query(
          `UPDATE orders SET status = 'Finalizat'
           WHERE id = ANY($1::text[]) AND company_id = $2
             AND status IN ('Alocat', 'In Curs')
             AND descarcat_at IS NOT NULL`,
          [externOrders, cid]
        );
      }
    } catch (cErr) {
      console.error('driver puncte → auto-Finalizat hiba (a mentés sikeres):', cErr.message);
    }
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

    // ── HIVATALOS FEJLÉC-ADATOK (a decont-nyomtatványokkal AZONOS forrás) ──
    // A cég törzsadatai + a feltöltött logó/pecsét. Best-effort: ha egy régi
    // cégnél hiányzik az oszlop vagy a `company_branding` sor, a lap attól még
    // renderelődik (csak a logó/pecsét/meta marad el).
    const cid = req.session.user.company_id;
    let comp = { cui: null, reg_com: null, adresa: null, telefon: null, email_contact: null };
    try {
      const cR = await pool.query(
        'SELECT cui, reg_com, adresa, telefon, email_contact FROM companies WHERE id=$1', [cid]);
      if (cR.rows.length) comp = Object.assign(comp, cR.rows[0]);
    } catch (_e) { /* régi séma — a meta-sor marad el */ }
    let logoUri = null, stampUri = null;
    try {
      const bR = await pool.query(
        `SELECT logo_base64, logo_mime, stamp_base64, stamp_mime
           FROM company_branding WHERE company_id=$1`, [cid]);
      if (bR.rows.length) {
        const b = bR.rows[0];
        if (b.logo_base64)  logoUri  = 'data:' + (b.logo_mime  || 'image/png') + ';base64,' + b.logo_base64;
        if (b.stamp_base64) stampUri = 'data:' + (b.stamp_mime || 'image/png') + ';base64,' + b.stamp_base64;
      }
    } catch (_e) { /* company_branding hiányozhat */ }

    // Meta-sor a cégnév alatt — UGYANAZ a szimbólum-készlet és sorrend, mint a
    // Decont lunar / Decont oficial / csoportos bizonylat fejlécén.
    const compMeta = [];
    if (comp.cui)           compMeta.push('CUI ' + escHtml(comp.cui));
    if (comp.reg_com)       compMeta.push('J ' + escHtml(comp.reg_com));
    if (comp.telefon)       compMeta.push('☏ ' + escHtml(comp.telefon));
    if (comp.email_contact) compMeta.push('✉ ' + escHtml(comp.email_contact));

    const alimentari = Array.isArray(f.alimentari) ? f.alimentari : [];
    const achizitii  = Array.isArray(f.achizitii)  ? f.achizitii  : [];
    const puncte     = Array.isArray(f.puncte)      ? f.puncte     : [];
    const orderIds   = Array.isArray(f.order_ids)   ? f.order_ids  : [];

    // Az útvonal-pont típusa színes pirulaként — a decont kind-pilluláinak
    // mintájára (ott a járandóság-típus kap ilyet). Ismeretlen típus → semleges.
    const PUNCT_PILL = {
      'Plecare':     { bg: '#e0e7ff', fg: '#3730a3' },
      'Încărcare':   { bg: '#dcfce7', fg: '#166534' },
      'Incarcare':   { bg: '#dcfce7', fg: '#166534' },
      'Descărcare':  { bg: '#fee2e2', fg: '#991b1b' },
      'Descarcare':  { bg: '#fee2e2', fg: '#991b1b' },
      'Sosire':      { bg: '#f1f5f9', fg: '#334155' }
    };
    const _punctPill = (tip) => {
      const key = String(tip || '').trim();
      const c = PUNCT_PILL[key] || { bg: '#f1f5f9', fg: '#334155' };
      return '<span style="display:inline-block;padding:2px 9px;border-radius:9px;background:' + c.bg
        + ';color:' + c.fg + ';font-size:11px;font-weight:800;white-space:nowrap;">' + escHtml(key || '—') + '</span>';
    };

    // Útvonal pontok HTML
    let puncteHtml = '';
    if (puncte.length > 0) {
      puncte.forEach((p, i) => {
        puncteHtml += `<tr>
          <td style="color:#94a3b8;font-weight:700;">${i+1}.</td>
          <td>${_punctPill(p.tip)}</td>
          <td>${escHtml(p.loc || '—')}</td>
          <td style="white-space:nowrap;color:#475569;">${escHtml(p.data || '—')}</td>
        </tr>`;
      });
    } else {
      // Ha nincs puncte, a régi loc_plecare/loc_sosire mutatjuk
      if (f.loc_plecare) puncteHtml += `<tr><td style="color:#94a3b8;font-weight:700;">1.</td><td>${_punctPill('Plecare')}</td><td>${escHtml(f.loc_plecare)}</td><td style="white-space:nowrap;color:#475569;">—</td></tr>`;
      if (f.loc_sosire)  puncteHtml += `<tr><td style="color:#94a3b8;font-weight:700;">2.</td><td>${_punctPill('Sosire')}</td><td>${escHtml(f.loc_sosire)}</td><td style="white-space:nowrap;color:#475569;">—</td></tr>`;
      if (!puncteHtml)   puncteHtml  = '<tr class="empty-row"><td colspan="4">Nu a fost inregistrat niciun punct de traseu.</td></tr>';
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
          <td><span style="color:#94a3b8;font-weight:700;">${i+1}.</span> ${escHtml(a.loc || '—')}</td>
          <td style="white-space:nowrap;color:#475569;">${_fmtItemDate(a.data)}</td>
          <td>${escHtml(a.tip || 'Motorină')}</td>
          <td class="num">${escHtml(a.litru || 0)} L</td>
          <td class="num" style="color:#475569;">${escHtml(a.km || 0)} km</td>
          <td>${escHtml(a.plata || '—')}</td>
          <td class="num" style="font-weight:700;">${a.suma ? escHtml(a.suma) + ' RON' : '—'}</td>
        </tr>`;
      });
    } else {
      alimHtml = '<tr class="empty-row"><td colspan="7">Nu a fost inregistrata nicio alimentare.</td></tr>';
    }

    // Kiadások HTML — külön Loc / Data oszlop (a Data mostantól per-tétel)
    let achHtml = '';
    if (achizitii.length > 0) {
      achizitii.forEach((ach, i) => {
        achHtml += `<tr>
          <td><span style="color:#94a3b8;font-weight:700;">${i+1}.</span> ${escHtml(ach.loc || '—')}</td>
          <td style="white-space:nowrap;color:#475569;">${_fmtItemDate(ach.data)}</td>
          <td><span style="display:inline-block;padding:2px 9px;border-radius:9px;background:#fef3c7;color:#92400e;font-size:11px;font-weight:800;white-space:nowrap;">${escHtml(CAT_RO[normalizeCategory(ach.categorie)])}</span></td>
          <td>${escHtml(ach.produs || '—')}</td>
          <td class="num" style="font-weight:700;">${escHtml(ach.pret || 0)} RON</td>
          <td>${escHtml(ach.plata || '—')}</td>
        </tr>`;
      });
    } else {
      achHtml = '<tr class="empty-row"><td colspan="6">Nu a fost inregistrata nicio cheltuiala.</td></tr>';
    }

    // Fuvar ID-k
    const orderIdsStr = orderIds.length ? escHtml(orderIds.join(', ')) : '—';

    res.send(`
  <html>
  <head>
    <title>${escHtml(f.file_name)}</title>
    <meta charset="UTF-8">
    <style>
      /* ─── A DECONT-NYOMTATVÁNYOK ARCULATA ───────────────────────────────
         Forrás: public/fleet-extra-v2.js (_dcRenderSheetHtml + _VS_PRINT_CSS).
         Ugyanaz a hivatalos fejléc (logó · cégnév + meta · gradiens badge +
         2px elválasztó), ugyanaz a lágy kártya/tábla-nyelv (szürke keret,
         halvány fejléc-sáv, 1px sor-elválasztó), ugyanaz az aláíró blokk
         ráégetett cég-pecséttel és ugyanaz a középre zárt lábléc. */
      * { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      body { font-family: Arial, Helvetica, sans-serif; margin:0; padding:20px; color:#0f172a; background:#fff; font-size:13px; line-height:1.5; }

      /* Fejléc */
      .lh { width:100%; border-collapse:collapse; }
      .lh td { vertical-align:middle; padding:0; }
      .lh-logo { width:96px; padding-right:16px !important; }
      .lh-name { font-size:20px; font-weight:800; color:#0f172a; letter-spacing:.2px; }
      .lh-sub { font-size:11px; color:#6b7280; }
      .lh-right { text-align:right; width:230px; }
      .doc-badge { display:inline-block; padding:9px 16px; background:linear-gradient(135deg,#2563eb,#1e40af);
                   color:#fff; border-radius:8px; font-weight:800; font-size:14px; letter-spacing:.3px; }
      .doc-serial { font-size:13px; color:#0f172a; font-weight:700; margin-top:6px; }
      .doc-period { font-size:11px; color:#6b7280; margin-top:2px; }
      .lh-rule { height:0; border-top:2px solid #0f172a; margin:12px 0 16px; }

      /* Kártyák + szakasz-címek */
      .card { padding:10px 14px; background:#f8fafc; border:1.5px solid #cbd5e1; border-radius:8px; margin-bottom:14px; }
      .card table { width:100%; border-collapse:collapse; font-size:12.5px; }
      .card td { padding:4px 0; vertical-align:top; }
      .card .lbl { color:#475569; }
      .card b { color:#0f172a; }
      .sec-title { font-size:14px; font-weight:700; color:#0f172a; margin:16px 0 6px; }

      /* Táblák — a decont tábláinak mintájára */
      .grid-table { width:100%; border-collapse:collapse; font-size:12px; margin-bottom:6px; }
      .grid-table th { padding:6px 8px; text-align:left; color:#1e293b; font-weight:700; }
      .grid-table td { padding:6px 8px; border-bottom:1px solid #e5e7eb; vertical-align:top; }
      .grid-table .num { text-align:right; }
      .tbl-pu thead tr { background:#e0e7ff; }
      .tbl-al thead tr { background:#d1fae5; }
      .tbl-ac thead tr { background:#fef3c7; }
      .empty-row td { padding:12px; text-align:center; color:#6b7280; font-style:italic; border-bottom:0; }

      /* Fogyasztás-blokk — a decont összegző-kártyáinak nyelvén */
      .sum-block { margin-top:4px; padding:14px 18px; border:2px solid #475569; border-radius:10px; background:#f8fafc; }
      .sum-block table { width:100%; border-collapse:collapse; font-size:13px; }
      .sum-block td { padding:4px 0; }
      .sum-block .k { color:#334155; font-weight:700; }
      .sum-block .v { text-align:right; font-weight:800; color:#0f172a; }
      .sum-note { font-size:11px; color:#6b7280; }
      .sum-hi { margin-top:12px; padding:14px 18px; border:2.5px solid #1e40af; border-radius:10px; background:#eff6ff; }
      .sum-hi table { width:100%; border-collapse:collapse; font-size:15px; }
      .sum-hi .k { color:#1e40af; font-weight:800; }
      .sum-hi .v { text-align:right; font-weight:900; color:#1e40af; font-size:16px; }

      .note-box { padding:10px 14px; background:#f8fafc; border:1.5px solid #cbd5e1; border-radius:8px;
                  min-height:38px; font-size:12.5px; color:#0f172a; white-space:pre-wrap; }

      /* Aláíró blokk — ráégetett cég-pecséttel (mint a decontokon) */
      .sign-tbl { width:100%; border-collapse:collapse; margin-top:36px; }
      .sign-tbl td { width:50%; vertical-align:top; height:110px; }
      .sign-line { border-top:1.5px solid #0f172a; padding-top:6px; font-size:11px; color:#475569; }
      .sign-name { font-size:12px; color:#94a3b8; margin-top:2px; }

      /* ─── TÖBBOLDALAS NYOMTATÁS — a decont-nyomtatványok szabályai ───
         (forras: public/fleet-extra-v2.js _VS_PRINT_CSS)
         1. A doc-fejléc egy layout-tábla <thead>-jében ül, a lábléc a
            <tfoot>-ban → a böngésző MINDEN lap tetejére/aljára megismétli.
         2. Minden belső adat-tábla oszlop-fejléce (<thead>) szintén
            ismétlődik, ha a tábla átnyúlik a következő oldalra.
         3. Egy sor SOSEM törik ketté két oldal között.
         4. Az összetartozó blokkok (fejléc-adatok, fogyasztás-számítás,
            aláírás) egyben maradnak. */
      table.vs-print-wrap { width:100%; border-collapse:collapse; }
      .vs-print-wrap > thead { display:table-header-group; }
      .vs-print-wrap > tfoot { display:table-footer-group; }
      .vs-print-wrap > thead > tr > td,
      .vs-print-wrap > tfoot > tr > td,
      .vs-print-wrap > tbody > tr > td { padding:0; border:0; vertical-align:top; }
      thead { display:table-header-group; }
      tfoot { display:table-footer-group; }
      tr { page-break-inside:avoid; break-inside:avoid; }
      .keep, .sign-tbl, .vs-doc-head, .sum-block, .sum-hi, .card { page-break-inside:avoid; break-inside:avoid; }
      .sec-title { page-break-after:avoid; break-after:avoid; }
      .vs-doc-foot { margin-top:10px; padding-top:6px; border-top:1px solid #e5e7eb;
                     font-size:10px; color:#94a3b8; text-align:center; }
      @page { size:A4; margin:14mm; }
      /* Az !important KELL: a gombsav inline display:flex erteke kulonben
         legyozi az osztaly-szabalyt, es a kepernyos gombok kulon oldalkent
         rakerulnek a nyomtatott menetlevelre. */
      @media print { .no-print { display:none !important; } body { padding:0; } }
    </style>
  </head>
  <body>
    <div class="no-print" style="margin-bottom:16px;display:flex;gap:10px;flex-wrap:wrap;">
      <button onclick="window.close();setTimeout(function(){if(!window.closed){if(history.length>1){history.back();}else{location.href='/';}}},150);" style="padding:10px 24px;background:#475569;color:#fff;font-weight:bold;cursor:pointer;border:none;border-radius:8px;font-size:14px;">← Inapoi</button>
      <button onclick="window.print()" style="padding:10px 24px;background:#2563eb;color:#fff;font-weight:bold;cursor:pointer;border:none;border-radius:8px;font-size:14px;">🖨️ Tipareste / Salveaza PDF</button>
    </div>
    <table class="vs-print-wrap">
    <thead><tr><td>
      <div class="vs-doc-head">
        <table class="lh"><tr>
          ${logoUri ? `<td class="lh-logo"><img src="${escHtml(logoUri)}" alt="" style="max-width:88px;max-height:80px;display:block;"></td>` : ''}
          <td>
            <div class="lh-name">${escHtml(companyName)}</div>
            ${comp.adresa ? `<div class="lh-sub">${escHtml(comp.adresa)}</div>` : ''}
            ${compMeta.length ? `<div class="lh-sub" style="margin-top:2px;">${compMeta.join(' · ')}</div>` : ''}
          </td>
          <td class="lh-right">
            <div class="doc-badge">Foaie de parcurs</div>
            <div class="doc-serial">${escHtml(f.numar_fisa || '—')}</div>
            <div class="doc-period">${fmtDateRo(f.indulas_dt)} → ${fmtDateRo(f.erkezes_dt)}</div>
          </td>
        </tr></table>
        <div class="lh-rule"></div>
      </div>
    </td></tr></thead>
    <tfoot><tr><td>
      <div class="vs-doc-foot">
        ${escHtml(companyName)} · Foaie de parcurs ${escHtml(f.numar_fisa || '—')} · ${escHtml(f.nume_sofer || '')}${f.numar_camion ? ' · ' + escHtml(f.numar_camion) : ''} · VallorSoft
      </div>
    </td></tr></tfoot>
    <tbody><tr><td>

    <div class="card keep">
      <table>
        <tr>
          <td width="50%"><span class="lbl">Nume șofer:</span> <b>${escHtml(f.nume_sofer || '—')}</b></td>
          <td><span class="lbl">Serie / Număr:</span> <b>${escHtml(f.numar_fisa || '—')}</b></td>
        </tr>
        <tr>
          <td><span class="lbl">Număr camion:</span> <b>${escHtml(f.numar_camion || '—')}</b></td>
          <td><span class="lbl">Număr remorcă:</span> <b>${escHtml(f.numar_remorca || '—')}</b></td>
        </tr>
        <tr><td colspan="2"><span class="lbl">ID-uri cursă:</span> ${orderIdsStr}</td></tr>
        <tr>
          <td><span class="lbl">Data plecare:</span> <b>${fmtDateRo(f.indulas_dt)}</b></td>
          <td><span class="lbl">Data sosire:</span> <b>${fmtDateRo(f.erkezes_dt)}</b></td>
        </tr>
        <tr>
          <td><span class="lbl">Km început:</span> <b>${f.km_inceput || 0} km</b></td>
          <td><span class="lbl">Km sfârșit:</span> <b>${f.km_sfarsit || 0} km</b></td>
        </tr>
        <tr>
          <td colspan="2" style="border-top:1px dashed #cbd5e1;padding-top:7px;">
            <span class="lbl">Total kilometri parcurși:</span>
            <b style="font-size:14px;">${f.total_km || 0} km</b>
          </td>
        </tr>
        ${isSofer ? '' : `<tr>
          <td><span class="lbl">Diurnă externă:</span> <b>${f.diurna_externa || 0} zile</b></td>
          <td><span class="lbl">Diurnă internă:</span> <b>${f.diurna_interna || 0} zile</b></td>
        </tr>`}
      </table>
    </div>

    <div class="sec-title">📍 Puncte de traseu (${puncte.length})</div>
    <table class="grid-table tbl-pu">
      <thead><tr><th style="width:34px;">#</th><th style="width:110px;">Tip</th><th>Localitate / Adresă</th><th style="width:96px;">Dată</th></tr></thead>
      <tbody>${puncteHtml}</tbody>
    </table>

    <div class="sec-title">⛽ Alimentări (${alimentari.length})</div>
    <table class="grid-table tbl-al">
      <thead><tr><th>Loc</th><th style="width:88px;">Data</th><th style="width:92px;">Combustibil</th><th class="num" style="width:62px;">Litri</th><th class="num" style="width:78px;">Km</th><th style="width:88px;">Plată</th><th class="num" style="width:92px;">Sumă</th></tr></thead>
      <tbody>${alimHtml}</tbody>
    </table>

    <div class="sec-title">🧮 Calcul consum combustibil</div>
    <div class="sum-block keep">
      <table>
        <tr><td class="k">Cantitate început:</td><td class="v">${f.cant_inceput || 0} L</td>
            <td class="k" style="padding-left:24px;">Cantitate sfârșit:</td><td class="v">${f.cant_sfarsit || 0} L</td></tr>
        <tr><td class="k">Total motorină alimentată:</td><td class="v">${f.total_alim || 0} L</td>
            <td class="k" style="padding-left:24px;">Motorină folosită:</td><td class="v">${f.motorina_folosit || 0} L</td></tr>
        <tr><td class="k" style="border-top:1px dashed #cbd5e1;padding-top:7px;">Total AdBlue:</td>
            <td class="v" style="border-top:1px dashed #cbd5e1;padding-top:7px;">${f.total_adblue || 0} L</td>
            <td colspan="2" class="sum-note" style="border-top:1px dashed #cbd5e1;padding-top:7px;padding-left:24px;">AdBlue nu intră în consumul de motorină.</td></tr>
      </table>
    </div>
    <div class="sum-hi keep">
      <table><tr>
        <td class="k">Consum mediu / 100 km</td>
        <td class="v">${f.consum_100 || 0} L</td>
      </tr></table>
    </div>

    <div class="sec-title">🛒 Achiziții / Cheltuieli (${achizitii.length})</div>
    <table class="grid-table tbl-ac">
      <thead><tr><th>Loc</th><th style="width:88px;">Data</th><th style="width:110px;">Categorie</th><th>Produs / Serviciu</th><th class="num" style="width:92px;">Preț</th><th style="width:96px;">Metodă plată</th></tr></thead>
      <tbody>${achHtml}</tbody>
    </table>

    <div class="sec-title">📝 Alte mențiuni</div>
    <div class="note-box keep">${escHtml(f.alte_mentiuni || '—')}</div>

    <table class="sign-tbl">
      <tr>
        <td style="padding-right:16px;">
          <div style="height:70px;"></div>
          <div class="sign-line">Semnătura șofer</div>
          <div class="sign-name">${escHtml(f.nume_sofer || '')}</div>
        </td>
        <td style="padding-left:16px;">
          ${stampUri
            ? `<div style="height:70px;text-align:center;"><img src="${escHtml(stampUri)}" alt="" style="max-height:68px;max-width:120px;opacity:.85;"></div>`
            : '<div style="height:70px;"></div>'}
          <div class="sign-line">Semnătura dispecer</div>
          <div class="sign-name">${escHtml(companyName)}</div>
        </td>
      </tr>
    </table>

    </td></tr></tbody>
    </table>
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
