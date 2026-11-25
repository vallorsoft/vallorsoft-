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

// Valós minta-megrendelők (fiktív adatokkal) — PDF szövegréteg + OCR-szöveg.
describe('minta-megrendelők (tests/fixtures/order-text)', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (n) => fs.readFileSync(path.join(__dirname, '../fixtures/order-text', n), 'utf8');
  const CASES = [
    ['ro-test-1.txt', { client: 'DANUBIA LOGISTICS TEST SRL', client_cui: 'RO00000001', ref: 'DLT-261126-084', data_incarcare: '2026-11-26T08:00', data_descarcare: '2026-11-27T08:00', pret: 1450, valuta: 'EUR', greutate: 18500, load_type: 'FTL' }, /Debrecen/, /Brașov/],
    ['ro-test-1-ocr.txt', { client: 'DANUBIA LOGISTICS TEST SRL', ref: 'DLT-261126-084', data_incarcare: '2026-11-26T08:00', data_descarcare: '2026-11-27T08:00', pret: 1450, greutate: 18500 }, /Debrecen/, /Brașov/],
    ['ro-test-2.txt', { client: 'CARPATHIA CARGO TEST SRL', ref: 'CCT-281126-219', data_incarcare: '2026-11-28T13:00', data_descarcare: '2026-11-29T07:00', pret: 1180, greutate: 9200 }, /Győr/, /Žilina/],
    ['ro-test-3.txt', { client: 'NORDIC ROUTE PARTNER SRL', client_cui: 'RO00000003', ref: 'NRP-LNZ-301126-77', data_incarcare: '2026-11-30T06:30', data_descarcare: '2026-12-01T09:00', pret: 1760, greutate: 7800, load_type: 'FTL' }, /Linz, Austria$/, /Timișoara/],
    ['ro-test-4.txt', { client: 'ARCADIA FREIGHT SOLUTIONS SRL', client_cui: 'RO00000004', ref: 'AFS-CZ-0212-58', data_incarcare: '2026-12-02T15:00', data_descarcare: '2026-12-03T10:00', pret: 1325, valuta: 'EUR', greutate: 11400 }, /Celje/, /Brno/],
    ['ro-ocr-confusable-5.txt', { client: 'ROUTE-LOGISTIC S.R.L.', client_cui: 'RO00000105', ref: 'RL-02/12-26-O5', data_incarcare: '2026-12-02T07:00', data_descarcare: '2026-12-03T08:00', pret: 1590, valuta: 'EUR', greutate: 14680 }, /Nitra/, /Oradea/],
    ['ro-real-eurolexim.txt', { client: 'EUROLEXIM s.r.l.', client_cui: 'RO15650427', ref: '8228', firma_incarcare: 'KLINKIER PRZYSUCHA S.A.', data_incarcare: '2026-11-24T16:30', data_descarcare: '2026-11-26', pret: 2500, valuta: 'EUR', greutate: 23500, load_type: 'FTL', rendszam_camion: 'B144VLR' }, /Przysucha/, /BUCURESTI.*NOVOTEL/],
    ['hu-table.txt', { client: 'Pannon Freight Kft.', client_cui: 'HU12345678', ref: 'PF-0312-55', data_incarcare: '2026-12-03T07:00', data_descarcare: '2026-12-04', pret: 980, greutate: 14200, load_type: 'FTL', rendszam_camion: 'CV10VLR', rendszam_remorca: 'CV20VLR' }, /Kecskemét/, /Cluj-Napoca/],
    ['en-multidrop.txt', { client: 'Baltic Line Logistics Ltd', client_cui: 'DE987654321', ref: 'KAUF-RO-778', data_incarcare: '2026-12-08T06:00', pret: 1890, greutate: 21000, firma_incarcare: 'Kaufland Logistik GmbH' }, /Neckarsulm/, /Turda/],
  ];
  test.each(CASES)('%s', (file, want, pick, drop) => {
    const f = parseOrderText(read(file), OWN).fields;
    for (const [k, v] of Object.entries(want)) expect([k, f[k]]).toEqual([k, v]);
    expect(f.loc_incarcare).toMatch(pick);
    expect(f.loc_descarcare).toMatch(drop);
  });
  test('angol, két lerakó → deliveries[]', () => {
    const f = parseOrderText(read('en-multidrop.txt'), OWN).fields;
    expect(f.deliveries.map((d) => d.data)).toEqual(['2026-12-10', '2026-12-10T14:00']);
  });
});
