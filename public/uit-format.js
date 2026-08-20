// public/uit-format.js — kliens oldali UIT-mező kezelés.
//
// A felület a UIT-kódot 4-esével kötőjellel tagolva mutatja
// (XXXX-XXXX-XXXX-XXXX), a beírás közben azonnal formázza:
// - minden karakter nagybetűvé alakul (mind kis, mind nagybetű elfogadva),
// - nem alfanumerikus karaktert eldob (szóköz, kötőjel stb. helyett a
//   megjelenítéskor visszaírja a helyes helyre),
// - max 16 karakter (kötőjelek nélkül).
//
// Publikus API (window.UitFmt):
//   normalize(v)   → 'ABCD1234' (kötőjel-mentes, felnagyítva, max 16)
//   format(v)      → 'ABCD-1234' (négyesével kötőjellel)
//   attach(input)  → input-mezőre köti az élő formázást (kurzor-poz. megőrzés)
//
// Node-teszt-környezetből is használható (`if (typeof module ...)`).
(function () {
  'use strict';

  var UIT_MAX = 16;

  function normalize(v) {
    if (v == null) return '';
    return String(v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, UIT_MAX);
  }
  function format(v) {
    var raw = normalize(v);
    if (!raw) return '';
    return raw.match(/.{1,4}/g).join('-');
  }

  // Egy <input>-hoz kötjük az élő formázást. A kurzor pozíciójának megőrzése
  // fontos: ha a felhasználó közepére ír, a beszúrt kötőjel miatt a kurzor
  // ne csússzon el.
  function attach(input) {
    if (!input || input._vsUitAttached) return;
    input._vsUitAttached = true;
    input.setAttribute('autocapitalize', 'characters');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    // A max hosszúság megjelenítésben 19 (16 + 3 kötőjel).
    input.maxLength = 19;

    function apply() {
      var beforeVal = input.value || '';
      var cursorPos = input.selectionStart || beforeVal.length;
      // Számoljuk meg, HÁNY ALFANUMERIKUS karakter van a kurzor ELŐTT — ezt
      // őrizzük meg a formázás után is.
      var alnumBefore = 0;
      for (var i = 0; i < cursorPos && i < beforeVal.length; i++) {
        if (/[A-Za-z0-9]/.test(beforeVal[i])) alnumBefore++;
      }
      var formatted = format(beforeVal);
      if (formatted === beforeVal) return; // nincs változás
      input.value = formatted;
      // Kurzor visszaállítása ugyanahhoz az alfanumerikus pozícióhoz.
      var newPos = 0, seen = 0;
      while (newPos < formatted.length && seen < alnumBefore) {
        if (/[A-Z0-9]/.test(formatted[newPos])) seen++;
        newPos++;
      }
      try { input.setSelectionRange(newPos, newPos); } catch (_) {}
    }
    input.addEventListener('input', apply);
    input.addEventListener('paste', function () { setTimeout(apply, 0); });
    // Első betöltéskor formázzuk (ha érték már bent van).
    if (input.value) apply();
  }

  window.UitFmt = { UIT_MAX: UIT_MAX, normalize: normalize, format: format, attach: attach };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.UitFmt;
  }
})();
