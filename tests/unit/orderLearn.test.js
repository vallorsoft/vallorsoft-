// lib/orderLearn.js — címke-tanulás a javításokból (értéket NEM tanul)
const ot = require('../../lib/orderText');
const L = require('../../lib/orderLearn');

const doc = (a, b, d, p) => `ALFA SPEDITION SRL\nComanda 55\nPunct A >> ${a}\nZiua A >> ${d}\nPunct B >> ${b}\nSuma de achitat >> ${p} EUR\n`;

test('ismeretlen formátum: a javításból tanul, a következő dokumentumot (más értékekkel) helyesen olvassa', () => {
  const d1 = doc('Oradea, Str. Lunga 4', 'Arad, Calea Aurel Vlaicu 2', '12.12.2026', 900);
  const ex = ot.parseOrderText(d1).fields;
  expect(ex.loc_incarcare).toBeNull();
  const fin = Object.assign({}, ex, { loc_incarcare: 'Oradea, Str. Lunga 4', loc_descarcare: 'Arad, Calea Aurel Vlaicu 2', data_incarcare: '2026-12-12', pret: 900 });
  const rules = L.learnRules(d1, ex, fin).map((r, i) => Object.assign({ id: i + 1, hits: 1, misses: 0 }, r));
  expect(rules.map((r) => [r.field, r.anchor])).toEqual([
    ['loc_incarcare', 'punct a >>'], ['loc_descarcare', 'punct b >>'], ['data_incarcare', 'ziua a >>'], ['pret', 'suma de achitat >>'],
  ]);
  const d2 = doc('Cluj-Napoca, Bd. Muncii 18', 'Timisoara, Calea Sagului 188', '20.12.2026', 1340);
  const f2 = ot.parseOrderText(d2).fields;
  const { applied } = L.applyRules(d2, f2, rules);
  expect(f2.loc_incarcare).toBe('Cluj-Napoca, Bd. Muncii 18');
  expect(f2.loc_descarcare).toBe('Timisoara, Calea Sagului 188');
  expect(f2.data_incarcare).toBe('2026-12-20');
  expect(f2.pret).toBe(1340);
  expect(Object.keys(applied)).toHaveLength(4);
});

test('a nem javított mezőből nem tanul; a gyenge (misses ≥ hits) szabályt nem alkalmazza', () => {
  const d1 = doc('Oradea', 'Arad', '12.12.2026', 900);
  expect(L.learnRules(d1, { pret: 900 }, { pret: 900 })).toEqual([]);
  const f = {};
  L.applyRules(d1, f, [{ id: 1, field: 'pret', anchor: 'suma de achitat >>', mode: 'same', hits: 1, misses: 1 }]);
  expect(f.pret).toBeUndefined();
});

test('érték a címke alatti sorban (mode next)', () => {
  const d1 = 'BETA SRL\nAdresa de preluare marfa\nNitra, Priemyselna 18\n';
  const r = L.learnRules(d1, {}, { loc_incarcare: 'Nitra, Priemyselna 18' });
  expect(r).toEqual([{ field: 'loc_incarcare', anchor: 'adresa de preluare marfa', mode: 'next' }]);
});

test('megbízó felismerése CUI-ból és névből', () => {
  const s = [{ template_key: 'eurolexim', template_label: 'EUROLEXIM s.r.l.', cui: 'RO15650427' }];
  expect(L.identifyClient('xx J 2003  RO 15650427', s)).toBe('eurolexim');
  expect(L.identifyClient('Comanda de la Eurolexim s.r.l. Focsani', s)).toBe('eurolexim');
  expect(L.identifyClient('alt client', s)).toBeNull();
});
