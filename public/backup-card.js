// public/backup-card.js
// 🛡️ Éjszakai biztonsági mentés (titkosítva, a VallorSoft Cloudflare-tárhelyén) — Integrációk fül (csak Admin).
// Backend: backupGetStatus / backupSaveSettings / backupRunNow / backupRestore* (handlers/backup.js).
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
    h += '<div style="margin-bottom:14px;"><span class="badge ok" style="padding:6px 10px;">🔒 ' + esc(tt('bk.storage', 'Stocare criptată pe serverele VallorSoft (Cloudflare)')) + '</span>'
      + '<div style="font-size:12px;color:var(--muted);margin-top:6px;">' + esc(tt('bk.keepRule', 'Ultimele {d} zile: copie zilnică; după aceea o copie pe lună, pe perioada aleasă.', { d: d.daily_keep_days || 30 })) + '</div></div>';
    // Beállítások
    var hours = ''; for (var i = 0; i < 24; i++) hours += '<option value="' + i + '"' + (i === d.run_hour ? ' selected' : '') + '>' + (i < 10 ? '0' : '') + i + ':00</option>';
    var rets = (d.retention_options || ['365']).map(function (r) {
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
      + '<button class="btn" ' + (d.running ? 'disabled' : '') + ' onclick="BackupCard.runNow(this)">' + esc(d.running ? tt('bk.running') : tt('bk.runNow')) + '</button>'
      + '</div>';
    // Napló
    h += '<div style="font-weight:700;font-size:13px;margin:6px 0;color:var(--text-primary);">' + esc(tt('bk.history')) + '</div>';
    if (!d.runs || !d.runs.length) {
      h += '<div style="font-size:12px;color:var(--muted);">' + esc(tt('bk.noRuns')) + '</div>';
    } else {
      h += '<div style="overflow-x:auto;"><table class="table" style="font-size:12px;"><thead><tr>'
        + '<th>' + esc(tt('bk.c.date')) + '</th><th>' + esc(tt('bk.c.trigger')) + '</th><th>' + esc(tt('bk.c.size')) + '</th>'
        + '<th>' + esc(tt('bk.c.rows')) + '</th><th>' + esc(tt('bk.c.status')) + '</th><th></th>'
        + '</tr></thead><tbody>'
        + d.runs.map(function (r) {
          return '<tr' + (r.error ? ' title="' + esc(r.error) + '"' : '') + '><td>' + esc(fmtDate(r.started_at)) + '</td><td>' + esc(tt('bk.tr.' + r.trigger, r.trigger)) + '</td>'
            + '<td>' + esc(fmtSize(r.size_bytes)) + '</td><td>' + esc(r.row_count != null ? r.row_count.toLocaleString('ro-RO') : '—') + '</td>'
            + '<td>' + esc(st(r.status)) + (r.r2_status === 'deleted' ? ' · ' + esc(tt('bk.st.deleted', 'șters')) : '') + '</td>'
            + '<td style="white-space:nowrap;">' + restoreBtns(r) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    h += '<div style="font-size:12px;color:var(--muted);margin-top:10px;">' + esc(tt('bk.restoreHint')) + '</div>'
      + '<div id="bkRestoreBox" style="margin-top:12px;"></div></div>';
    box.innerHTML = h;
    loadRestore();
    // Futó mentésnél frissítünk, amíg be nem fejeződik.
    clearTimeout(_poll);
    var running = d.running || (d.runs || []).some(function (r) { return r.status === 'running'; });
    if (running) _poll = setTimeout(load, 15000);
  }

  // ---- Visszaállítás ----
  var _rPoll = null, _confirmWord = 'RESTAURARE';
  function restoreBtns(r) {
    if (r.status !== 'ok' || !r.has_copy) return '';
    return '<button class="btn ghost" style="padding:3px 8px;font-size:11px;" onclick="BackupCard.restoreStart(' + r.id + ')">↩️ ' + esc(tt('bk.r.restore', 'Restaurează')) + '</button>';
  }
  function renderRestore(j) {
    var el = document.getElementById('bkRestoreBox'); if (!el) return;
    clearTimeout(_rPoll);
    if (!j) { el.innerHTML = ''; return; }
    var h = '<div class="glass-soft" style="padding:14px;">';
    h += '<div style="font-weight:700;margin-bottom:6px;color:var(--text-primary);">↩️ ' + esc(tt('bk.r.title')) + ' — ' + esc(fmtDate(j.created_at)) + '</div>';
    if (j.status === 'analyzing' || j.status === 'restoring') {
      h += '<div style="font-size:13px;">⏳ ' + esc(tt(j.status === 'analyzing' ? 'bk.r.analyzing' : 'bk.r.restoring')) + '</div>';
      _rPoll = setTimeout(loadRestore, 5000);
    } else if (j.status === 'error') {
      h += '<div style="font-size:13px;color:var(--status-danger);">❌ ' + esc(j.error || tt('common.error', 'Eroare')) + '</div>';
    } else if (j.status === 'preview_ready' && j.preview) {
      var p = j.preview;
      h += '<div style="font-size:13px;margin-bottom:6px;">' + esc(tt('bk.r.backupFrom')) + ' <b>' + esc(fmtDate(p.backup_created_at)) + '</b></div>';
      if (!p.total_missing) {
        h += '<div style="font-size:13px;">✅ ' + esc(tt('bk.r.nothing')) + '</div>';
      } else {
        h += '<div style="font-size:13px;margin-bottom:6px;">' + esc(tt('bk.r.missing', '', { n: p.total_missing.toLocaleString('ro-RO') })) + '</div>'
          + '<table class="table" style="font-size:12px;max-width:520px;"><thead><tr><th>' + esc(tt('bk.r.table')) + '</th><th style="text-align:right;">' + esc(tt('bk.r.rowsBack')) + '</th></tr></thead><tbody>'
          + p.tables.filter(function (t) { return t.missing > 0; }).map(function (t) {
            return '<tr><td>' + esc(t.table) + '</td><td style="text-align:right;">' + esc(t.missing.toLocaleString('ro-RO')) + '</td></tr>';
          }).join('') + '</tbody></table>'
          + '<div style="font-size:12px;color:var(--muted);margin:8px 0;">' + esc(tt('bk.r.safe')) + '</div>'
          + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">'
          + '<input class="input" id="bkRestoreConfirm" style="max-width:200px;" placeholder="' + esc(_confirmWord) + '">'
          + '<button class="btn primary" onclick="BackupCard.restoreConfirm(' + j.id + ',this)">' + esc(tt('bk.r.go')) + '</button></div>'
          + '<div style="font-size:12px;color:var(--muted);margin-top:4px;">' + esc(tt('bk.r.typeWord', '', { w: _confirmWord })) + '</div>';
      }
    } else if (j.status === 'done' && j.result) {
      h += '<div style="font-size:13px;">✅ ' + esc(tt('bk.r.done', '', { n: (j.result.inserted || 0).toLocaleString('ro-RO') })) + '</div>';
      if (j.result.failed) h += '<div style="font-size:12px;color:var(--status-warn);margin-top:4px;">⚠️ ' + esc(tt('bk.r.failed', '', { n: j.result.failed })) + '</div>';
    }
    h += '</div>';
    el.innerHTML = h;
  }
  function loadRestore(jobId) {
    gas('backupRestoreStatus', [jobId ? { job_id: jobId } : {}]).then(function (d) {
      if (!d || !d.ok) return;
      if (d.confirm_word) _confirmWord = d.confirm_word;
      renderRestore(d.job);
    }).catch(function () {});
  }
  function restoreStart(runId) {
    if (!confirm(tt('bk.r.startConfirm'))) return;
    gas('backupRestorePreview', [{ run_id: runId }]).then(function (d) {
      if (d && d.ok) { renderRestore(d.job); var el = document.getElementById('bkRestoreBox'); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      else toast((d && d.err) || tt('common.error', 'Eroare'), 'err');
    });
  }
  function restoreConfirm(jobId, btn) {
    var v = (document.getElementById('bkRestoreConfirm') || {}).value || '';
    if (v.trim().toUpperCase() !== _confirmWord) { toast(tt('bk.r.typeWord', '', { w: _confirmWord }), 'err'); return; }
    if (btn) btn.disabled = true;
    gas('backupRestoreConfirm', [{ job_id: jobId, confirm: v }]).then(function (d) {
      if (d && d.ok) renderRestore(Object.assign({}, d.job, { status: 'restoring' }));
      else { if (btn) btn.disabled = false; toast((d && d.err) || tt('common.error', 'Eroare'), 'err'); }
    });
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
  function runNow(btn) {
    if (btn) btn.disabled = true;
    gas('backupRunNow').then(function (d) {
      if (d && d.ok) { toast(tt('bk.started'), 'ok'); setTimeout(load, 3000); }
      else { if (btn) btn.disabled = false; toast((d && d.err) || tt('common.error', 'Eroare'), 'err'); }
    });
  }

  return { mount: mount, save: save, runNow: runNow, reload: load,
    restoreStart: restoreStart, restoreConfirm: restoreConfirm };
})();
