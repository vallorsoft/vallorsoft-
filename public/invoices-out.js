/* invoices-out.js — Kimenő számlák (sales/outgoing) lista oldal.
 * Újrahasznosítja a meglévő végpontokat:
 *   GET  /api/invoices                       (új lista-végpont, company_id-szűrt)
 *   POST /api/orders/:order_id/invoice/storno (meglévő storno)
 *   POST /api/invoices/:id/status            (meglévő e-Factura státusz-frissítés)
 * Nem épít új backend-logikát, csak megjeleníti a meglévő számlákat.
 */
function _ioEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

var _ioItemsCache = [];  // a betöltött számlák (a 📧 Sablonból küldés idézőjel-biztos előtöltéséhez)

function _ioStatusPill(st){
  var s = String(st||'').toLowerCase();
  var cls = 'info', txt = st || '—';
  if(s === 'issued'){ cls = 'ok'; txt = t('invo.stIssued'); }
  else if(s === 'cancelled' || s === 'storno' || s === 'canceled'){ cls = 'warn'; txt = t('invo.stCancelled'); }
  else if(s === 'error'){ cls = 'err'; txt = t('invo.stError'); }
  return '<span class="badge ' + cls + '">' + _ioEsc(txt) + '</span>';
}

function loadInvoicesOut(){
  var box = document.getElementById('invoicesOutBox'); if(!box) return;
  var fEl = document.getElementById('invOutFrom'), tEl = document.getElementById('invOutTo');
  var qs = [];
  if(fEl && fEl.value) qs.push('from=' + encodeURIComponent(fEl.value));
  if(tEl && tEl.value){
    // a `to` napot bezárólag → másnap 00:00-ig (a végpont `< $`-t használ)
    var d = new Date(tEl.value); d.setDate(d.getDate()+1);
    qs.push('to=' + encodeURIComponent(d.toISOString().slice(0,10)));
  }
  var body = document.getElementById('invOutBody');
  if(body) body.innerHTML = '<tr><td colspan="7" style="padding:14px;text-align:center;opacity:.6;">…</td></tr>';
  fetch('/api/invoices' + (qs.length ? '?' + qs.join('&') : ''))
    .then(function(r){ return r.json(); })
    .then(function(d){
      if(!d || !d.ok){ if(body) body.innerHTML = '<tr><td colspan="7" style="padding:14px;text-align:center;opacity:.6;">' + _ioEsc(t('invo.empty')) + '</td></tr>'; return; }
      var items = d.invoices || [];
      _ioItemsCache = items;
      _ioRenderBand(items);
      if(!items.length){ if(body) body.innerHTML = '<tr><td colspan="7" style="padding:14px;text-align:center;opacity:.6;">' + _ioEsc(t('invo.empty')) + '</td></tr>'; return; }
      var html = items.map(function(it){
        var num = ((it.serie || '') + ' ' + (it.numar || '')).trim() || '—';
        var dt = it.created_at ? String(it.created_at).slice(0,10) : '—';
        var amt = (it.total != null ? Number(it.total).toFixed(2) : '—') + ' ' + _ioEsc(it.valuta || '');
        var tva = it.tva != null ? Number(it.tva).toFixed(0) + '%' : '—';
        var ef = it.efactura_status ? '<span class="badge info">' + _ioEsc(it.efactura_status) + '</span>' : '<span style="opacity:.5;">—</span>';
        var acts = [];
        if(it.pdf_link) acts.push('<a class="btn ghost" style="padding:4px 10px;font-size:12px;" href="' + _ioEsc(it.pdf_link) + '" target="_blank" rel="noopener">PDF</a>');
        var st = String(it.status||'').toLowerCase();
        if(it.order_id && st !== 'cancelled' && st !== 'storno' && st !== 'canceled')
          acts.push('<button class="btn ghost" style="padding:4px 10px;font-size:12px;" onclick="invOutStorno(' + JSON.stringify(String(it.order_id)) + ')">' + _ioEsc(t('invo.storno')) + '</button>');
        acts.push('<button class="btn ghost" style="padding:4px 10px;font-size:12px;" onclick="invOutRefreshStatus(' + Number(it.id) + ')">' + _ioEsc(t('invo.refresh')) + '</button>');
        if (typeof window.sendTemplatedEmailDialog === 'function')
          acts.push('<button class="btn ghost" style="padding:4px 10px;font-size:12px;" title="' + _ioEsc(t('etpl.sendFromTpl')) + '" onclick="invOutSendTpl(' + Number(it.id) + ')">📧</button>');
        return '<tr>'
          + '<td style="padding:8px 10px;">' + _ioEsc(num) + '</td>'
          + '<td style="padding:8px 10px;">' + _ioEsc(it.client_name || '—') + '</td>'
          + '<td style="padding:8px 10px;">' + _ioEsc(dt) + '</td>'
          + '<td style="padding:8px 10px;text-align:right;">' + _ioEsc(amt) + '</td>'
          + '<td style="padding:8px 10px;text-align:right;">' + _ioEsc(tva) + '</td>'
          + '<td style="padding:8px 10px;">' + _ioStatusPill(it.status) + ' ' + ef + '</td>'
          + '<td style="padding:8px 10px;white-space:nowrap;">' + acts.join(' ') + '</td>'
          + '</tr>';
      }).join('');
      if(body) body.innerHTML = html;
    })
    .catch(function(){ if(body) body.innerHTML = '<tr><td colspan="7" style="padding:14px;text-align:center;opacity:.6;">' + _ioEsc(t('invo.empty')) + '</td></tr>'; });
}

