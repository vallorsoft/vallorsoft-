/* ============================================================
 *  VallorSoft — public/pdf-gallery.js
 *  Beépített PDF-sablon presetek (MINDEN cég számára elérhető).
 *
 *  A presetek kódból jönnek (nem cégenkénti DB-tétel) → mindenki ugyanazt
 *  a kínálatot látja. A felhasználó egy kattintással betölti a PDF-sablon
 *  űrlapba (fejléc/lábléc/akcent/logó), ott testreszabja, majd SAJÁT
 *  sablonként menti (gas('pdfTemplateSave')).
 *
 *  Az ELSŐ preset minden típusnál az „Implicit (sistem)" — ez tükrözi azt
 *  a kinézetet, amit a rendszer automatikusan kitölt; így a meglévő,
 *  rendszer-alapértelmezett is választható/szerkeszthető tételként jelenik meg.
 *
 *  A fejléc/lábléc szabad szöveg — a [szögletes] részeket a cég a saját
 *  adataira cseréli. Akcent-szín: HEX; üres = a márka-szín öröklődik.
 * ============================================================ */
(function () {
  'use strict';

  // Doc-típus független stílus-variánsok (a fejléc/lábléc típusonként más).
  // Mindegyik típushoz: Implicit (sistem) + Minimalist + Corporate + Apus (warm).
  function build(headerDefault, footerDefault) {
    return [
      { key: 'system',
        name: { hu: '⭐ Alapértelmezett (rendszer)', ro: '⭐ Implicit (sistem)' },
        header_text: headerDefault.system,
        footer_text: footerDefault.system,
        accent_color: null,            // örökli a márka-színt
        show_logo: true },

      { key: 'minimal',
        name: { hu: '◻️ Minimalista', ro: '◻️ Minimalist' },
        header_text: headerDefault.minimal,
        footer_text: '',
        accent_color: '#334155',
        show_logo: true },

      { key: 'corporate',
        name: { hu: '🏢 Céges (formális)', ro: '🏢 Corporate (formal)' },
        header_text: headerDefault.corporate,
        footer_text: footerDefault.corporate,
        accent_color: '#1e3a8a',
        show_logo: true },

      { key: 'sunset',
        name: { hu: '🌅 Napnyugta (meleg)', ro: '🌅 Apus (cald)' },
        header_text: headerDefault.sunset,
        footer_text: footerDefault.sunset,
        accent_color: '#f6711e',
        show_logo: true },
    ];
  }

  var FOOTER_LEGAL = '[Denumire firmă] · CUI [______] · Reg. Com. [J__/____/____]\nIBAN [RO__ ____ ____ ____ ____ ____] · Banca [______]';
  var FOOTER_THANKS_RO = 'Vă mulțumim! · [Telefon] · [E-mail] · [Adresă]';

  window.PDF_PRESETS = {

    // ── Fuvar-lista (nyomtatás/export) — ez a VALÓDI bekötött kimenet ──
    order: build(
      {
        system:    '[Denumire firmă]\nCUI [______] · [Adresă completă]\nTel: [______] · E-mail: [______]',
        minimal:   '[Denumire firmă]',
        corporate: '[DENUMIRE FIRMĂ] S.R.L.\nSediu social: [Adresă] · CUI: [______] · Reg. Com.: [J__/____/____]\nContact: [Telefon] · [E-mail] · [Website]',
        sunset:    '🚚 [Denumire firmă] — Listă transporturi\n[Adresă] · [Telefon]',
      },
      {
        system:    'Document generat automat din sistemul VallorSoft.',
        corporate: FOOTER_LEGAL,
        sunset:    FOOTER_THANKS_RO,
      }
    ),

    // ── Menetlevél / Foaie de parcurs ──
    waybill: build(
      {
        system:    '[Denumire firmă]\nFoaie de parcurs · CUI [______]',
        minimal:   '[Denumire firmă] · Foaie de parcurs',
        corporate: '[DENUMIRE FIRMĂ] S.R.L.\nFOAIE DE PARCURS · Sediu: [Adresă] · CUI: [______]\nAutovehicul: [Nr. înmatriculare] · Șofer: [Nume]',
        sunset:    '🧾 Foaie de parcurs — [Denumire firmă]',
      },
      {
        system:    'Semnătura conducătorului auto: ____________________',
        corporate: 'Semnătură șofer: __________  ·  Semnătură dispecer: __________\n' + FOOTER_LEGAL,
        sunset:    'Drum bun! · [Telefon dispecerat]',
      }
    ),

    // ── CMR / e-CMR ──
    cmr: build(
      {
        system:    '[Denumire firmă]\nScrisoare de transport CMR · CUI [______]',
        minimal:   '[Denumire firmă] · CMR',
        corporate: '[DENUMIRE FIRMĂ] S.R.L.\nSCRISOARE DE TRANSPORT INTERNAȚIONAL (CMR)\nExpeditor: [______] · Transportator: [______] · Destinatar: [______]',
        sunset:    '📄 CMR — [Denumire firmă]',
      },
      {
        system:    'Conform Convenției CMR (Geneva, 1956).',
        corporate: 'Mențiuni speciale: ____________________\nConform Convenției CMR (1956). · ' + FOOTER_LEGAL,
        sunset:    'Mulțumim pentru colaborare!',
      }
    ),

    // ── Számla-kísérő / megjegyzés ──
    invoice_note: build(
      {
        system:    '[Denumire firmă]\nNotă de însoțire factură · CUI [______]',
        minimal:   '[Denumire firmă]',
        corporate: '[DENUMIRE FIRMĂ] S.R.L.\nNOTĂ DE ÎNSOȚIRE · Sediu: [Adresă] · CUI: [______]\nClient: [______] · Factura: [Serie/Număr]',
        sunset:    '🧾 [Denumire firmă] — Notă factură',
      },
      {
        system:    'Termen de plată: [__] zile. · IBAN [______]',
        corporate: 'Vă rugăm efectuați plata în [__] zile la IBAN [______].\n' + FOOTER_LEGAL,
        sunset:    'Vă mulțumim pentru încredere! · [Telefon]',
      }
    ),
  };

  // Egyszerű kétnyelvű név-feloldó (a UI használja).
  window.pdfPresetName = function (p) {
    var lang = 'ro';
    try { if (window.I18N && typeof I18N.get === 'function') lang = I18N.get(); } catch (e) {}
    if (p && p.name && typeof p.name === 'object') return p.name[lang] || p.name.ro || p.name.hu || p.key;
    return (p && (p.name || p.key)) || '';
  };
})();
