// ============================================================
//  VallorSoft — lib/orderLearn.js
//  Megbízás-kiolvasás: tanulás a diszpécser javításaiból — HELYBEN, AI nélkül.
//
//  ÉRTÉKET SOSEM tanulunk (a felrakó / lerakó / ár / dátum minden fuvarnál más):
//  csak azt, HOL áll az érték az adott megbízó dokumentumában. Ha a diszpécser
//  a kiolvasott mezőt kijavítja, megkeressük a helyes értéket a dokumentum
//  szövegében, és az előtte álló feliratot („címke") jegyezzük meg a megbízóhoz:
//    mode 'same' — az érték ugyanabban a sorban, a címke után áll;
//    mode 'next' — az érték a címke alatti (következő nem üres) sorban áll.
//  Legközelebb ugyanettől a megbízótól a címke után / alatt olvasunk, a friss
//  dokumentumból. A szabály bizonyítottsága (hits / misses) a további mentésekből jön.
// ============================================================
'use strict';

const ot = require('./orderText');

// Tanulható mezők és típusuk
const FIELDS = {
  client: 'name', client_cui: 'cui', ref: 'ref',
  loc_incarcare: 'loc', loc_descarcare: 'loc',
  firma_incarcare: 'name', firma_descarcare: 'name',
  data_incarcare: 'date', data_descarcare: 'date',
  pret: 'money', greutate: 'weight',
};
const MAX_ANCHOR = 60;

const _lines = (text) => String(text || '').replace(/\r/g, '').split('\n');
const _norm = (s) => ot.fold(s).replace(/[^a-z0-9]+/g, ' ').trim();

// Címke-szöveg tisztítása: írásjelek, sorszámok le, max. 60 karakter, szóhatáron.
function _anchorOf(prefix) {
  let a = ot.fold(prefix).replace(/[:：.\-–—|·•\s]+$/, '').trim();
  if (a.length > MAX_ANCHOR) { a = a.slice(-MAX_ANCHOR); a = a.slice(a.indexOf(' ') + 1); }
  a = a.replace(/^[\divxlc]+[.)]\s+/i, '').trim();            // „IV. DATA INCARCARII" → „data incarcarii"
  return (/[a-z]{3,}/.test(a)) ? a : null;
}

