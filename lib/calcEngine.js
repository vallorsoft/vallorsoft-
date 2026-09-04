// ============================================================
//  VallorSoft — lib/calcEngine.js
//  A Vallorcalc `src/lib/calc-engine.ts` + `src/lib/vat.ts` bit-pontos
//  portja plain JS-re. A viselkedés VÁLTOZATLAN — új funkciót itt NEM
//  vezetünk be, hogy az eredményszámok pontosan egyezzenek a régi
//  Vallorcalc-kal (regresszió-védett: tests/unit/calcEngine.test.js).
//
//  Használat: a handlers/costCalculator.js hívja mind manuális
//  bevitelnél, mind a Vallorsoft-adatokból előtöltött módban — a
//  motor forrás-agnosztikus, ugyanazt a CalcInput-ot várja.
// ============================================================

// ─── ÁFA-segédek (VAT_RATE = 0.21, mint a Vallorcalc-ban) ────
const VAT_RATE = 0.21;
function grossToNet(gross) { return gross * 100 / 121; }
function grossToVat(gross) { return gross * 21 / 121; }
function netToGross(net) { return net * 1.21; }
function netToVat(net) { return net * VAT_RATE; }
function toNet(amount, isGross) { return isGross ? grossToNet(amount) : amount; }
function toGross(amount, isGross) { return isGross ? amount : netToGross(amount); }

// ─── Prorátálás (km- vagy idő-alapú fix költség egy fuvarra) ─
// A TS-forrás szó szerinti mása; km-basis-nál a hiányzó intervalKm
// az annualKm-re esik vissza, idő-basis-nál a hiányzó intervalMonths
// 12 hónap. NE változtass rajta — a Vallorcalc mentett számításai
// pontosan ezt a képletet őrzik.
function prorateCost(item, tripKm, annualKm, tripWeeks, annualWeeks) {
  const net = toNet(item.amountLei, item.isGross);
  if (item.basisType === 'km') {
    const intervalKm = item.intervalKm != null ? item.intervalKm : annualKm;
    return (tripKm / intervalKm) * net;
  }
  const intervalMonths = item.intervalMonths != null ? item.intervalMonths : 12;
  const intervalWeeks = intervalMonths * (annualWeeks / 12);
  return (tripWeeks / intervalWeeks) * net;
}

// ─── Fő számítás ─────────────────────────────────────────────
// input alakja: lásd tests/unit/calcEngine.test.js — a mezők
// megnevezése pontosan a Vallorcalc `CalcInput`-jét követi (a
// szerver-oldali handler ugyanígy szereli össze a payloadot).
function calculate(input) {
  const tripWeeks = input.tripDays / 7;
  const lines = [];
  const addLine = (name, netLei) => {
    const vatLei = netLei * 0.21; // szó szerint, mint a TS-forrásban
    lines.push({ name, netLei, vatLei, grossLei: netLei + vatLei });
  };

  for (const item of (input.truckCosts || [])) {
    const net = prorateCost(item, input.tripKm, input.annualKmTarget, tripWeeks, input.workingWeeksPerYear);
    if (net > 0) addLine('Vontató – ' + item.name, net);
  }
  for (const item of (input.trailerCosts || [])) {
    const net = prorateCost(item, input.tripKm, input.annualKmTarget, tripWeeks, input.workingWeeksPerYear);
    if (net > 0) addLine('Pótkocsi – ' + item.name, net);
  }
  for (const d of (input.driverCosts || [])) {
    const net = toNet(d.amountLei, d.isGross);
    const perWeek = net / input.workingWeeksPerYear;
    addLine('Sofőr – ' + d.name, perWeek * tripWeeks);
  }

  const activeTrucks = Math.max(1, input.activeTrucksCount || 1);
  for (const item of (input.companyCosts || [])) {
    const net = prorateCost(item, input.tripKm, input.annualKmTarget, tripWeeks, input.workingWeeksPerYear);
    const share = net / activeTrucks;
    if (share > 0) addLine('Céges – ' + item.name, share);
  }

  // Üzemanyag — a bruttó összeg VAGY liter × ár/liter úton áll össze.
  let fuelGross = 0;
  if (input.fuelMethod === 'per_liter' && input.fuelLiterPer100km && input.fuelPricePerLiterGross) {
    const liters = (input.tripKm / 100) * input.fuelLiterPer100km;
    fuelGross = liters * input.fuelPricePerLiterGross;
  } else if (input.fuelTotalGross) {
    fuelGross = input.fuelTotalGross;
  }
  const fuelNet = grossToNet(fuelGross);
  const fuelVat = grossToVat(fuelGross);

  // Kedvezmények — nettó összegbe konvertálva vonjuk le.
  let discountNet = 0;
  if (input.excisaApplied && input.excisaDiscountLei) {
    discountNet += toNet(input.excisaDiscountLei, input.excisaDiscountType === 'gross');
  }
  if (input.fuelDiscountApplied && input.fuelDiscountLei) {
    discountNet += toNet(input.fuelDiscountLei, input.fuelDiscountType === 'gross');
  }

  // Útdíj — a bevitt bruttó LEI-t nettósítjuk.
  const tollNet = (input.tolls || []).reduce((sum, t) => sum + grossToNet(t.amountLei || 0), 0);

  const vehicleAndDriverNet = lines.reduce((s, l) => s + l.netLei, 0);
  const vehicleVat = lines.reduce((s, l) => s + l.vatLei, 0);

  const totalNet = vehicleAndDriverNet + fuelNet - discountNet + tollNet;
  const totalVat = vehicleVat + fuelVat;
  const totalGross = totalNet + totalVat;
  const bnr = input.bnrEurLei || 1;
  const totalNetEur = totalNet / bnr;
  const totalGrossEur = totalGross / bnr;

  let freightNet, profitNet, profitEur;
  if (input.freightRevenueLei != null) {
    freightNet = grossToNet(input.freightRevenueLei);
    profitNet = freightNet - totalNet;
    profitEur = profitNet / bnr;
  }

  return {
    lines, fuelNet, fuelVat, fuelGross, discountNet, tollNet,
    totalNet, totalVat, totalGross, totalNetEur, totalGrossEur,
    freightNet, profitNet, profitEur,
  };
}

// ─── Bevétel-átváltó (Vallorcalc serial.ts computeFreightRevenue) ─
function computeFreightRevenue(amount, currency, isGross, bnrEurLei) {
  if (amount == null || Number.isNaN(amount)) return { grossLei: null, grossEur: null };
  const amountLei = currency === 'eur' ? amount * bnrEurLei : amount;
  const grossLei = isGross ? amountLei : netToGross(amountLei);
  const grossEur = bnrEurLei ? grossLei / bnrEurLei : 0;
  return { grossLei, grossEur };
}

module.exports = {
  VAT_RATE,
  grossToNet, grossToVat, netToGross, netToVat, toNet, toGross,
  prorateCost, calculate, computeFreightRevenue,
};