function _ioRenderBand(items){
  var el = document.getElementById('invOutBand');
  if(!el || typeof vsMetricBand !== 'function') return;
  var total = items.length;
  var issued = items.filter(function(i){ return String(i.status||'').toLowerCase() === 'issued'; }).length;
  var cancelled = items.filter(function(i){ var s=String(i.status||'').toLowerCase(); return s==='cancelled'||s==='storno'||s==='canceled'; }).length;
  var sum = items.reduce(function(s,i){ return s + (Number(i.total)||0); }, 0);
  el.innerHTML = vsMetricBand([
    { l: t('invo.kpiTotal'), v: total, sub: '' },
    { l: t('invo.kpiIssued'), v: issued, sub: '' },
    { l: t('invo.kpiCancelled'), v: cancelled, sub: '' },
    { l: t('invo.kpiSum'), v: Math.round(sum), sub: '' }
  ]);
}

function invOutStorno(orderId){
  if(!confirm(t('invo.stornoConfirm'))) return;
  fetch('/api/orders/' + encodeURIComponent(orderId) + '/invoice/storno', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if(d && d.ok){ toast(t('invo.stornoOk'), 'ok'); loadInvoicesOut(); }
      else toast((d && d.error) || t('invo.stornoErr'), 'err');
    })
    .catch(function(){ toast(t('invo.stornoErr'), 'err'); });
}

// 📧 Számla-értesítő sablon küldése az ügyfélnek — a számla adatait a
// cache-ből olvassa (idézőjel-biztos), és a közös dialógust nyitja.
function invOutSendTpl(id){
  var it = (_ioItemsCache || []).find(function(x){ return Number(x.id) === Number(id); });
  if(!it || typeof window.sendTemplatedEmailDialog !== 'function') return;
  var num = ((it.serie || '') + ' ' + (it.numar || '')).trim();
  window.sendTemplatedEmailDialog({
    keys: ['invoice_notify', 'generic'],
    templateKey: 'invoice_notify',
    vars: { client: it.client_name || '', invoice_no: num, order_id: it.order_id ? String(it.order_id) : '' },
  });
}

function invOutRefreshStatus(id){
  fetch('/api/invoices/' + Number(id) + '/status', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if(d && d.ok){ toast(t('invo.refreshOk'), 'ok'); loadInvoicesOut(); }
      else toast((d && (d.message || d.error)) || t('invo.refreshErr'), 'err');
    })
    .catch(function(){ toast(t('invo.refreshErr'), 'err'); });
}
