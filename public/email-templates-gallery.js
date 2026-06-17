/* ============================================================
 *  VallorSoft — public/email-templates-gallery.js
 *  Beépített TRANZAKCIÓS e-mail-sablon presetek (MINDEN cég számára).
 *
 *  Kulcsonként (order_confirm_carrier / order_status_change / quote_send /
 *  invoice_notify / generic) legalább 3 kész, kétnyelvű (RO + HU) változat.
 *  A felhasználó egy kattintással betölti a sablon-kártyába (Tárgy/Törzs RO+HU),
 *  testreszabja, majd SAJÁT sablonként menti (gas('emailTemplateSave')).
 *
 *  Az ELSŐ preset minden kulcsnál az „Implicit (rendszer)" — a meglévő
 *  alapértelmezett, hogy az is választható/visszaállítható maradjon.
 *  A {{változók}} kiküldéskor töltődnek ki (escape-elve, nincs injekció).
 * ============================================================ */
(function () {
  'use strict';

  window.ETPL_PRESETS = {

    // ── Fuvar-visszaigazolás (fuvarozónak) ──
    order_confirm_carrier: [
      { name: { hu: '⭐ Implicit', ro: '⭐ Implicit' },
        subject_ro: 'Confirmare transport {{order_id}}',
        subject_hu: 'Fuvar-visszaigazolás {{order_id}}',
        body_ro: '<p>Bună ziua,</p><p>Confirmăm transportul <b>{{order_id}}</b> pe ruta <b>{{route}}</b>.</p><p>Vă mulțumim pentru colaborare.</p>',
        body_hu: '<p>Jó napot,</p><p>Visszaigazoljuk a(z) <b>{{order_id}}</b> fuvart a(z) <b>{{route}}</b> útvonalon.</p><p>Köszönjük az együttműködést.</p>' },

      { name: { hu: '🏢 Formális (részletes)', ro: '🏢 Formal (detaliat)' },
        subject_ro: 'Confirmare comandă de transport nr. {{order_id}}',
        subject_hu: 'Fuvarmegrendelés visszaigazolása — {{order_id}}',
        body_ro: '<p>Stimate partener,</p><p>Prin prezenta confirmăm acceptarea comenzii de transport <b>{{order_id}}</b> pentru ruta <b>{{route}}</b>, client <b>{{client}}</b>.</p><p>Vă rugăm să respectați condițiile agreate (termen de încărcare/descărcare, documente CMR). Pentru orice modificare, contactați dispeceratul.</p><p>Cu stimă,<br>Echipa de dispecerat</p>',
        body_hu: '<p>Tisztelt Partnerünk,</p><p>Ezúton visszaigazoljuk a(z) <b>{{order_id}}</b> fuvarmegrendelés elfogadását a(z) <b>{{route}}</b> útvonalra, megrendelő: <b>{{client}}</b>.</p><p>Kérjük a megállapodott feltételek betartását (fel-/lerakási idő, CMR-dokumentumok). Bármilyen módosításért keresse a diszpécserünket.</p><p>Üdvözlettel,<br>A diszpécser csapat</p>' },

      { name: { hu: '😊 Barátságos (rövid)', ro: '😊 Prietenos (scurt)' },
        subject_ro: '✅ Transport confirmat — {{route}}',
        subject_hu: '✅ Fuvar megerősítve — {{route}}',
        body_ro: '<p>Salut!</p><p>Transportul <b>{{order_id}}</b> ({{route}}) este confirmat. 🚚</p><p>Drum bun și mulțumim!</p>',
        body_hu: '<p>Szia!</p><p>A(z) <b>{{order_id}}</b> fuvar ({{route}}) megerősítve. 🚚</p><p>Jó utat és köszönjük!</p>' },
    ],

    // ── Fuvar státusz-változás ──
    order_status_change: [
      { name: { hu: '⭐ Implicit', ro: '⭐ Implicit' },
        subject_ro: 'Actualizare status transport {{order_id}}',
        subject_hu: 'Fuvar státusz-változás {{order_id}}',
        body_ro: '<p>Bună ziua,</p><p>Statusul transportului <b>{{order_id}}</b> ({{route}}) s-a schimbat în: <b>{{status}}</b>.</p>',
        body_hu: '<p>Jó napot,</p><p>A(z) <b>{{order_id}}</b> fuvar ({{route}}) státusza megváltozott: <b>{{status}}</b>.</p>' },

      { name: { hu: '🏢 Formális', ro: '🏢 Formal' },
        subject_ro: 'Notificare status — comanda {{order_id}}',
        subject_hu: 'Státusz-értesítő — {{order_id}} megrendelés',
        body_ro: '<p>Stimate client,</p><p>Vă informăm că transportul <b>{{order_id}}</b> pe ruta <b>{{route}}</b> a trecut în statusul <b>{{status}}</b>.</p><p>Puteți urmări evoluția în timp real prin linkul de tracking primit. Vă mulțumim.</p>',
        body_hu: '<p>Tisztelt Ügyfelünk,</p><p>Tájékoztatjuk, hogy a(z) <b>{{order_id}}</b> fuvar a(z) <b>{{route}}</b> útvonalon a következő státuszba lépett: <b>{{status}}</b>.</p><p>A folyamatot valós időben követheti a kapott tracking-linken. Köszönjük.</p>' },

      { name: { hu: '😊 Rövid értesítő', ro: '😊 Notă scurtă' },
        subject_ro: '🔔 {{order_id}}: {{status}}',
        subject_hu: '🔔 {{order_id}}: {{status}}',
        body_ro: '<p>Transportul <b>{{order_id}}</b> ({{route}}) este acum: <b>{{status}}</b>.</p>',
        body_hu: '<p>A(z) <b>{{order_id}}</b> fuvar ({{route}}) mostantól: <b>{{status}}</b>.</p>' },
    ],

    // ── Árajánlat küldése ──
    quote_send: [
      { name: { hu: '⭐ Implicit', ro: '⭐ Implicit' },
        subject_ro: 'Ofertă de preț — {{route}}',
        subject_hu: 'Árajánlat — {{route}}',
        body_ro: '<p>Stimate {{client}},</p><p>Vă transmitem oferta noastră pentru transportul pe ruta <b>{{route}}</b>: <b>{{pret}}</b>.</p><p>Așteptăm confirmarea dvs.</p>',
        body_hu: '<p>Tisztelt {{client}},</p><p>Az alábbi ajánlatot küldjük a(z) <b>{{route}}</b> útvonalra: <b>{{pret}}</b>.</p><p>Várjuk visszajelzését.</p>' },

      { name: { hu: '🏢 Részletes ajánlat', ro: '🏢 Ofertă detaliată' },
        subject_ro: 'Ofertă transport {{route}} — valabilă 7 zile',
        subject_hu: 'Fuvarajánlat {{route}} — 7 napig érvényes',
        body_ro: '<p>Stimate {{client}},</p><p>Vă mulțumim pentru solicitare. Vă prezentăm oferta noastră:</p><ul><li>Rută: <b>{{route}}</b></li><li>Tarif: <b>{{pret}}</b> (TVA inclus)</li><li>Termen estimat de livrare conform discuției</li></ul><p>Oferta este valabilă 7 zile. Pentru confirmare, răspundeți la acest e-mail.</p><p>Cu stimă,<br>Departament comercial</p>',
        body_hu: '<p>Tisztelt {{client}},</p><p>Köszönjük megkeresését. Az alábbi ajánlatot tesszük:</p><ul><li>Útvonal: <b>{{route}}</b></li><li>Díj: <b>{{pret}}</b> (ÁFA-val)</li><li>Becsült szállítási határidő egyeztetés szerint</li></ul><p>Az ajánlat 7 napig érvényes. Megerősítéshez válaszoljon erre az e-mailre.</p><p>Üdvözlettel,<br>Kereskedelmi osztály</p>' },

      { name: { hu: '😊 Barátságos', ro: '😊 Prietenos' },
        subject_ro: '💶 Oferta ta pentru {{route}}',
        subject_hu: '💶 Ajánlatod: {{route}}',
        body_ro: '<p>Bună {{client}}!</p><p>Pentru ruta <b>{{route}}</b> prețul nostru este <b>{{pret}}</b>. Spune-ne dacă e ok și pornim! 🚚</p>',
        body_hu: '<p>Szia {{client}}!</p><p>A(z) <b>{{route}}</b> útvonalra az árunk <b>{{pret}}</b>. Szólj, ha jó, és indulhatunk! 🚚</p>' },
    ],

    // ── Számla-értesítő ──
    invoice_notify: [
      { name: { hu: '⭐ Implicit', ro: '⭐ Implicit' },
        subject_ro: 'Factură {{invoice_no}}',
        subject_hu: 'Számla {{invoice_no}}',
        body_ro: '<p>Stimate {{client}},</p><p>Vă transmitem factura <b>{{invoice_no}}</b> aferentă transportului <b>{{order_id}}</b>.</p>',
        body_hu: '<p>Tisztelt {{client}},</p><p>Mellékelten küldjük a(z) <b>{{invoice_no}}</b> számlát a(z) <b>{{order_id}}</b> fuvarhoz.</p>' },

      { name: { hu: '🏢 Fizetési felszólítással', ro: '🏢 Cu termen de plată' },
        subject_ro: 'Factura {{invoice_no}} — scadență',
        subject_hu: 'Számla {{invoice_no}} — fizetési határidő',
        body_ro: '<p>Stimate {{client}},</p><p>Atașat găsiți factura <b>{{invoice_no}}</b> pentru transportul <b>{{order_id}}</b>.</p><p>Vă rugăm să efectuați plata până la termenul scadent menționat pe factură. Pentru întrebări legate de factură, ne puteți contacta oricând.</p><p>Cu stimă,<br>Departament financiar</p>',
        body_hu: '<p>Tisztelt {{client}},</p><p>Mellékelten küldjük a(z) <b>{{invoice_no}}</b> számlát a(z) <b>{{order_id}}</b> fuvarhoz.</p><p>Kérjük, a számlán feltüntetett fizetési határidőig rendezze az összeget. Számlával kapcsolatos kérdés esetén állunk rendelkezésére.</p><p>Üdvözlettel,<br>Pénzügyi osztály</p>' },

      { name: { hu: '😊 Köszönő hangvétel', ro: '😊 Cu mulțumire' },
        subject_ro: '🧾 Factura {{invoice_no}} — mulțumim!',
        subject_hu: '🧾 Számla {{invoice_no}} — köszönjük!',
        body_ro: '<p>Bună {{client}},</p><p>Mulțumim pentru colaborare! Atașăm factura <b>{{invoice_no}}</b> ({{order_id}}). O zi bună! 🙂</p>',
        body_hu: '<p>Szia {{client}},</p><p>Köszönjük az együttműködést! Csatoljuk a(z) <b>{{invoice_no}}</b> számlát ({{order_id}}). Szép napot! 🙂</p>' },
    ],

    // ── Általános ──
    generic: [
      { name: { hu: '⭐ Implicit', ro: '⭐ Implicit' },
        subject_ro: '{{subject}}',
        subject_hu: '{{subject}}',
        body_ro: '<p>{{message}}</p>',
        body_hu: '<p>{{message}}</p>' },

      { name: { hu: '🏢 Levél-keret', ro: '🏢 Format scrisoare' },
        subject_ro: '{{subject}}',
        subject_hu: '{{subject}}',
        body_ro: '<p>Stimate client,</p><p>{{message}}</p><p>Cu stimă,<br>Echipa {{cegnev}}</p>',
        body_hu: '<p>Tisztelt Ügyfelünk,</p><p>{{message}}</p><p>Üdvözlettel,<br>A(z) {{cegnev}} csapata</p>' },

      { name: { hu: '😊 Barátságos', ro: '😊 Prietenos' },
        subject_ro: '{{subject}}',
        subject_hu: '{{subject}}',
        body_ro: '<p>Salut! 👋</p><p>{{message}}</p><p>O zi bună!</p>',
        body_hu: '<p>Szia! 👋</p><p>{{message}}</p><p>Szép napot!</p>' },
    ],
  };

  window.etplPresetName = function (p) {
    var lang = 'ro';
    try { if (window.I18N && typeof I18N.get === 'function') lang = I18N.get(); } catch (e) {}
    if (p && p.name && typeof p.name === 'object') return p.name[lang] || p.name.ro || p.name.hu || '';
    return (p && p.name) || '';
  };
})();
