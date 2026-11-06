// public/backup-card.js
// 🛡️ Biztonsági mentés Google Drive-ba — Integrációk fül (csak Admin).
// Backend: backupGetStatus / backupSaveSettings / backupDisconnect / backupRunNow
// (handlers/backup.js); összekötés: /api/backup/google/connect?target=company.
window.BackupCard = (function () {
  function tt(k, fb, vars) { try { if (typeof t === 'function') { var v = t(k, vars); if (v && v !== k) return v; } } catch (e) {} return fb || k; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }); }
  function fmtSize(b) {
    if (b == null) return '—';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
  }
  function fmtDate(d) { try { return new Date(d).toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest' }); } catch (e) { return String(d || ''); } }
  function st(s) { return s ? tt('bk.st.' + s, s) : '—'; }
  var _box = null, _poll = null;

  function render(d) {
    var box = document.getElementById(_box); if (!box) return;
    if (!d || !d.ok) { box.innerHTML = ''; return; }
    if (d.feature === false) { box.innerHTML = ''; return; }
    var h = '<div class="glass" style="padding:22px;">'
      + '<h3 style="font-size:16px;margin:0 0 4px;color:var(--text-primary);">' + esc(tt('bk.title')) + '</h3>'
      + '<p style="color:var(--muted);font-size:13px;margin:0 0 14px;">' + esc(tt('bk.hint')) + '</p>';
    if (!d.configured) {
      h += '<div class="badge warn" style="display:inline-block;padding:8px 12px;">' + esc(tt('bk.noConfig')) + '</div></div>';
      box.innerHTML = h; return;
    }
    // Kapcsolat
    h += '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:14px;">';
    if (d.connected) {
      h += '<span class="badge ' + (d.status === 'error' ? 'err' : 'ok') + '" style="padding:6px 10px;">'
        + (d.status === 'error' ? '⚠️ ' : '✅ ') + esc(tt('bk.connectedAs')) + ' ' + esc(d.email || 'Google') + '</span>'
        + '<button class="btn ghost" style="padding:6px 12px;" onclick="BackupCard.disconnect()">' + esc(tt('bk.disconnect')) + '</button>';
      if (d.status_message) h += '<div style="width:100%;font-size:12px;color:var(--status-danger);">' + esc(d.status_message) + '</div>';
      h += '<div style="width:100%;font-size:12px;color:var(--muted);">' + esc(tt('bk.folder')) + ' <b>' + esc(d.folder_name) + '</b></div>';
    } else {
      h += '<span class="badge" style="padding:6px 10px;">' + esc(tt('bk.notConnected')) + '</span>'
        + '<a class="btn primary" style="padding:8px 14px;text-decoration:none;" href="/api/backup/google/connect?target=company">' + esc(tt('bk.connect')) + '</a>';
    }
    h += '</div>';
    // Beállítások
    var hours = ''; for (var i = 0; i < 24; i++) hours += '<option value="' + i + '"' + (i === d.run_hour ? ' selected' : '') + '>' + (i < 10 ? '0' : '') + i + ':00</option>';
    var rets = (d.retention_options || ['forever']).map(function (r) {
      return '<option value="' + esc(r) + '"' + (r === d.drive_retention ? ' selected' : '') + '>' + esc(tt('bk.ret.' + r, r)) + '</option>';
    }).join('');
    h += '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;margin:0 0 10px;">'
      + '<input type="checkbox" id="bkEnabled" ' + (d.enabled ? 'checked' : '') + ' style="width:16px;height:16px;cursor:pointer;"> ' + esc(tt('bk.enabled')) + '</label>'
      + '<div class="grid-2" style="gap:12px;">'
      + '<div class="field"><label>' + esc(tt('bk.hour')) + '</label><select class="select" id="bkHour">' + hours + '</select></div>'
      + '<div class="field"><label>' + esc(tt('bk.retention')) + '</label><select class="select" id="bkRetention">' + rets + '</select></div>'
      + '</div>'
      + '<div style="display:flex;gap:10px;flex-wrap:wrap;margin:4px 0 10px;">'
      + '<button class="btn primary" onclick="BackupCard.save()">' + esc(tt('common.save', 'Salvează')) + '</button>'
      + (d.connected ? '<button class="btn" ' + (d.running ? 'disabled' : '') + ' onclick="BackupCard.runNow(this)">' + esc(d.running ? tt('bk.running') : tt('bk.runNow')) + '</button>' : '')
      + '</div>';
    if (d.vs_copy) h += '<div style="font-size:12px;color:var(--muted);margin-bottom:12px;">' + esc(tt('bk.vsCopy', '', { n: d.vs_retention_days })) + '</div>';
    // Napló
    h += '<div style="font-weight:700;font-size:13px;margin:6px 0;color:var(--text-primary);">' + esc(tt('bk.history')) + '</div>';
    if (!d.runs || !d.runs.length) {
      h += '<div style="font-size:12px;color:var(--muted);">' + esc(tt('bk.noRuns')) + '</div>';
    } else {
      h += '<div style="overflow-x:auto;"><table class="table" style="font-size:12px;"><thead><tr>'
        + '<th>' + esc(tt('bk.c.date')) + '</th><th>' + esc(tt('bk.c.trigger')) + '</th><th>' + esc(tt('bk.c.size')) + '</th>'
        + '<th>' + esc(tt('bk.c.rows')) + '</th><th>' + esc(tt('bk.c.drive')) + '</th><th>' + esc(tt('bk.c.vs')) + '</th><th>' + esc(tt('bk.c.status')) + '</th>'
        + '</tr></thead><tbody>'
        + d.runs.map(function (r) {
          return '<tr' + (r.error ? ' title="' + esc(r.error) + '"' : '') + '><td>' + esc(fmtDate(r.started_at)) + '</td><td>' + esc(tt('bk.tr.' + r.trigger, r.trigger)) + '</td>'
            + '<td>' + esc(fmtSize(r.size_bytes)) + '</td><td>' + esc(r.row_count != null ? r.row_count.toLocaleString('ro-RO') : '—') + '</td>'
            + '<td>' + esc(st(r.drive_status)) + '</td><td>' + esc(st(r.vs_status)) + '</td><td>' + esc(st(r.status)) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    h += '<div style="font-size:12px;color:var(--muted);margin-top:10px;">' + esc(tt('bk.restoreSoon')) + '</div></div>';
    box.innerHTML = h;
    // Futó mentésnél frissítünk, amíg be nem fejeződik.
    clearTimeout(_poll);
    var running = d.running || (d.runs || []).some(function (r) { return r.status === 'running'; });
    if (running) _poll = setTimeout(load, 15000);
  }

  function load() { gas('backupGetStatus').then(render).catch(function () {}); }
  function mount(boxId) { _box = boxId; load(); }

  function save() {
    gas('backupSaveSettings', [{
      enabled: !!(document.getElementById('bkEnabled') || {}).checked,
      run_hour: parseInt((document.getElementById('bkHour') || {}).value, 10),
      drive_retention: (document.getElementById('bkRetention') || {}).value,
    }]).then(function (d) {
      if (d && d.ok) { toast(tt('bk.saved'), 'ok'); load(); } else toast((d && d.err) || tt('common.error', 'Eroare'), 'err');
    });
  }
  function disconnect() {
    if (!confirm(tt('bk.disconnectConfirm'))) return;
    gas('backupDisconnect').then(function (d) { if (d && d.ok) load(); else toast((d && d.err) || tt('common.error', 'Eroare'), 'err'); });
  }
  function runNow(btn) {
    if (btn) btn.disabled = true;
    gas('backupRunNow').then(function (d) {
      if (d && d.ok) { toast(tt('bk.started'), 'ok'); setTimeout(load, 3000); }
      else { if (btn) btn.disabled = false; toast((d && d.err) || tt('common.error', 'Eroare'), 'err'); }
    });
  }

  // Visszatérés a Google összekötésből (/admin?gdrive=…): jelzés + Integrációk fül.
  document.addEventListener('DOMContentLoaded', function () {
    var m = /[?&]gdrive=([a-z]+)/.exec(location.search || '');
    if (!m) return;
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
    setTimeout(function () {
      if (typeof toast === 'function') toast(tt('bk.cb.' + m[1], m[1]), m[1] === 'ok' ? 'ok' : 'err');
      if (typeof activateTab === 'function') activateTab('integrations');
    }, 800);
  });

  return { mount: mount, save: save, disconnect: disconnect, runNow: runNow, reload: load };
})();
