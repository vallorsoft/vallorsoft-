/* payment-schedule.js — Fizetési ütemterv (cashflow), CSAK OLVASÁS.
 * A getPaymentSchedule RPC-t hívja (handlers/paymentSchedule.js):
 *   - bejövő: carrier_invoices (alvállalkozói AP) — MI fizetünk
 *   - kimenő: invoices kintlévőség (finalized_at + payment_term_days proxy) — NEKÜNK fizetnek
 * Nem ír semmit; a meglévő táblákra épül.
 */
function _psEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function _psNum(n){ var v = Number(n)||0; return v.toLocaleString('ro-RO', { maximumFractionDigits: 0 }); }

function _psDirPill(dir){
  if(dir === 'in')  return '<span class="badge warn">' + _psEsc(t('ps.dirIn')) + '</span>';   // mi fizetünk
  return '<span class="badge ok">' + _psEsc(t('ps.dirOut')) + '</span>';                       // nekünk fizetnek
}

function _psStatusPill(st){
  var s = String(st||'').toLowerCase();
  if(s === 'partial') return '<span class="badge info">' + _psEsc(t('pay.partial')) + '</span>';
  if(s === 'paid')    return '<span class="badge ok">' + _psEsc(t('pay.paid')) + '</span>';
  return '<span class="badge err">' + _psEsc(t('pay.unpaid')) + '</span>';
}

function _psOverdue(dueDate){
  if(!dueDate) return false;
  var d = new Date(dueDate); d.setHours(0,0,0,0);
  var today = new Date(); today.setHours(0,0,0,0);
  return d < today;
}

function loadPaymentSchedule(){
  var box = document.getElementById('paymentScheduleBox'); if(!box) return;
  var fEl = document.getElementById('psFrom'), tEl = document.getElementById('psTo');
  var argsObj = {};
  if(fEl && fEl.value) argsObj.from = fEl.value;
  if(tEl && tEl.value) argsObj.to = tEl.value;
  var body = document.getElementById('psBody');
  if(body) body.innerHTML = '<tr><td colspan="6" style="padding:14px;text-align:center;opacity:.6;">…</td></tr>';
  gas('getPaymentSchedule', argsObj).then(function(d){
    if(!d || !d.ok){ if(body) body.innerHTML = '<tr><td colspan="6" style="padding:14px;text-align:center;opacity:.6;">' + _psEsc((d && d.err) || t('common.error')) + '</td></tr>'; return; }
    _psRenderBand(d.totals || {});
    var items = d.schedule || [];
    if(!items.length){ if(body) body.innerHTML = '<tr><td colspan="6" style="padding:14px;text-align:center;opacity:.6;">' + _psEsc(t('ps.empty')) + '</td></tr>'; return; }
    var html = items.map(function(it){
      var dt = it.due_date ? String(it.due_date).slice(0,10) : '—';
      var overdue = _psOverdue(it.due_date);
      var dtCell = overdue
        ? '<span style="color:var(--status-danger,#ef4444);font-weight:700;">' + _psEsc(dt) + '</span>'
        : _psEsc(dt);
      var amt = _psNum(it.amount) + ' ' + _psEsc(it.currency || '');
      return '<tr>'
        + '<td style="padding:8px 10px;">' + dtCell + '</td>'
        + '<td style="padding:8px 10px;">' + _psDirPill(it.direction) + '</td>'
        + '<td style="padding:8px 10px;">' + _psEsc(it.partner || '—') + '</td>'
        + '<td style="padding:8px 10px;">' + _psEsc(it.reference || '—') + '</td>'
        + '<td style="padding:8px 10px;text-align:right;font-weight:700;">' + _psEsc(amt) + '</td>'
        + '<td style="padding:8px 10px;">' + _psStatusPill(it.status) + '</td>'
        + '</tr>';
    }).join('');
    if(body) body.innerHTML = html;
  }).catch(function(){ if(body) body.innerHTML = '<tr><td colspan="6" style="padding:14px;text-align:center;opacity:.6;">' + _psEsc(t('common.error')) + '</td></tr>'; });
}

function _psRenderBand(totals){
  var el = document.getElementById('psBand');
  if(!el || typeof vsMetricBand !== 'function') return;
  el.innerHTML = vsMetricBand([
    { l: t('ps.kpiDue30'),  v: _psNum(totals.due30),   sub: 'EUR' },
    { l: t('ps.kpiIn'),     v: _psNum(totals.in),      sub: 'EUR' },
    { l: t('ps.kpiOut'),    v: _psNum(totals.out),     sub: 'EUR' },
    { l: t('ps.kpiOverdue'),v: _psNum(totals.overdue), sub: 'EUR' }
  ]);
}
