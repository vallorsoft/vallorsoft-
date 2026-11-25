// lib/orderText.js — helyi (AI nélküli) megrendelő-kiolvasás
const { parseOrderText, findDate, parseNum } = require('../../lib/orderText');

const OWN = { ownNames: ['Vallor Team SRL'], ownCui: '47859317' };

test('RO lapos elrendezés: minden fő mező', () => {
  const t = `TRANS EXPRESS LOGISTIC SRL
CUI: RO12345678
COMANDA DE TRANSPORT Nr. TE-2026-881 / 12.11.2026
Transportator: VALLOR TEAM SRL, CUI RO47859317
Loc incarcare: Str. Industriilor 5, Oradea, Romania
Data incarcare: 14.11.2026 08:00
Expeditor: Alfa Paleti SRL
Loc descarcare: Budapest, Ungaria
Data descarcare: 15.11.2026
Destinatar: Beta Kft
Greutate: 12,5 t
Tip: camion complet
Pret transport: 1.250,00 EUR
Nr. auto: B 104 VLR / CJ36VSN
Observatii: CMR la descarcare.`;
  const f = parseOrderText(t, OWN).fields;
  expect(f.client).toBe('TRANS EXPRESS LOGISTIC SRL');
  expect(f.client_cui).toBe('RO12345678');
  expect(f.ref).toBe('TE-2026-881');
  expect(f.loc_incarcare).toMatch(/Oradea/);
  expect(f.loc_descarcare).toMatch(/Budapest/);
  expect(f.data_incarcare).toBe('2026-11-14T08:00');
  expect(f.data_descarcare).toBe('2026-11-15');
  expect(f.firma_incarcare).toBe('Alfa Paleti SRL');
  expect(f.firma_descarcare).toBe('Beta Kft');
  expect(f.pret).toBe(1250);
  expect(f.valuta).toBe('EUR');
  expect(f.greutate).toBe(12500);
  expect(f.load_type).toBe('FTL');
  expect(f.rendszam_camion).toBe('B104VLR');
  expect(f.rendszam_remorca).toBe('CJ36VSN');
});

test('EN blokkos, több felrakó + lerakó (unloading ≠ loading)', () => {
  const t = `Ordering party: DHL Freight GmbH
Order no: 4500123
Loading point 1
Company: Kaufland Logistik
Address: Neckarsulm, Germany
Date: 03/12/2026 07:00
Loading point 2
Address: Heilbronn, Germany
Date: 03/12/2026
Unloading point 1
Address: Turda, Romania
Date: 05/12/2026
Unloading point 2
Address: Cluj-Napoca, Romania
Freight: 2 400 EUR
LTL groupage`;
  const f = parseOrderText(t).fields;
  expect(f.client).toBe('DHL Freight GmbH');
  expect(f.pickups.map((s) => s.loc)).toEqual(['Neckarsulm, Germany', 'Heilbronn, Germany']);
  expect(f.deliveries.map((s) => s.loc)).toEqual(['Turda, Romania', 'Cluj-Napoca, Romania']);
  expect(f.firma_incarcare).toBe('Kaufland Logistik');
  expect(f.pret).toBe(2400);
  expect(f.load_type).toBe('LTL');
});

test('HU feliratok', () => {
  const f = parseOrderText(`Megbízó: Gondos Trans Kft
Megbízás száma: GT-77
Felrakás helye: Győr, Ipari park 3
Felrakás dátuma: 2026.11.20
Lerakás helye: Arad
Lerakás dátuma: 2026.11.21 14:30
Fuvardíj: 900 EUR`).fields;
  expect(f.client).toBe('Gondos Trans Kft');
  expect(f.ref).toBe('GT-77');
  expect(f.loc_incarcare).toMatch(/Győr/);
  expect(f.data_descarcare).toBe('2026-11-21T14:30');
  expect(f.pret).toBe(900);
});

test('a saját cég nem lesz megbízó; üres szöveg nem dob', () => {
  const f = parseOrderText('VALLOR TEAM SRL\nCUI: RO47859317\nClient: Omega SA, CUI RO999999', OWN).fields;
  expect(f.client).toBe('Omega SA');
  expect(f.client_cui).toBe('RO999999');
  expect(parseOrderText('').confidence).toBe(0);
});

test('segédek: szám és dátum', () => {
  expect(parseNum('1.250,50')).toBe(1250.5);
  expect(parseNum('1,250.50')).toBe(1250.5);
  expect(parseNum('12,5')).toBe(12.5);
  expect(findDate('14 noiembrie 2026').date).toBe('2026-11-14');
  expect(findDate('31.02.2026')).toBeNull();
});
