/* mail-log.js — Levél-napló oldal (Admin/Manager).
 * A kiküldött rendszer-e-mailek listája. Csak megjelenítés.
 * Backend RPC: mailLogList({from?,to?}). A `gas()` és `t()` a console-shared.js-ből.
 */
function _mlEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function _mlT(k) { return (typeof t === 'function') ? t(k) : k; }

function _mlStatusPill(st) {
  var s = String(st || '').toLowerCase();
  if (s === 'sent') return '<span class="badge ok">' + _mlEsc(_mlT('mlog.stSent')) + '</span>';
  if (s === 'failed') return '<span class="badge err">' + _mlEsc(_mlT('mlog.stFailed')) + '</span>';
  return '<span class="badge info">' + _mlEsc(st || '—') + '</span>';
}

function loadMailLog() {
  var body = document.getElementById('mailLogBody');
  if (!body) return;
  var fEl = document.getElementById('mlFrom'), tEl = document.getElementById('mlTo');
  var a = {};
  if (fEl && fEl.value) a.from = fEl.value;
  if (tEl && tEl.value) { var d = new Date(tEl.value); d.setDate(d.getDate() + 1); a.to = d.toISOString().slice(0, 10); }
  body.innerHTML = '<tr><td colspan="5" style="padding:14px;text-align:center;opacity:.6;">…</td></tr>';
  gas('mailLogList', [a]).then(function (r) {
    if (!r || !r.ok) { body.innerHTML = '<tr><td colspan="5" style="padding:14px;text-align:center;opacity:.6;">' + _mlEsc(_mlT('mlog.empty')) + '</td></tr>'; return; }
    var items = r.items || [];
    if (!items.length) { body.innerHTML = '<tr><td colspan="5" style="padding:14px;text-align:center;opacity:.6;">' + _mlEsc(_mlT('mlog.empty')) + '</td></tr>'; return; }
    body.innerHTML = items.map(function (it) {
      var dt = it.created_at ? String(it.created_at).replace('T', ' ').slice(0, 16) : '—';
      return '<tr>'
        + '<td style="padding:8px 10px;white-space:nowrap;">' + _mlEsc(dt) + '</td>'
        + '<td style="padding:8px 10px;">' + _mlEsc(it.to_email || '—') + '</td>'
        + '<td style="padding:8px 10px;">' + _mlEsc(it.subject || '—') + '</td>'
        + '<td style="padding:8px 10px;">' + _mlEsc(it.type || '—') + '</td>'
        + '<td style="padding:8px 10px;">' + _mlStatusPill(it.status) + '</td>'
        + '</tr>';
    }).join('');
  }).catch(function () {
    body.innerHTML = '<tr><td colspan="5" style="padding:14px;text-align:center;opacity:.6;">' + _mlEsc(_mlT('mlog.empty')) + '</td></tr>';
  });
}
