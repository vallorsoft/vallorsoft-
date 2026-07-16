// ============================================================
//  VallorSoft — handlers/documents.js
//  AUTO-KIVÁGOTT a régi server.js /api/execute ágaiból.
//  A handler-törzsek BÁJTRA AZONOSAK az eredetivel.
//  Hívás: handlers.<funkcioNev>(req, res, args)
// ============================================================
const pool = require('../db');
const { genDocId } = require('../lib/ids');
const { calculateDiurna } = require('../lib/diurna');

const handlers = {};

handlers.stampGet = async function (req, res, args) {
    try {
      if (!req.session.user) return res.json({ result: { ok: false, err: 'Nu sunteti autentificat' } });
      const email = req.session.user.email;
      const r = await pool.query('SELECT base64_png FROM stamps WHERE email = $1', [email]);
      if (r.rows.length && r.rows[0].base64_png) {
        return res.json({ result: { ok: true, base64: r.rows[0].base64_png } });
      }
      return res.json({ result: { ok: true, base64: null } });
    } catch (err) {
      console.error('stampGet hiba:', err);
      return res.json({ result: { ok: false, err: 'Eroare de server' } });
    }
  };

handlers.stampSave = async function (req, res, args) {
    try {
      if (!req.session.user) return res.json({ result: { ok: false, err: 'Nu sunteti autentificat' } });
      const email = req.session.user.email;
      const b64 = args[0];
      if (!b64) return res.json({ result: { ok: false, err: 'Imagine lipsa' } });
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
      return res.json({ result: { ok: false, err: 'Eroare de server' } });
    }
  };

handlers.orderDocList = async function (req, res, args) {
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
  };

