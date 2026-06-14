// ============================================================
//  VallorSoft — lib/uitDeeplink.js
//  A UIT deep-link URL felépítése a cég sablonjából + fuvar-adatokból.
//  A {kulcs} helyőrzők URL-kódolva behelyettesülnek; ismeretlen kulcs
//  változatlanul marad. Tiszta (oldal-hatás nélküli) → könnyen tesztelhető.
// ============================================================
function buildUrl(template, o, uit) {
  if (!template) return null;
  const order = o || {};
  const map = {
    id: order.id,
    rendszam: order.rendszam_camion || '',
    remorca: order.rendszam_remorca || '',
    incarcare: order.loc_incarcare || '',
    descarcare: order.loc_descarcare || '',
    client: order.client || '',
    km: order.km == null ? '' : order.km,
    greutate: order.suly_kg == null ? '' : order.suly_kg,
    uit: uit || '',
  };
  return String(template).replace(/\{(\w+)\}/g, (m, k) =>
    Object.prototype.hasOwnProperty.call(map, k) ? encodeURIComponent(String(map[k])) : m);
}

module.exports = { buildUrl };
