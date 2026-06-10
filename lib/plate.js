// ============================================================
//  VallorSoft — Rendszám-normalizálás
//  A CargoTrack a jármű nevében/plate mezőjében kiírja a rendszámot,
//  de eltérő formátumban (szóköz/kötőjel/pont). Ezt egységesítjük:
//  nagybetű + csak betű/szám. Pl. "B 104 VLR" -> "B104VLR".
//  (A public/cargotrack-pairing.js kliens-oldali normalizePlate-je
//   UGYANEZT a szabályt tükrözi.)
// ============================================================
function normalizePlate(s) {
  return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

module.exports = { normalizePlate };