handlers.orderDocUpload = async function (req, res, args) {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Acces interzis' } });
      }
      const orderId = String(args[0] || '').trim();
      const fileName = String(args[1] || '').trim();
      const b64 = args[2];
      if (!orderId || !fileName || !b64) {
        return res.json({ result: { ok: false, err: 'Date lipsa' } });
      }
      // Tenant-ellenőrzés: a fuvar a hívó cégéhez tartozik-e (cross-tenant write védelem) —
      // különben „A" cég dokumentumot fűzhetne „B" cég fuvarához a fuvar-id megadásával.
      const own = await pool.query(
        'SELECT 1 FROM orders WHERE id = $1 AND company_id = $2',
        [orderId, req.session.user.company_id]
      );
      if (!own.rows.length) {
        return res.json({ result: { ok: false, err: 'Comanda nu a fost gasita.' } });
      }
      const r = await pool.query(
        `INSERT INTO order_documents (order_id, file_name, original_base64, uploaded_by, company_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [orderId, fileName, b64, req.session.user.nume || req.session.user.email, req.session.user.company_id]
      );
      return res.json({ result: { ok: true, docId: r.rows[0].id } });
    } catch (err) {
      console.error('orderDocUpload hiba:', err);
      return res.json({ result: { ok: false, err: 'Eroare de server' } });
    }
  };

handlers.orderDocGet = async function (req, res, args) {
    try {
      if (!req.session.user) return res.json({ result: { ok: false, err: 'Acces interzis' } });
      const docId = parseInt(args[0], 10);
      const which = args[1] === 'signed' ? 'signed' : 'original';
      if (!docId) return res.json({ result: { ok: false, err: 'Identificator lipsa' } });
      // Cégszűrés az orders-en keresztül (a régi sorokon a company_id NULL lehet)
      const r = await pool.query(
        `SELECT od.file_name, od.original_base64, od.signed_base64
         FROM order_documents od
         JOIN orders o ON o.id = od.order_id
         WHERE od.id = $1 AND o.company_id = $2`,
        [docId, req.session.user.company_id]
      );
      if (!r.rows.length) return res.json({ result: { ok: false, err: 'Nu a fost gasit' } });
      const row = r.rows[0];
      const base64 = which === 'signed' ? row.signed_base64 : row.original_base64;
      if (!base64) return res.json({ result: { ok: false, err: 'Nu exista aceasta varianta' } });
      return res.json({ result: { ok: true, base64, fileName: row.file_name } });
    } catch (err) {
      console.error('orderDocGet hiba:', err);
      return res.json({ result: { ok: false, err: 'Eroare de server' } });
    }
  };

handlers.orderDocSaveSigned = async function (req, res, args) {
    try {
      if (!req.session.user || !['Admin', 'Manager'].includes(req.session.user.pozicio)) {
        return res.json({ result: { ok: false, err: 'Acces interzis' } });
      }
      const docId = parseInt(args[0], 10);
      const b64 = args[1];
      if (!docId || !b64) return res.json({ result: { ok: false, err: 'Date lipsa' } });
      // Cégszűrés az orders-en keresztül (a régi sorokon a company_id NULL lehet)
      const r = await pool.query(
        `UPDATE order_documents od SET signed_base64 = $1, updated_at = NOW()
         FROM orders o
         WHERE od.id = $2 AND o.id = od.order_id AND o.company_id = $3
         RETURNING od.id`,
        [b64, docId, req.session.user.company_id]
      );
      if (!r.rows.length) return res.json({ result: { ok: false, err: 'Nu a fost gasit' } });
      return res.json({ result: { ok: true } });
    } catch (err) {
      console.error('orderDocSaveSigned hiba:', err);
      return res.json({ result: { ok: false, err: 'Eroare de server' } });
    }
  };

handlers.getFuvarlevelek = async function (req, res, args) {
    try {
      if (!req.session.user) return res.json({ result: [] });
      const me = req.session.user;
      const cid = me.company_id;
      const isAdmin = ['Admin', 'Manager'].includes(me.pozicio);
      let r;
      if (isAdmin && cid) {
        // Cég összes felhasználójának menetlevelei — email lista alapján (nem JOIN,
        // megbízhatóbb online). NEM csak a Sofer-eké: a kézzel (Admin/Manager) létrehozott
        // menetlevél a létrehozó e-mailjéhez kötődik, az is jelenjen meg a listában.
        const sofors = await pool.query(
          'SELECT email FROM users WHERE company_id = $1', [cid]
        );
        const emails = sofors.rows.map(u => u.email);
        if (!emails.length) return res.json({ result: [] });
        r = await pool.query(
          `SELECT id, file_name, numar_fisa, email_sofer, nume_sofer, data_completare, total_km, consum_100, numar_camion, order_ids
           FROM fuvarlevelek WHERE email_sofer = ANY($1)
           ORDER BY data_completare DESC LIMIT 200`,
          [emails]
        );
      } else {
        r = await pool.query(
          `SELECT id, file_name, numar_fisa, email_sofer, nume_sofer, data_completare, total_km, consum_100, numar_camion, order_ids
           FROM fuvarlevelek WHERE email_sofer = $1
           ORDER BY data_completare DESC LIMIT 200`,
          [me.email]
        );
      }

      // Fogyasztási anomália-jelző (üzemanyag-lopás gyanú): a menetlevél
      // tényleges consum_100-ját a jármű alap-fogyasztásához (vehicles.fuel_per_100km,
      // rendszám szerint) hasonlítjuk. >25% eltérésnél 'high' (▲ túlfogyasztás) /
      // 'low' (▼ alulfogyasztás). Csak Admin/Manager listáján számolunk; ha nincs
      // alapérték vagy consum, nincs jelző. A rendszám normalizálva illeszkedik.
      const rows = r.rows;
      if (isAdmin && cid && rows.length) {
        try {
          const vh = await pool.query(
            `SELECT rendszam, fuel_per_100km FROM vehicles
             WHERE company_id = $1 AND fuel_per_100km IS NOT NULL AND fuel_per_100km > 0`, [cid]);
          const norm = (s) => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
          const base = {};
          vh.rows.forEach(v => { const k = norm(v.rendszam); if (k) base[k] = Number(v.fuel_per_100km); });
          const TH = 0.25;
          rows.forEach(f => {
            const b = base[norm(f.numar_camion)];
            const c = Number(f.consum_100);
            f.fuel_baseline = (b != null && isFinite(b)) ? b : null;
            f.consum_anomaly = null; f.consum_dev_pct = null;
            if (b && b > 0 && isFinite(c) && c > 0) {
              const dev = (c - b) / b;
              if (Math.abs(dev) >= TH) {
                f.consum_anomaly = dev > 0 ? 'high' : 'low';
                f.consum_dev_pct = Math.round(dev * 100);
              }
            }
          });
        } catch (anomErr) {
          console.error('consum anomália számítás hiba (a lista folytatódik):', anomErr.message);
        }
      }
      return res.json({ result: rows });
    } catch (err) {
      console.error('getFuvarlevelek hiba:', err);
      return res.json({ result: [] });
    }
  };

// ─── Hiányzó menetlevél teendőlista (Admin/Manager) ───
// Azok a LEZÁRT (Finalizat) fuvarok, amelyekhez még EGYETLEN menetlevél sem
// készült (a fuvar id-ja egyetlen menetlevél order_ids tömbjében sem szerepel).
// Cégre szűrt, csak olvasás — a manager egy pillantással látja, kit kell nógatni.
handlers.getOrdersMissingWaybill = async function (req, res, args) {
    try {
      if (!req.session.user) return res.json({ result: { ok: false, err: 'Nu sunteti autentificat' } });
      const me = req.session.user;
      if (!['Admin', 'Manager'].includes(me.pozicio)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
      const cid = me.company_id;
      if (!cid) return res.json({ result: { ok: true, orders: [] } });
      const r = await pool.query(
        `SELECT o.id, o.fuvar_no, o.client, o.loc_incarcare, o.loc_descarcare,
                o.rendszam_camion, o.nume_sofer, o.email_sofer,
                COALESCE(o.finalized_at, o.data_descarcare) AS closed_at
         FROM orders o
         WHERE o.company_id = $1 AND o.status = 'Finalizat'
           AND NOT EXISTS (
             SELECT 1 FROM fuvarlevelek f
             WHERE f.email_sofer IN (SELECT email FROM users WHERE company_id = $1)
               AND f.order_ids @> to_jsonb(o.id::text)
           )
         ORDER BY COALESCE(o.finalized_at, o.data_descarcare) DESC NULLS LAST
         LIMIT 100`,
        [cid]);
      return res.json({ result: { ok: true, orders: r.rows } });
    } catch (err) {
      console.error('getOrdersMissingWaybill hiba:', err);
      return res.json({ result: { ok: false, err: 'Eroare de server' } });
    }
  };

// Egy menetlevél teljes adata — szerkesztéshez (Admin/Manager, cégre szűrve).
handlers.getFuvarlevelDetail = async function (req, res, args) {
    try {
      if (!req.session.user) return res.json({ result: { ok: false, err: 'Nu sunteti autentificat' } });
      const me = req.session.user;
      if (!['Admin', 'Manager'].includes(me.pozicio)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
      const id = Array.isArray(args) ? args[0] : args;
      if (!id) return res.json({ result: { ok: false, err: 'Identificator lipsa' } });
      // Csak a saját cég sofőrjeinek menetlevele érhető el.
      const r = await pool.query(
        `SELECT * FROM fuvarlevelek
         WHERE id = $1 AND email_sofer IN (SELECT email FROM users WHERE company_id = $2)`,
        [id, me.company_id]
      );
      if (!r.rows.length) return res.json({ result: { ok: false, err: 'Nu a fost gasit' } });
      return res.json({ result: { ok: true, fuv: r.rows[0] } });
    } catch (err) {
      console.error('getFuvarlevelDetail hiba:', err);
      return res.json({ result: { ok: false, err: err.message } });
    }
  };

// Menetlevél szerkesztése (Admin/Manager, cégre szűrve). A derivált mezőket
// (total_km, total_alim, motorina_folosit, consum_100) szerveroldalon számoljuk.
handlers.fuvarlevelUpdate = async function (req, res, args) {
    try {
      if (!req.session.user) return res.json({ result: { ok: false, err: 'Nu sunteti autentificat' } });
      const me = req.session.user;
      if (!['Admin', 'Manager'].includes(me.pozicio)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
      const id = Array.isArray(args) ? args[0] : null;
      const d = (Array.isArray(args) ? args[1] : null) || {};
      if (!id) return res.json({ result: { ok: false, err: 'Identificator lipsa' } });

      // Jogosultság + létezés: csak saját cég menetlevele.
      const own = await pool.query(
        `SELECT id FROM fuvarlevelek WHERE id = $1 AND email_sofer IN (SELECT email FROM users WHERE company_id = $2)`,
        [id, me.company_id]
      );
      if (!own.rows.length) return res.json({ result: { ok: false, err: 'Nu a fost gasit / acces interzis' } });

      const alimentari = Array.isArray(d.alimentari) ? d.alimentari : [];
      const achizitii  = Array.isArray(d.achizitii)  ? d.achizitii  : [];
      const puncte     = Array.isArray(d.puncte)      ? d.puncte      : [];

      const kmInc = Number(d.km_inceput || 0);
      const kmSf  = Number(d.km_sfarsit || 0);
      const totalKm = Math.max(0, kmSf - kmInc);
      let totalAlim = 0;
      alimentari.forEach(a => { totalAlim += Number(a.litru || 0); });
      const cantInc = Number(d.cant_inceput || 0);
      const cantSf  = Number(d.cant_sfarsit || 0);
      const motorinaFolosit = Math.max(0, cantInc + totalAlim - cantSf);
      const consum100 = totalKm > 0 ? Math.round((motorinaFolosit / totalKm * 100) * 100) / 100 : 0;

      // Dátum + fuvar ID-k (Admin/Manager szerkesztheti). Üres/hiányzó → a
      // meglévő érték marad (COALESCE); érvénytelen dátum → szintén marad.
      let dataCompletare = null;
      if (d.data_completare) { const dt = new Date(d.data_completare); if (!isNaN(dt.getTime())) dataCompletare = dt; }
      const orderIds = Array.isArray(d.order_ids)
        ? d.order_ids.map(x => String(x).trim()).filter(Boolean)
        : null;
      // Kezdő/végző dátum óra NÉLKÜL (YYYY-MM-DD). UTC-éjfélként tároljuk,
      // hogy a kiválasztott nap ne csússzon át időzóna miatt. Üres/érvénytelen
      // → a meglévő érték marad (COALESCE).
      const parseDateOnly = (v) => {
        if (!v) return null;
        const m = /^\d{4}-\d{2}-\d{2}$/.test(String(v).trim());
        const dt = new Date(m ? (String(v).trim() + 'T00:00:00Z') : v);
        return isNaN(dt.getTime()) ? null : dt;
      };
      const indulasDt = parseDateOnly(d.indulas_date);
      const erkezesDt = parseDateOnly(d.erkezes_date);

      // Össz-bevétel (nettó EUR) — kézi menetlevélnél a bevétel forrása. Üres/
      // hiányzó → a meglévő érték marad (COALESCE), így a sofőr beküldte
      // menetlevélnél véletlenül se nullázódik.
      let totalPret = null;
      if (d.total_pret !== undefined && d.total_pret !== null && String(d.total_pret).trim() !== '') {
        const tp = parseFloat(d.total_pret);
        if (Number.isFinite(tp) && tp >= 0) totalPret = tp;
      }

      await pool.query(
        `UPDATE fuvarlevelek SET
           nume_sofer = $2, numar_camion = $3, numar_remorca = $4, numar_fisa = $5,
           km_inceput = $6, km_sfarsit = $7, total_km = $8,
           diurna_externa = $9, diurna_interna = $10,
           cant_inceput = $11, cant_sfarsit = $12, motorina_folosit = $13, total_alim = $14, consum_100 = $15,
           alte_mentiuni = $16, alimentari = $17, achizitii = $18, puncte = $19,
           data_completare = COALESCE($20::timestamp, data_completare),
           order_ids = COALESCE($21::jsonb, order_ids),
           indulas_dt = COALESCE($22::timestamptz, indulas_dt),
           erkezes_dt = COALESCE($23::timestamptz, erkezes_dt),
           total_pret = COALESCE($24::numeric, total_pret)
         WHERE id = $1`,
        [
          id,
          d.nume_sofer || null, d.numar_camion || null, d.numar_remorca || null, d.numar_fisa || null,
          kmInc, kmSf, totalKm,
          parseInt(d.diurna_externa || 0), parseInt(d.diurna_interna || 0),
          cantInc, cantSf, motorinaFolosit, totalAlim, consum100,
          d.alte_mentiuni || null,
          JSON.stringify(alimentari), JSON.stringify(achizitii), JSON.stringify(puncte),
          dataCompletare,
          orderIds === null ? null : JSON.stringify(orderIds),
          indulasDt,
          erkezesDt,
          totalPret
        ]
      );
      return res.json({ result: { ok: true, total_km: totalKm, consum_100: consum100 } });
    } catch (err) {
      console.error('fuvarlevelUpdate hiba:', err);
      return res.json({ result: { ok: false, err: err.message } });
    }
  };

// Menetlevél KÉZI létrehozása (Admin/Manager). Pont úgy viselkedik, mint egy
// beküldött menetlevél szerkesztése: a derivált mezőket szerveroldalon
// számoljuk, és a sor a statisztikába is ugyanúgy beleszámít (a tenant-kötés
// az email_sofer → users.company_id joinon át). A sofőr kiválasztható a cég
// belső sofőrjei közül (email-mel) VAGY szabadon beírható egy név — utóbbinál
// a tenant-horgony a létrehozó (Admin/Manager) e-mailje. Új össz-bevétel mező
// (total_pret, nettó EUR), mert ez nem egy kiírt fuvarból születik.
handlers.fuvarlevelCreate = async function (req, res, args) {
    try {
      if (!req.session.user) return res.json({ result: { ok: false, err: 'Nu sunteti autentificat' } });
      const me = req.session.user;
      if (!['Admin', 'Manager'].includes(me.pozicio)) return res.json({ result: { ok: false, err: 'Acces interzis' } });
      const cid = me.company_id;
      if (!cid) return res.json({ result: { ok: false, err: 'Companie lipsa' } });
      const d = (Array.isArray(args) ? args[0] : args) || {};

      const numeSofer = (d.nume_sofer || '').toString().trim();
      if (!numeSofer) return res.json({ result: { ok: false, err: 'Numele soferului este obligatoriu' } });

      // Tenant-horgony (email_sofer): ha a kliens kiválasztott sofőrt (email),
      // ellenőrizzük, hogy a SAJÁT cég felhasználója-e; ha nem (vagy szabadon
      // beírt név), a létrehozó e-mailjét használjuk → a sor a cégen belül marad.
      let emailSofer = me.email;
      const pickedEmail = (d.email_sofer || '').toString().trim().toLowerCase();
      if (pickedEmail) {
        const ur = await pool.query(
          'SELECT email FROM users WHERE LOWER(email) = $1 AND company_id = $2 LIMIT 1',
          [pickedEmail, cid]
        );
        if (ur.rows.length) emailSofer = ur.rows[0].email;
      }

      const id = genDocId('FUV');
      const fileName = `Menetlevel_${numeSofer.replace(/\s+/g, '_')}_${id.slice(4)}.pdf`;
      const year = new Date().getFullYear();

      // Automatikus, cégenkénti sorszám (MT-YYYY-XXXX) — mint a sofőr-beküldésnél.
      // Ha a kliens kézzel adott sorszámot (numar_fisa), azt tartjuk meg.
      let autoDocNumber = (d.numar_fisa || '').toString().trim() || null;
      if (!autoDocNumber) {
        try {
          const seqR = await pool.query(
            `INSERT INTO document_series (company_id,doc_type,prefix,year,current_seq) VALUES ($1,'MT','MT',$2,1)
             ON CONFLICT (company_id,doc_type,year) DO UPDATE SET current_seq=document_series.current_seq+1, updated_at=NOW()
             RETURNING prefix, current_seq`, [cid, year]
          );
          autoDocNumber = seqR.rows[0] ? `${seqR.rows[0].prefix}-${year}-${String(seqR.rows[0].current_seq).padStart(4, '0')}` : null;
        } catch (seqErr) {
          console.error('document_series sorszám hiba (a mentés folytatódik):', seqErr.message);
        }
      }

      const alimentari = Array.isArray(d.alimentari) ? d.alimentari : [];
      const achizitii  = Array.isArray(d.achizitii)  ? d.achizitii  : [];
      const puncte     = Array.isArray(d.puncte)      ? d.puncte      : [];

      const kmInc = Number(d.km_inceput || 0);
      const kmSf  = Number(d.km_sfarsit || 0);
      const totalKm = Math.max(0, kmSf - kmInc);
      let totalAlim = 0;
      alimentari.forEach(a => { totalAlim += Number(a.litru || 0); });
      const cantInc = Number(d.cant_inceput || 0);
      const cantSf  = Number(d.cant_sfarsit || 0);
      const motorinaFolosit = Math.max(0, cantInc + totalAlim - cantSf);
      const consum100 = totalKm > 0 ? Math.round((motorinaFolosit / totalKm * 100) * 100) / 100 : 0;

      // Dátum (data_completare) — megadható; hiányában NOW() (tábla-alapérték).
      let dataCompletare = null;
      if (d.data_completare) { const dt = new Date(d.data_completare); if (!isNaN(dt.getTime())) dataCompletare = dt; }

      const parseDateOnly = (v) => {
        if (!v) return null;
        const m = /^\d{4}-\d{2}-\d{2}$/.test(String(v).trim());
        const dt = new Date(m ? (String(v).trim() + 'T00:00:00Z') : v);
        return isNaN(dt.getTime()) ? null : dt;
      };
      const indulasDt = parseDateOnly(d.indulas_date);
      const erkezesDt = parseDateOnly(d.erkezes_date);

      // Diurna: ha az adminban beírt diurna-napok jöttek, azt használjuk; egyébként
      // az indulás/érkezés dátumból becsüljük (mint a sofőr-beküldésnél).
      let diurnaExt = parseInt(d.diurna_externa || 0) || 0;
      let diurnaInt = parseInt(d.diurna_interna || 0) || 0;
      if (!diurnaExt && !diurnaInt && (indulasDt || erkezesDt)) {
        try {
          const dc = calculateDiurna(d.indulas_date || null, d.erkezes_date || null, []);
          diurnaExt = dc.externDays || 0;
          diurnaInt = dc.internDays || 0;
        } catch (_) { /* best-effort */ }
      }

      const orderIds = Array.isArray(d.order_ids)
        ? d.order_ids.map(x => String(x).trim()).filter(Boolean) : [];

      let totalPret = 0;
      if (d.total_pret !== undefined && d.total_pret !== null && String(d.total_pret).trim() !== '') {
        const tp = parseFloat(d.total_pret);
        if (Number.isFinite(tp) && tp >= 0) totalPret = tp;
      }

      await pool.query(
        `INSERT INTO fuvarlevelek (
          id, file_name, email_sofer, nume_sofer,
          numar_camion, numar_remorca, numar_fisa,
          km_inceput, km_sfarsit, total_km,
          diurna_externa, diurna_interna,
          cant_inceput, cant_sfarsit, motorina_folosit, total_alim, consum_100,
          alte_mentiuni, alimentari, achizitii, puncte, order_ids,
          data_completare, indulas_dt, erkezes_dt, total_pret
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
          COALESCE($23::timestamp, NOW()),$24,$25,$26)`,
        [
          id, fileName, emailSofer, numeSofer,
          d.numar_camion || null, d.numar_remorca || null, autoDocNumber,
          kmInc, kmSf, totalKm,
          diurnaExt, diurnaInt,
          cantInc, cantSf, motorinaFolosit, totalAlim, consum100,
          d.alte_mentiuni || null,
          JSON.stringify(alimentari), JSON.stringify(achizitii), JSON.stringify(puncte),
          JSON.stringify(orderIds),
          dataCompletare, indulasDt, erkezesDt, totalPret
        ]
      );
      return res.json({ result: { ok: true, id, docNumber: autoDocNumber, total_km: totalKm, consum_100: consum100 } });
    } catch (err) {
      console.error('fuvarlevelCreate hiba:', err);
      return res.json({ result: { ok: false, err: err.message } });
    }
  };

// Menetlevél-szerkesztő mező-javaslatok (Admin/Manager): a cég eddigi
// menetleveleibe ugyanabba a mezőbe már beírt, NEM üres, egyedi értékek —
// a kliens ebből kínál autocomplete-et gépelés közben. Csak olvasás, a cég
// sofőrjeinek menetleveleire szűrve (company_id-n keresztül).
handlers.getFuvarlevelFieldSuggestions = async function (req, res, args) {
    try {
      if (!req.session.user) return res.json({ result: {} });
      const me = req.session.user;
      if (!['Admin', 'Manager'].includes(me.pozicio)) return res.json({ result: {} });
      const cid = me.company_id;
      if (!cid) return res.json({ result: {} });
      const sofors = await pool.query('SELECT email FROM users WHERE company_id = $1', [cid]);
      const emails = sofors.rows.map(u => u.email);
      if (!emails.length) return res.json({ result: {} });

      // Top-szintű szöveges mezők (egyedi, nem üres) — egy lekérdezésben.
      const topR = await pool.query(
        `SELECT
           array_agg(DISTINCT nume_sofer)    FILTER (WHERE COALESCE(TRIM(nume_sofer),'')    <> '') AS nume_sofer,
           array_agg(DISTINCT numar_camion)  FILTER (WHERE COALESCE(TRIM(numar_camion),'')  <> '') AS numar_camion,
           array_agg(DISTINCT numar_remorca) FILTER (WHERE COALESCE(TRIM(numar_remorca),'') <> '') AS numar_remorca,
           array_agg(DISTINCT alte_mentiuni) FILTER (WHERE COALESCE(TRIM(alte_mentiuni),'') <> '') AS alte_mentiuni
         FROM fuvarlevelek WHERE email_sofer = ANY($1)`,
        [emails]
      );
      // Beágyazott JSONB tömbök kulcsai (puncte / alimentari / achizitii).
      const pctR = await pool.query(
        `SELECT
           array_agg(DISTINCT TRIM(e->>'tip')) FILTER (WHERE COALESCE(TRIM(e->>'tip'),'') <> '') AS tip,
           array_agg(DISTINCT TRIM(e->>'loc')) FILTER (WHERE COALESCE(TRIM(e->>'loc'),'') <> '') AS loc
         FROM fuvarlevelek f, jsonb_array_elements(f.puncte) e
         WHERE f.email_sofer = ANY($1)`,
        [emails]
      );
      const alimR = await pool.query(
        `SELECT
           array_agg(DISTINCT TRIM(e->>'loc'))   FILTER (WHERE COALESCE(TRIM(e->>'loc'),'')   <> '') AS loc,
           array_agg(DISTINCT TRIM(e->>'tip'))   FILTER (WHERE COALESCE(TRIM(e->>'tip'),'')   <> '') AS tip,
           array_agg(DISTINCT TRIM(e->>'plata')) FILTER (WHERE COALESCE(TRIM(e->>'plata'),'') <> '') AS plata
         FROM fuvarlevelek f, jsonb_array_elements(f.alimentari) e
         WHERE f.email_sofer = ANY($1)`,
        [emails]
      );
      const achR = await pool.query(
        `SELECT
           array_agg(DISTINCT TRIM(e->>'loc'))    FILTER (WHERE COALESCE(TRIM(e->>'loc'),'')    <> '') AS loc,
           array_agg(DISTINCT TRIM(e->>'produs')) FILTER (WHERE COALESCE(TRIM(e->>'produs'),'') <> '') AS produs,
           array_agg(DISTINCT TRIM(e->>'plata'))  FILTER (WHERE COALESCE(TRIM(e->>'plata'),'')  <> '') AS plata
         FROM fuvarlevelek f, jsonb_array_elements(f.achizitii) e
         WHERE f.email_sofer = ANY($1)`,
        [emails]
      );

      const t = topR.rows[0] || {}, p = pctR.rows[0] || {}, a = alimR.rows[0] || {}, c = achR.rows[0] || {};
      // Mezőnként legfeljebb 300 javaslat (rendezve), üres tömb ha nincs.
      const cap = (arr) => (Array.isArray(arr) ? arr.filter(Boolean).sort((x, y) => String(x).localeCompare(String(y))).slice(0, 300) : []);
      return res.json({ result: {
        nume_sofer:    cap(t.nume_sofer),
        numar_camion:  cap(t.numar_camion),
        numar_remorca: cap(t.numar_remorca),
        alte_mentiuni: cap(t.alte_mentiuni),
        punct_tip:     cap(p.tip),
        punct_loc:     cap(p.loc),
        alim_loc:      cap(a.loc),
        alim_tip:      cap(a.tip),
        alim_plata:    cap(a.plata),
        ach_loc:       cap(c.loc),
        ach_produs:    cap(c.produs),
        ach_plata:     cap(c.plata)
      } });
    } catch (err) {
      console.error('getFuvarlevelFieldSuggestions hiba:', err);
      return res.json({ result: {} });
    }
  };

handlers.getDriverDocs = async function (req, res, args) {
    try {
      if (!req.session.user) return res.json({ result: [] });
      const cid = req.session.user.company_id;
      const isAdmin = ['Admin', 'Manager'].includes(req.session.user.pozicio);
      const r = isAdmin
        ? await pool.query('SELECT d.id, d.email_sofer, d.nume_sofer, d.tip, d.file_name, d.order_id, d.created_at FROM documents d JOIN users u ON u.email = d.email_sofer WHERE u.company_id = $1 ORDER BY d.created_at DESC LIMIT 200', [cid])
        : await pool.query('SELECT id, email_sofer, nume_sofer, tip, file_name, order_id, created_at FROM documents WHERE email_sofer = $1 ORDER BY created_at DESC LIMIT 200', [req.session.user.email]);
      return res.json({ result: r.rows });
    } catch (err) {
      console.error('getDriverDocs hiba:', err);
      return res.json({ result: [] });
    }
  };

handlers.getBorderLogs = async function (req, res, args) {
    try {
      if (!req.session.user) return res.json({ result: [] });
      const cid = req.session.user.company_id;
      const isAdmin = ['Admin', 'Manager'].includes(req.session.user.pozicio);
      const r = isAdmin
        ? await pool.query('SELECT bc.* FROM border_crossings bc JOIN users u ON u.email = bc.email_sofer WHERE u.company_id = $1 ORDER BY bc.created_at DESC LIMIT 200', [cid])
        : await pool.query('SELECT * FROM border_crossings WHERE email_sofer = $1 ORDER BY created_at DESC LIMIT 200', [req.session.user.email]);
      return res.json({ result: r.rows });
    } catch (err) {
      console.error('getBorderLogs hiba:', err);
      return res.json({ result: [] });
    }
  };

module.exports = handlers;
