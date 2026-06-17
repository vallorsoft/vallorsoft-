// public/pdf-settings.js
// PDF-sablon beállítások (MVP) — dokumentumtípusonkénti testreszabás.
// PdfSettings.mount('pdfSettingsBox') a fül megnyitásakor (admin + manager).
//
// ÚJRAHASZNÁLT backend (NEM duplikálunk):
//   gas('pdfTemplateList') / gas('pdfTemplateSave')
//     -> pdf_templates (header_text/footer_text/accent_color/show_logo)
//        + a logó/alap szín a company_branding-ből (örökölt, csak felülírható).
//   A logó-előnézet a hitelesített REST /api/branding/logo-ból jön.
// A meglévő gas()/toast()/t() segédeket használja (console-shared.js + i18n.js).
//
// FONTOS: a SZÁMLÁK kinézetét a számlázó-szolgáltató (FGO/SmartBill/Oblio…)
// adja — azt NEM tudjuk testreszabni; ez az MVP a saját, kliens-oldalon
// generált kimenetekre vonatkozik (jelenleg a Fuvar-lista nyomtatás/export).
window.PdfSettings = (function () {
  function tt(key, fb) {
    try { if (typeof t === 'function') { var v = t(key); if (v && v !== key) return v; } } catch (e) {}
    return fb;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
    });
  }

  var _root = null;
  var _canEdit = false;
  var _state = {};       // doc_type -> template
  var _brandColor = null;
  var _hasLogo = false;
  var _logoDataUri = null;
  var _active = 'order';

  // Megjelenített típus-címkék (i18n-kulccsal + fallback).
  function docLabel(dt) {
    var map = {
      order:        tt('pdfset.dtOrder',       'Fuvar-lista (nyomtatás/export)'),
      waybill:      tt('pdfset.dtWaybill',     'Menetlevél'),
      cmr:          tt('pdfset.dtCmr',         'CMR / e-CMR'),
      invoice_note: tt('pdfset.dtInvoiceNote', 'Számla-kísérő / megjegyzés'),
    };
    return map[dt] || dt;
  }

  // Melyik típusra van VALÓDI kimenet bekötve (csak vizuális jelzés).
  function isWired(dt) { return dt === 'order'; }

  function render(root) {
    var disabled = _canEdit ? '' : ' disabled';
    var tabsHtml = _state.length ? _state.map(function (tpl) {
      var on = tpl.doc_type === _active;
      return '<button class="btn ' + (on ? 'primary' : 'ghost') + '" style="padding:7px 14px;font-size:13px;" ' +
        'onclick="PdfSettings.select(\'' + tpl.doc_type + '\')">' + esc(docLabel(tpl.doc_type)) +
        (isWired(tpl.doc_type) ? '' : ' <span style="font-size:10px;opacity:0.7;">·</span>') + '</button>';
    }).join('') : '';

    root.innerHTML =
      '<div class="glass" style="padding:22px;max-width:980px;">' +
        '<h2 class="h-title" style="margin-top:0;">' + tt('pdfset.title', '📄 PDF-sablonok') + '</h2>' +
        '<p style="color:var(--muted);font-size:13px;margin:0 0 6px;">' + tt('pdfset.intro', 'A kimenő dokumentumok fejléce, lábléce, akcent-színe és logó-megjelenítése dokumentumtípusonként.') + '</p>' +
        '<div class="badge info" style="margin-bottom:12px;">' + tt('pdfset.invoiceNote', 'A számlák kinézetét a számlázó-szolgáltató adja — azt itt nem szabjuk testre.') + '</div>' +
        (!_canEdit ? '<div class="badge warn" style="margin-bottom:14px;">' + tt('pdfset.readOnly', 'Csak megtekintés (a beállításokat az Admin módosíthatja).') + '</div>' : '') +

        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">' + tabsHtml + '</div>' +

        presetsHtml() +

        '<div class="grid-2" style="gap:22px;align-items:start;">' +
          // ── Bal: űrlap ──
          '<div>' +
            '<div class="field"><label>' + tt('pdfset.headerText', 'Fejléc szöveg') + '</label>' +
              '<textarea class="textarea" id="psHeader" rows="3" maxlength="600"' + disabled + ' placeholder="' + tt('pdfset.headerPh', 'Cégnév, cím, CUI, kapcsolat — a dokumentum tetején.') + '"></textarea>' +
            '</div>' +
            '<div class="field"><label>' + tt('pdfset.footerText', 'Lábléc szöveg') + '</label>' +
              '<textarea class="textarea" id="psFooter" rows="2" maxlength="600"' + disabled + ' placeholder="' + tt('pdfset.footerPh', 'Pl. banki adatok, jogi megjegyzés — a dokumentum alján.') + '"></textarea>' +
            '</div>' +
            '<div class="field"><label>' + tt('pdfset.accentColor', 'Akcent-szín') + '</label>' +
              '<div style="display:flex;gap:10px;align-items:center;">' +
                '<input type="color" id="psAccent"' + disabled + ' style="width:48px;height:38px;border:none;background:none;padding:0;cursor:pointer;">' +
                '<input class="input" id="psAccentHex" placeholder="' + esc(_brandColor || '#f6711e') + '" maxlength="9"' + disabled + ' style="max-width:130px;">' +
                '<span style="font-size:11px;color:var(--muted);">' + tt('pdfset.accentHint', 'Üres = a márka-szín öröklődik.') + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="field"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;">' +
              '<input type="checkbox" id="psShowLogo"' + disabled + (_hasLogo ? '' : ' disabled') + '> ' +
              tt('pdfset.showLogo', 'Logó megjelenítése') +
              (_hasLogo ? '' : ' <span style="font-size:11px;color:var(--muted);">(' + tt('pdfset.noLogo', 'nincs feltöltött logó — a Cég & arculat fülön tölthető fel') + ')</span>') +
            '</label></div>' +
            (_canEdit
              ? '<div style="margin-top:18px;"><button class="btn primary" id="psSaveBtn" style="padding:11px 26px;">💾 ' + tt('common.save', 'Mentés') + '</button></div>'
              : '') +
          '</div>' +

          // ── Jobb: élő előnézet (a PDF fejléc HTML-közelítése) ──
          '<div>' +
            '<div style="font-size:12px;color:var(--muted);margin-bottom:6px;">' + tt('pdfset.previewLabel', 'Előnézet (közelítés)') + '</div>' +
            '<div id="psPreview" style="border:1px solid var(--border);border-radius:10px;overflow:hidden;background:#fff;color:#111;"></div>' +
            (isWired(_active)
              ? '<div style="font-size:11px;color:var(--ok);margin-top:8px;">✓ ' + tt('pdfset.wired', 'Ez a típus bekötve a Fuvar-lista nyomtatás/export kimenetbe.') + '</div>'
              : '<div style="font-size:11px;color:var(--muted);margin-top:8px;">' + tt('pdfset.notWired', 'A beállítás elmentődik; e típushoz egyelőre nincs saját PDF-kimenet bekötve.') + '</div>') +
          '</div>' +
        '</div>' +
      '</div>';

    // Mezők feltöltése az aktív típus értékeivel
    var tpl = currentTpl();
    var hdr = root.querySelector('#psHeader'); if (hdr) hdr.value = tpl.header_text || '';
    var ftr = root.querySelector('#psFooter'); if (ftr) ftr.value = tpl.footer_text || '';
    var color = tpl.accent_color || _brandColor || '#f6711e';
    var picker = root.querySelector('#psAccent'); if (picker) picker.value = color;
    var hex = root.querySelector('#psAccentHex'); if (hex) hex.value = tpl.accent_color || '';
    var sl = root.querySelector('#psShowLogo'); if (sl) sl.checked = tpl.show_logo !== false;

    // Élő előnézet-frissítés
    function bindLive(el, ev) { if (el) el.addEventListener(ev, updatePreview); }
    bindLive(hdr, 'input'); bindLive(ftr, 'input'); bindLive(sl, 'change');
    if (_canEdit && picker && hex) {
      picker.addEventListener('input', function () { hex.value = picker.value; updatePreview(); });
      hex.addEventListener('input', function () {
        var v = hex.value.trim(); if (v && v[0] !== '#') v = '#' + v;
        if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) { picker.value = v; }
        updatePreview();
      });
    }
    var sb = root.querySelector('#psSaveBtn'); if (sb) sb.addEventListener('click', save);

    // Logó-előnézet betöltése egyszer
    if (_hasLogo && _logoDataUri == null) {
      fetch('/api/branding/logo').then(function (r) { return r.json(); }).then(function (lg) {
        if (lg && lg.has && lg.dataUri) { _logoDataUri = lg.dataUri; updatePreview(); }
      }).catch(function () {});
    }
    updatePreview();
  }

  // ── Kész sablonok (presetek) sora — mindenki számára elérhető, szerkeszthető ──
  function presetsHtml() {
    var list = (window.PDF_PRESETS && window.PDF_PRESETS[_active]) || [];
    if (!list.length) return '';
    var nameOf = window.pdfPresetName || function (p) { return (p && (p.name && (p.name.ro || p.name.hu) || p.key)) || ''; };
    var btns = list.map(function (p, i) {
      var sw = p.accent_color
        ? '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + esc(p.accent_color) + ';margin-right:6px;vertical-align:middle;"></span>'
        : '';
      return '<button class="btn ghost" style="padding:7px 12px;font-size:12px;"' + (_canEdit ? '' : ' disabled') +
        ' onclick="PdfSettings.applyPreset(' + i + ')">' + sw + esc(nameOf(p)) + '</button>';
    }).join('');
    return '<div style="margin-bottom:16px;">' +
      '<div style="font-size:12px;color:var(--muted);margin-bottom:6px;">' +
        tt('pdfset.presets', '✨ Kész sablonok — kattints a betöltéshez, majd szabd testre és mentsd') + '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' + btns + '</div>' +
    '</div>';
  }

  // Preset betöltése az űrlapba (NEM ment automatikusan — a felhasználó áttekinti és menti).
  function applyPreset(idx) {
    if (!_canEdit || !_root) return;
    var list = (window.PDF_PRESETS && window.PDF_PRESETS[_active]) || [];
    var p = list[idx];
    if (!p) return;
    var hdr = _root.querySelector('#psHeader'); if (hdr) hdr.value = p.header_text || '';
    var ftr = _root.querySelector('#psFooter'); if (ftr) ftr.value = p.footer_text || '';
    var hex = _root.querySelector('#psAccentHex'); if (hex) hex.value = p.accent_color || '';
    var picker = _root.querySelector('#psAccent'); if (picker) picker.value = p.accent_color || _brandColor || '#f6711e';
    var sl = _root.querySelector('#psShowLogo'); if (sl && !sl.disabled) sl.checked = p.show_logo !== false;
    updatePreview();
    toast(tt('pdfset.presetLoaded', 'Sablon betöltve — szabd testre és mentsd'), 'ok');
  }

  function currentTpl() {
    for (var i = 0; i < _state.length; i++) if (_state[i].doc_type === _active) return _state[i];
    return { doc_type: _active, show_logo: true };
  }

  function formAccent() {
    var hex = ((_root.querySelector('#psAccentHex') || {}).value || '').trim();
    if (hex && hex[0] !== '#') hex = '#' + hex;
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex)) return hex;
    return _brandColor || '#f6711e';
  }

  function updatePreview() {
    if (!_root) return;
    var box = _root.querySelector('#psPreview');
    if (!box) return;
    var hdr = ((_root.querySelector('#psHeader') || {}).value || '').trim();
    var ftr = ((_root.querySelector('#psFooter') || {}).value || '').trim();
    var accent = formAccent();
    var showLogo = !!((_root.querySelector('#psShowLogo') || {}).checked) && _hasLogo;
    box.innerHTML =
      '<div style="padding:14px 16px;border-bottom:3px solid ' + esc(accent) + ';display:flex;gap:12px;align-items:center;">' +
        (showLogo && _logoDataUri ? '<img src="' + esc(_logoDataUri) + '" style="max-height:42px;max-width:120px;">' : '') +
        '<div style="white-space:pre-wrap;font-size:12px;font-weight:600;color:#111;">' + (hdr ? esc(hdr) : '<span style="color:#aaa;font-weight:400;">' + tt('pdfset.previewHdrEmpty', '(nincs fejléc szöveg)') + '</span>') + '</div>' +
      '</div>' +
      '<div style="padding:18px 16px;color:#888;font-size:11px;font-style:italic;">' + tt('pdfset.previewBody', '… a dokumentum tartalma …') + '</div>' +
      (ftr ? '<div style="padding:10px 16px;border-top:1px solid #eee;font-size:11px;color:#555;white-space:pre-wrap;">' + esc(ftr) + '</div>' : '');
  }

  function select(dt) {
    // Aktuális űrlapérték mentése a state-be (váltás előtt, hogy ne vesszen el)
    snapshotActive();
    _active = dt;
    render(_root);
  }

  function snapshotActive() {
    if (!_root) return;
    var tpl = currentTpl();
    var hdr = _root.querySelector('#psHeader'); if (hdr) tpl.header_text = hdr.value;
    var ftr = _root.querySelector('#psFooter'); if (ftr) tpl.footer_text = ftr.value;
    var hex = ((_root.querySelector('#psAccentHex') || {}).value || '').trim();
    tpl.accent_color = hex || null;
    var sl = _root.querySelector('#psShowLogo'); if (sl) tpl.show_logo = sl.checked;
  }

  function save() {
    snapshotActive();
    var payload = {
      docType: _active,
      headerText: (_root.querySelector('#psHeader') || {}).value || '',
      footerText: (_root.querySelector('#psFooter') || {}).value || '',
      accentColor: ((_root.querySelector('#psAccentHex') || {}).value || '').trim() || null,
      showLogo: !!((_root.querySelector('#psShowLogo') || {}).checked),
    };
    gas('pdfTemplateSave', [payload]).then(function (r) {
      if (r && r.ok) {
        toast(tt('common.saved', 'Mentve'), 'ok');
        // a frissen mentett értékeket a globális gyorsítótárba is (a nyomtatás ezt használja)
        if (window._vsPdfTemplates) window._vsPdfTemplates[_active] = currentTpl();
      } else {
        toast((r && r.err) || tt('common.error', 'Hiba'), 'err');
      }
    }).catch(function () { toast(tt('common.error', 'Hiba'), 'err'); });
  }

  function mount(boxId) {
    _root = document.getElementById(boxId);
    if (!_root) return;
    _root.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px;"><div class="spinner" style="margin:0 auto 10px;"></div></div>';
    gas('pdfTemplateList').then(function (d) {
      if (!d || !d.ok) { _root.innerHTML = '<div class="glass" style="padding:20px;color:var(--muted);">' + tt('common.loadError', 'Betöltési hiba') + '</div>'; return; }
      _state = d.templates || [];
      _brandColor = d.brandColor || null;
      _hasLogo = !!d.hasLogo;
      _canEdit = !!d.canEdit;
      _logoDataUri = null;
      if (!_state.some(function (x) { return x.doc_type === _active; }) && _state.length) _active = _state[0].doc_type;
      // globális gyorsítótár a nyomtatás-bekötéshez (lásd console-shared.js downloadSelectedOrders)
      var byType = {}; _state.forEach(function (x) { byType[x.doc_type] = x; });
      window._vsPdfTemplates = byType;
      render(_root);
    }).catch(function () { _root.innerHTML = '<div class="glass" style="padding:20px;color:var(--muted);">' + tt('common.loadError', 'Betöltési hiba') + '</div>'; });
  }

  return { mount: mount, select: select, applyPreset: applyPreset };
})();