// Az érték helye a szövegben: [{ line, col }]
function _locate(lines, type, value) {
  const out = [];
  if (value == null || value === '') return out;
  const v = String(value);
  if (type === 'date') {
    const want = v.slice(0, 10);
    lines.forEach((l, i) => {
      // minden dátum a sorban
      let rest = l, off = 0;
      for (let k = 0; k < 4; k++) {
        const d = ot.findDate(rest);
        if (!d) break;
        if (d.date === want) { out.push({ line: i, col: off + d.index }); break; }
        off += d.index + 6; rest = l.slice(off);
      }
    });
    return out;
  }
  if (type === 'money' || type === 'weight') {
    const n = parseFloat(v);
    if (!(n > 0)) return out;
    const wants = type === 'weight' ? [n, n / 1000] : [n];
    const re = /\d{1,3}(?:[ .,  ]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/g;
    lines.forEach((l, i) => {
      let m; re.lastIndex = 0;
      while ((m = re.exec(l))) { const x = ot.parseNum(m[0]); if (wants.some((w) => Math.abs(w - x) < 0.001)) { out.push({ line: i, col: m.index }); break; } }
    });
    return out;
  }
  if (type === 'cui') {
    const dg = v.replace(/\D/g, '');
    if (dg.length < 6) return out;
    const re = new RegExp('(?:RO\\s?)?' + dg.split('').join('\\s?'), 'i');
    lines.forEach((l, i) => { const m = re.exec(l); if (m) out.push({ line: i, col: m.index }); });
    return out;
  }
  // Szöveges (név / hely / referencia): a teljes érték, vagy a darabjai; az érték a
  // sorban talált LEGKORÁBBI darabnál kezdődik („Oradea, Str. Lunga 4" → az „Oradea"-nál).
  const parts = [v.trim()].concat(v.split(/\s*[,;]\s*/).map((p) => p.trim()))
    .filter((p) => _norm(p).length >= 3);
  lines.forEach((l, i) => {
    const fl = ot.foldKeep(l);
    let col = -1;
    for (const p of parts) { const j = fl.indexOf(ot.fold(p)); if (j >= 0 && (col < 0 || j < col)) col = j; }
    if (col >= 0) out.push({ line: i, col });
  });
  return out;
}

// A javított mezőkből tanulható címkék: [{ field, anchor, mode }]
function learnRules(text, extracted, final) {
  const lines = _lines(text);
  const rules = [];
  for (const [field, type] of Object.entries(FIELDS)) {
    const fv = final ? final[field] : null;
    if (fv == null || fv === '') continue;
    const ev = extracted ? extracted[field] : null;
    if (_same(type, ev, fv)) continue;                          // nem javították → nincs mit tanulni
    const locs = _locate(lines, type, fv);
    if (!locs.length) continue;
    if (locs.length > 1 && (type === 'money' || type === 'weight')) continue;   // a szám több helyen áll → bizonytalan
    const { line, col } = locs[0];
    let anchor = _anchorOf(lines[line].slice(0, col));
    let mode = 'same';
    if (!anchor) {
      let j = line - 1;
      while (j >= 0 && !lines[j].trim()) j--;
      if (j >= 0 && line - j <= 2) { anchor = _anchorOf(lines[j]); mode = 'next'; }
    }
    if (anchor) rules.push({ field, anchor, mode });
  }
  return rules;
}

function _same(type, a, b) {
  if (a == null || a === '') return false;
  if (type === 'date') return String(a).slice(0, 10) === String(b).slice(0, 10);
  if (type === 'money' || type === 'weight') return Math.abs(parseFloat(a) - parseFloat(b)) < 0.001;
  if (type === 'cui') return String(a).replace(/\D/g, '') === String(b).replace(/\D/g, '');
  return _norm(a) === _norm(b);
}

// Érték a címke után / alatt, a mező típusa szerint értelmezve
function _valueAt(lines, rule) {
  const type = FIELDS[rule.field];
  for (let i = 0; i < lines.length; i++) {
    const fl = ot.foldKeep(lines[i]);
    const j = fl.indexOf(rule.anchor);
    if (j < 0) continue;
    let raw;
    let nextIdx = i;
    if (rule.mode === 'next') {
      let k = i + 1; while (k < lines.length && !lines[k].trim()) k++;
      if (k >= lines.length) continue;
      raw = lines[k]; nextIdx = k;
    } else {
      raw = lines[i].slice(j + rule.anchor.length).replace(/^[\s:：.\-–—|]+/, '');
    }
    const v = _parse(type, raw, lines[nextIdx + 1]);
    if (v != null) return v;
  }
  return null;
}

function _parse(type, raw, nextLine) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (type === 'date') {
    const d = ot.findDate(s);
    if (!d) return null;
    let time = d.time;
    if (!time && nextLine) { const m = /^\s*([01]?\d|2[0-3])[:.]([0-5]\d)\b/.exec(nextLine); if (m) time = m[1].padStart(2, '0') + ':' + m[2]; }
    return time ? d.date + 'T' + time : d.date;
  }
  if (type === 'money') { const m = ot.money(s); return m ? m.n : null; }
  if (type === 'weight') {
    const m = /(\d{1,3}(?:[ .,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*(kg|t|to|tone|tons)?\b/i.exec(s);
    if (!m) return null;
    let n = ot.parseNum(m[1]);
    if (n != null && ((m[2] && !/kg/i.test(m[2])) || (!m[2] && n < 50))) n *= 1000;
    return n > 0 && n <= 45000 ? Math.round(n) : null;
  }
  if (type === 'cui') { const m = /((?:RO)?\s?\d{6,12})/i.exec(s); return m ? m[1].replace(/\s/g, '').toUpperCase() : null; }
  if (type === 'ref') { const m = /([A-Z0-9][A-Z0-9\-\/_.]{1,40})/i.exec(s); return m && /\d/.test(m[1]) ? m[1].replace(/[.,]$/, '') : null; }
  if (type === 'loc') return ot.cleanAddr(s.split(/\s{3,}|\t/)[0]);
  // név: a sor eleje az első elválasztóig, a jogi formáig
  const nm = ot.companyName(s.split(/\s*(?:[,;(]|·|\s{3,}|\t)\s*/)[0]).trim();
  return nm.length >= 2 ? nm.slice(0, 200) : null;
}

// Tanult szabályok alkalmazása: a legjobb (hits − misses) szabály mezőnként.
// → { applied: { field: ruleId } }  (a fields objektumot helyben módosítja)
function applyRules(text, fields, rules) {
  const lines = _lines(text);
  const best = {};
  for (const r of (rules || [])) {
    if (!FIELDS[r.field]) continue;
    const score = (r.hits || 0) - (r.misses || 0);
    if (score < 1) continue;
    if (!best[r.field] || score > best[r.field].score) best[r.field] = Object.assign({ score }, r);
  }
  const applied = {};
  for (const [field, r] of Object.entries(best)) {
    const v = _valueAt(lines, r);
    if (v == null) continue;
    fields[field] = v;
    applied[field] = r.id;
  }
  return { applied };
}

// A megbízó felismerése a dokumentumban: CUI (számjegyek) vagy név (normalizálva).
// samples: [{ template_key, template_label, cui }]
function identifyClient(text, samples) {
  const nt = ' ' + _norm(text) + ' ';
  for (const s of (samples || [])) {
    const c = String(s.cui || '').replace(/\D/g, '');
    if (c.length >= 6 && new RegExp('(^|\\D)' + c + '(\\D|$)').test(String(text || '').replace(/\s/g, ''))) return s.template_key;
  }
  for (const s of (samples || [])) {
    const n = _norm(s.template_label || '').replace(/\b(srl|sa|s r l|kft|gmbh|ltd)\b/g, '').trim();
    if (n.length >= 4 && nt.includes(' ' + n + ' ')) return s.template_key;
  }
  return null;
}

// Egyezik-e a kiolvasott és a mentett érték (a mező típusa szerint)
function sameValue(field, a, b) { return !!FIELDS[field] && _same(FIELDS[field], a, b); }

module.exports = { learnRules, applyRules, identifyClient, sameValue, FIELDS, _locate, _anchorOf };
