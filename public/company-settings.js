// public/company-settings.js
// Egységes "Cég & arculat" beállítások — admin + manager.
// CompanySettings.mount('companySettingsBox') a fül megnyitásakor.
//
// ÚJRAHASZNÁLT backend (NEM duplikálunk):
//   - logó:  REST GET/POST/DELETE /api/branding/logo (company_branding)
//   - egyéb: gas('getCompanySettings' / 'saveCompanySettings')
//            -> company_branding (brand_color/pdf_header_text)
//               + companies.eur_ron_rate + document_series (MT prefix)
// A meglévő gas()/toast()/t() segédeket használja (console-shared.js + i18n.js).
window.CompanySettings = (function () {
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

  function render(root, d) {
    _canEdit = !!d.canEdit;
    var disabled = _canEdit ? '' : ' disabled';
    var color = d.brandColor || '#f6711e';
    root.innerHTML =
      '<div class="glass" style="padding:22px;max-width:920px;">' +
        '<h2 class="h-title" style="margin-top:0;">' + tt('comset.title', '🏢 Cég & arculat') + '</h2>' +
        '<p style="color:var(--muted);font-size:13px;margin:0 0 6px;">' + tt('comset.intro', 'A céged arculata és alapértelmezett beállításai egy helyen.') + '</p>' +
        (d.companyName ? '<p style="font-size:13px;margin:0 0 14px;"><b class="text-primary">' + esc(d.companyName) + '</b></p>' : '') +
        (!_canEdit ? '<div class="badge warn" style="margin-bottom:14px;">' + tt('comset.readOnly', 'Csak megtekintés (a cég-szintű beállításokat az Admin módosíthatja).') + '</div>' : '') +

        // ── ARCULAT ──
        '<h3 class="h-title" style="font-size:15px;margin:18px 0 10px;">' + tt('comset.brandingHead', '🎨 Arculat') + '</h3>' +
        '<div class="grid-2" style="gap:18px;align-items:start;">' +
          '<div>' +
            '<div class="field"><label>' + tt('comset.logo', 'Céglogó') + '</label>' +
              '<div id="csLogoPreviewWrap" style="margin:6px 0 8px;min-height:48px;">' +
                (d.hasLogo
                  ? '<img id="csLogoImg" alt="logo" style="max-height:64px;max-width:240px;border-radius:8px;background:#fff;padding:6px;">'
                  : '<span style="color:var(--muted);font-size:13px;" id="csLogoNone">' + tt('comset.noLogo', 'Nincs feltöltött logó.') + '</span>') +
              '</div>' +
              '<input type="file" id="csLogoFile" accept="image/*"' + disabled + ' style="font-size:12px;">' +
              (d.hasLogo ? ' <button class="btn ghost" id="csLogoDel"' + disabled + ' style="padding:5px 12px;font-size:12px;">' + tt('comset.logoDel', '🗑️ Logó törlése') + '</button>' : '') +
              '<div style="font-size:11px;color:var(--muted);margin-top:4px;">' + tt('comset.logoHint', 'PNG/JPG, max ~3 MB.') + '</div>' +
            '</div>' +
          '</div>' +
          '<div>' +
            '<div class="field"><label>' + tt('comset.brandColor', 'Márka-szín') + '</label>' +
              '<div style="display:flex;gap:10px;align-items:center;">' +
                '<input type="color" id="csBrandColor" value="' + esc(color) + '"' + disabled + ' style="width:48px;height:38px;border:none;background:none;padding:0;cursor:pointer;">' +
                '<input class="input" id="csBrandColorHex" value="' + esc(d.brandColor || '') + '" placeholder="#f6711e" maxlength="9"' + disabled + ' style="max-width:130px;">' +
                '<span id="csColorSwatch" style="display:inline-block;width:80px;height:24px;border-radius:6px;background:' + esc(color) + ';border:1px solid var(--border);"></span>' +
              '</div>' +
            '</div>' +
            '<div class="field"><label>' + tt('comset.pdfHeader', 'PDF-fejléc szöveg') + '</label>' +
              '<textarea class="textarea" id="csPdfHeader" rows="3" maxlength="600"' + disabled + ' placeholder="' + tt('comset.pdfHeaderPh', 'Cégnév, cím, CUI, kapcsolat — a kimenő dokumentumok fejlécében.') + '">' + esc(d.pdfHeaderText || '') + '</textarea>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // ── CÉG-ADATOK ──
        '<h3 class="h-title" style="font-size:15px;margin:18px 0 10px;">' + tt('comset.companyHead', '💶 Cég-adatok') + '</h3>' +
        '<div class="grid-3" style="gap:14px;">' +
          '<div class="field"><label>' + tt('comset.eurRon', 'EUR/RON árfolyam') + '</label>' +
            '<input class="input" id="csEurRon" type="number" step="0.0001" min="0" value="' + (d.eurRonRate != null ? esc(d.eurRonRate) : '') + '"' + disabled + ' placeholder="4.9700"></div>' +
          '<div class="field" style="grid-column:span 2;"><label>' + tt('comset.tvaNote', 'Alapértelmezett TVA % / pénznem') + '</label>' +
            '<div style="font-size:12px;color:var(--muted);padding:9px 0;">' + tt('comset.billingNote', 'A számla-széria, TVA% és pénznem a Számlázó integráció (provider) beállításában él — ott módosítható.') + '</div></div>' +
        '</div>' +

        // ── SZÁMOZÁS ──
        '<h3 class="h-title" style="font-size:15px;margin:18px 0 10px;">' + tt('comset.numberingHead', '📋 Számozás') + '</h3>' +
        '<div style="display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;">' +
          '<div class="field" style="flex:1;min-width:140px;margin:0;"><label>' + tt('comset.waybillPrefix', 'Menetlevél prefix') + '</label>' +
            '<input class="input" id="csWaybillPrefix" value="' + esc(d.waybillPrefix || 'MT') + '" maxlength="10"' + disabled + ' oninput="CompanySettings.previewSeries()"></div>' +
          '<div style="padding-bottom:2px;"><div style="font-size:11px;color:var(--muted);margin-bottom:4px;">' + tt('comset.currentSeq', 'Aktuális sorszám') + '</div>' +
            '<div style="font-size:20px;font-weight:800;" class="text-primary">' + esc(d.waybillSeq || 0) + '</div></div>' +
        '</div>' +
        '<div style="margin-top:8px;font-size:12px;color:var(--muted);" id="csSeriesPreview"></div>' +

        (_canEdit
          ? '<div style="margin-top:22px;"><button class="btn primary" id="csSaveBtn" style="padding:11px 26px;">💾 ' + tt('common.save', 'Mentés') + '</button></div>'
          : '');

    // Élő szín-előnézet
    if (_canEdit) {
      var picker = root.querySelector('#csBrandColor');
      var hex = root.querySelector('#csBrandColorHex');
      var swatch = root.querySelector('#csColorSwatch');
      function syncSwatch(v) { if (swatch) swatch.style.background = v; }
      picker.addEventListener('input', function () { hex.value = picker.value; syncSwatch(picker.value); });
      hex.addEventListener('input', function () {
        var v = hex.value.trim(); if (v && v[0] !== '#') v = '#' + v;
        if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) { picker.value = v; syncSwatch(v); }
      });
      root.querySelector('#csSaveBtn').addEventListener('click', save);
      var lf = root.querySelector('#csLogoFile'); if (lf) lf.addEventListener('change', uploadLogo);
      var ld = root.querySelector('#csLogoDel'); if (ld) ld.addEventListener('click', delLogo);
    }
    // Logó-előnézet betöltése a hitelesített végpontról (dataUri, nem szivárog kifelé).
    if (d.hasLogo) {
      var img = root.querySelector('#csLogoImg');
      if (img) {
        fetch('/api/branding/logo').then(function (r) { return r.json(); }).then(function (lg) {
          if (lg && lg.has && lg.dataUri) img.src = lg.dataUri;
        }).catch(function () {});
      }
    }
    previewSeries();
  }

  function previewSeries() {
    if (!_root) return;
    var p = ((_root.querySelector('#csWaybillPrefix') || {}).value || 'MT').toUpperCase();
    var el = _root.querySelector('#csSeriesPreview');
    if (el) el.textContent = tt('comset.preview', 'Előnézet:') + ' ' + p + '-' + new Date().getFullYear() + '-0001';
  }

  function save() {
    var hex = ((_root.querySelector('#csBrandColorHex') || {}).value || '').trim();
    var payload = {
      brandColor: hex || null,
      pdfHeaderText: (_root.querySelector('#csPdfHeader') || {}).value || '',
      eurRonRate: (_root.querySelector('#csEurRon') || {}).value || '',
      waybillPrefix: ((_root.querySelector('#csWaybillPrefix') || {}).value || '').trim(),
    };
    gas('saveCompanySettings', [payload]).then(function (r) {
      if (r && r.ok) {
        toast(tt('common.saved', 'Mentve'), 'ok');
        if (typeof loadDocSeries === 'function') { try { loadDocSeries(); } catch (e) {} }
      } else {
        toast((r && r.err) || tt('common.error', 'Hiba'), 'err');
      }
    }).catch(function () { toast(tt('common.error', 'Hiba'), 'err'); });
  }

  function uploadLogo() {
    var fi = _root.querySelector('#csLogoFile');
    if (!fi || !fi.files.length) return;
    var f = fi.files[0];
    var fr = new FileReader();
    fr.onload = function (e) {
      fetch('/api/branding/logo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64: e.target.result, mime: f.type || 'image/png' }),
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d && d.ok) { toast(tt('comset.logoSaved', 'Logó mentve'), 'ok'); mount(_root.id); }
        else toast((d && d.error) || tt('common.error', 'Hiba'), 'err');
      }).catch(function () { toast(tt('common.error', 'Hiba'), 'err'); });
    };
    fr.readAsDataURL(f);
  }

  function delLogo() {
    if (!confirm(tt('comset.logoDelConfirm', 'Biztosan törlöd a logót?'))) return;
    fetch('/api/branding/logo', { method: 'DELETE' }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.ok) { toast(tt('comset.logoDeleted', 'Logó törölve'), 'ok'); mount(_root.id); }
      else toast(tt('common.error', 'Hiba'), 'err');
    }).catch(function () { toast(tt('common.error', 'Hiba'), 'err'); });
  }

  function mount(boxId) {
    _root = document.getElementById(boxId);
    if (!_root) return;
    _root.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px;"><div class="spinner" style="margin:0 auto 10px;"></div></div>';
    gas('getCompanySettings').then(function (d) {
      if (!d || !d.ok) { _root.innerHTML = '<div class="glass" style="padding:20px;color:var(--muted);">' + tt('common.loadError', 'Betöltési hiba') + '</div>'; return; }
      render(_root, d);
    }).catch(function () { _root.innerHTML = '<div class="glass" style="padding:20px;color:var(--muted);">' + tt('common.loadError', 'Betöltési hiba') + '</div>'; });
  }

  return { mount: mount, previewSeries: previewSeries };
})();
