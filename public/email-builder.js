/* ============================================================
 *  VallorSoft — public/email-builder.js
 *  Vizuális e-mail sablon szerkesztő + kimenő levelező kliens.
 *
 *  Stack-illesztés (a generikus spec adaptálva ehhez a kódbázishoz):
 *    - Statikus oldal (NEM EJS) — a /api/execute RPC-t hívja (gas()).
 *    - GrapesJS + grapesjs-preset-newsletter a cdn.jsdelivr.net-ről (CSP).
 *    - NINCS multer/fájlfeltöltés: a HTML feltöltés FileReaderrel a böngészőben
 *      olvasódik; a képek base64/data-URL-ként ágyazódnak a GrapesJS asset
 *      managerébe (Render FS efemer → nem tárolunk fájlt szerveren). A céges
 *      logót a meglévő GET /api/branding/logo (dataUri) adja.
 *    - A küldés a szerveren a meglévő Brevo-küldőn megy + mail_log naplózás.
 * ============================================================ */
(function () {
  'use strict';

  // RPC-hívás: a /api/execute a d.result-ot adja vissza.
  function gas(fn, args) {
    return fetch('/api/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ functionName: fn, arguments: args || [] }),
    }).then(function (r) { return r.json(); }).then(function (d) { return d.result; })
      .catch(function () { return { ok: false, err: 'net' }; });
  }
  window.gas = window.gas || gas;

  function T(key, vars) { return (window.t ? window.t(key, vars) : key); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function toast(msg, type) {
    var box = document.getElementById('toast-box');
    var el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(function () { el.remove(); }, 3600);
  }

  // ── Állapot ──
  var editor = null;
  var editingId = null;       // null = új; szám = szerkesztés
  var allTemplates = [];
  var allContacts = [];

  // ── GrapesJS ──
  function initGjs(html, projectJson) {
    if (editor) { try { editor.destroy(); } catch (e) {} editor = null; }
    editor = grapesjs.init({
      container: '#gjs',
      height: '520px',
      width: 'auto',
      fromElement: false,
      storageManager: false,
      plugins: ['grapesjs-preset-newsletter'],
      pluginsOpts: {
        'grapesjs-preset-newsletter': {
          inlineCss: true,
          tableStyle: { width: '100%', border: '0', cellpadding: '0', cellspacing: '0' },
        },
      },
      // Képek base64/data-URL-ként a kliensoldalon (nincs upload endpoint;
      // Render FS efemer). A drop-pal beszúrt kép a kanvászba ágyazódik.
      assetManager: {
        embedAsBase64: true,
        upload: false,
        uploadText: 'Húzd ide vagy válassz képet (base64)',
      },
    });
    if (projectJson) {
      try { editor.loadProjectData(typeof projectJson === 'string' ? JSON.parse(projectJson) : projectJson); }
      catch (e) { if (html) editor.setComponents(html); }
    } else if (html) {
      editor.setComponents(html);
    }
    return editor;
  }

  function grapesData() {
    if (!editor) return { html: '', json: null };
    var html;
    try { html = editor.runCommand('gjs-get-inlined-html'); } catch (e) { html = null; }
    if (!html) html = editor.getHtml();
    var json = null;
    try { json = editor.getProjectData(); } catch (e) { json = null; }
    return { html: html || '', json: json };
  }

  // ── Panel-váltó ──
  var PANELS = ['create', 'gallery', 'browse', 'upload', 'pairing', 'sender'];
  window.ebSwitch = function (panel) {
    document.querySelectorAll('.eb-card').forEach(function (c) {
      c.classList.toggle('active', c.getAttribute('data-panel') === panel);
    });
    PANELS.forEach(function (p) {
      var sec = document.getElementById('sec-' + p);
      if (sec) sec.classList.toggle('active', p === panel);
    });
    if (panel === 'create' && !editor) initGjs();
    if (panel === 'gallery') loadGallery();
    if (panel === 'browse') loadBrowse();
    if (panel === 'pairing') loadPairing();
    if (panel === 'sender') loadSender();
  };

  // ── Galéria: mindenki számára elérhető, beépített kész sablonok ──
  function galleryName(g) {
    var lang = (window.I18N && window.I18N.get) ? window.I18N.get() : (localStorage.getItem('vs-lang') || 'ro');
    return (g.name && (g.name[lang] || g.name.ro || g.name.hu)) || g.key;
  }
  function loadGallery() {
    var grid = document.getElementById('gallery-grid');
    var list = window.EB_GALLERY || [];
    if (!grid) return;
    if (!list.length) { grid.innerHTML = '<p style="color:var(--muted)">—</p>'; return; }
    grid.innerHTML = list.map(function (g) {
      // Az élő HTML kicsinyített, kattintásmentes előnézete iframe-ben.
      var prev = '<iframe class="gprev" sandbox="" srcdoc="' + esc(g.html) + '"></iframe>';
      return '<div class="tplc gcard" style="--gac:' + esc(g.accent || '#f6711e') + ';">'
        + '<div class="gthumb">' + prev + '</div>'
        + '<div class="n">' + esc(galleryName(g)) + '</div>'
        + '<div class="a">'
        + '<button class="btn primary sm" onclick="ebUseGallery(\'' + esc(g.key) + '\')">' + esc(T('eb.useTemplate')) + '</button>'
        + '<button class="btn ghost sm" onclick="ebPreviewGallery(\'' + esc(g.key) + '\')">👁️</button>'
        + '</div></div>';
    }).join('');
  }

  function findGallery(key) {
    return (window.EB_GALLERY || []).filter(function (g) { return g.key === key; })[0];
  }

  window.ebUseGallery = function (key) {
    var g = findGallery(key);
    if (!g) return;
    ebSwitch('create');
    editingId = null; // a galériából mindig ÚJ sablon (nem írja felül a meglévőt)
    document.getElementById('tpl-name').value = galleryName(g);
    document.getElementById('tpl-subject').value = '';
    document.getElementById('btn-save-tpl').textContent = T('eb.saveTpl');
    initGjs(g.html);
    toast(T('eb.galleryLoaded'), 'success');
  };

  window.ebPreviewGallery = function (key) {
    var g = findGallery(key);
    if (!g) return;
    document.getElementById('pv-iframe').srcdoc = g.html;
    document.getElementById('pv-modal').style.display = 'flex';
  };

  // ── Panel 1: létrehozás / szerkesztés ──
  window.ebNewTemplate = function () {
    editingId = null;
    document.getElementById('tpl-name').value = '';
    document.getElementById('tpl-subject').value = '';
    document.getElementById('btn-save-tpl').textContent = T('eb.saveTpl');
    initGjs();
  };

  function fillCreate(tpl) {
    editingId = tpl ? tpl.id : null;
    document.getElementById('tpl-name').value = (tpl && tpl.name) || '';
    document.getElementById('tpl-subject').value = (tpl && tpl.subject) || '';
    document.getElementById('btn-save-tpl').textContent = editingId ? T('eb.updateTpl') : T('eb.saveTpl');
    initGjs(tpl && tpl.html_content, tpl && tpl.grapes_json);
  }

  window.ebInsertLogo = function () {
    fetch('/api/branding/logo').then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.has || !d.dataUri) { toast('—', 'warn'); return; }
      if (!editor) initGjs();
      // A logó data-URL-ként ágyazódik a kanvászba (nincs szerver-tárolás).
      editor.addComponents('<img src="' + d.dataUri + '" alt="logo" style="max-height:56px;display:block;margin:0 auto 12px;">');
    }).catch(function () { toast(T('eb.netErr'), 'error'); });
  };

  window.ebSaveTemplate = function () {
    var name = document.getElementById('tpl-name').value.trim();
    var subject = document.getElementById('tpl-subject').value.trim();
    if (!name) { toast(T('eb.needName'), 'error'); return; }
    var d = grapesData();
    var payload = { name: name, subject: subject, html_content: d.html, grapes_json: d.json };
    if (editingId) payload.id = editingId;
    gas('ebTemplateSave', [payload]).then(function (r) {
      if (r && r.ok) {
        editingId = r.id || editingId;
        document.getElementById('btn-save-tpl').textContent = T('eb.updateTpl');
        toast(T('eb.saved'), 'success');
        loadMainTable();
      } else {
        toast((r && r.err) || T('eb.netErr'), 'error');
      }
    });
  };

  // ── Panel 2: böngészés ──
  function loadBrowse() {
    gas('ebTemplateList').then(function (r) {
      var grid = document.getElementById('browse-grid');
      var rows = (r && r.ok && r.templates) || [];
      if (!rows.length) { grid.innerHTML = '<p style="color:var(--muted)">' + esc(T('eb.noTpls')) + '</p>'; return; }
      grid.innerHTML = rows.map(function (t) {
        return '<div class="tplc">'
          + '<div class="n">📄 ' + esc(t.name) + '</div>'
          + '<div class="s">' + esc(t.subject || '—') + '</div>'
          + '<div class="d">' + fmtDate(t.created_at) + '</div>'
          + '<div class="a">'
          + '<button class="btn primary sm" onclick="ebEdit(' + t.id + ')">' + esc(T('eb.edit')) + '</button>'
          + '<button class="btn ghost sm" onclick="ebPreview(' + t.id + ')">👁️</button>'
          + '<button class="btn danger sm" onclick="ebDelete(' + t.id + ')">🗑️</button>'
          + '</div></div>';
      }).join('');
    });
  }

  window.ebEdit = function (id) {
    gas('ebTemplateGet', [{ id: id }]).then(function (r) {
      if (r && r.ok && r.template) { ebSwitch('create'); fillCreate(r.template); }
      else toast((r && r.err) || T('eb.netErr'), 'error');
    });
  };

  window.ebPreview = function (id) {
    gas('ebTemplateGet', [{ id: id }]).then(function (r) {
      if (!(r && r.ok && r.template)) return;
      document.getElementById('pv-iframe').srcdoc = r.template.html_content || '<p>—</p>';
      document.getElementById('pv-modal').style.display = 'flex';
    });
  };

  window.ebDelete = function (id) {
    if (!confirm(T('eb.confirmDelTpl'))) return;
    gas('ebTemplateDelete', [{ id: id }]).then(function (r) {
      if (r && r.ok) { toast(T('eb.deleted'), 'success'); loadBrowse(); loadMainTable(); if (editingId === id) ebNewTemplate(); }
      else toast((r && r.err) || T('eb.netErr'), 'error');
    });
  };

  // ── Panel 3: HTML feltöltés (kliensoldali FileReader, nincs szerver-upload) ──
  window.ebLoadHtmlFile = function () {
    var f = document.getElementById('upload-file').files[0];
    if (!f) { toast(T('eb.needFile'), 'error'); return; }
    var rd = new FileReader();
    rd.onload = function () {
      ebSwitch('create');
      editingId = null;
      document.getElementById('btn-save-tpl').textContent = T('eb.saveTpl');
      initGjs(String(rd.result || ''));
      toast(T('eb.loadedToEditor'), 'success');
    };
    rd.onerror = function () { toast(T('eb.netErr'), 'error'); };
    rd.readAsText(f);
  };

  // ── Panel 4: párosítás & küldés ──
  function loadPairing() {
    Promise.all([gas('ebTemplateList'), gas('ebContactList'), gas('ebSenderGet')]).then(function (res) {
      allTemplates = (res[0] && res[0].ok && res[0].templates) || [];
      allContacts = (res[1] && res[1].ok && res[1].contacts) || [];
      renderTplSelect();
      renderContacts();
      // A renderContacts törli a pipákat — ha van kiválasztott sablon, a mentett
      // párosítást újra bejelöljük, hogy a kijelölés ne vesszen el kontakt-művelet után.
      if (document.getElementById('pair-tpl-sel').value) ebOnTplChange();
      loadSendLog();
      // Figyelmeztetés, ha nincs feladó-fiók beállítva (küldés enélkül nem megy).
      var warn = document.getElementById('pair-sender-warn');
      if (warn) {
        var s = res[2];
        if (s && s.ok && !s.configured) {
          warn.innerHTML = '<div class="it err" style="cursor:pointer" onclick="ebSwitch(\'sender\')">⚠️ '
            + esc(T('eb.noSenderWarn')) + '</div>';
        } else { warn.innerHTML = ''; }
      }
    });
  }

  function renderTplSelect() {
    var sel = document.getElementById('pair-tpl-sel');
    var cur = sel.value;
    sel.innerHTML = '<option value="">' + esc(T('eb.selTplPh')) + '</option>'
      + allTemplates.map(function (t) { return '<option value="' + t.id + '">' + esc(t.name) + '</option>'; }).join('');
    if (cur) sel.value = cur;
  }

  window.ebOnTplChange = function () {
    var tid = Number(document.getElementById('pair-tpl-sel').value);
    // A mentett párosítás visszatöltése (checkbox-előjelölés).
    document.querySelectorAll('.cc-check').forEach(function (c) { c.checked = false; });
    if (!tid) return;
    gas('ebPairingGet', [{ template_id: tid }]).then(function (r) {
      if (!(r && r.ok)) return;
      var set = {}; (r.contact_ids || []).forEach(function (id) { set[id] = true; });
      document.querySelectorAll('.cc-check').forEach(function (c) { c.checked = !!set[Number(c.value)]; });
    });
  };

  function renderContacts() {
    var tb = document.getElementById('contacts-tbody');
    if (!allContacts.length) {
      tb.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted)">' + esc(T('eb.noContacts')) + '</td></tr>';
      return;
    }
    tb.innerHTML = allContacts.map(function (c) {
      var typeLabel = { ugyfel: T('eb.typeUgyfel'), alvalalkozo: T('eb.typeAlv'), egyeb: T('eb.typeEgyeb') }[c.type] || c.type;
      return '<tr>'
        + '<td><input type="checkbox" class="cc-check" value="' + c.id + '"></td>'
        + '<td>' + esc(c.name) + '</td>'
        + '<td>' + esc(c.email) + '</td>'
        + '<td><span class="badge ' + esc(c.type) + '">' + esc(typeLabel) + '</span></td>'
        + '<td><button class="btn danger sm" onclick="ebDelContact(' + c.id + ')">🗑️</button></td>'
        + '</tr>';
    }).join('');
  }

  window.ebAddContact = function () {
    var name = document.getElementById('nc-name').value.trim();
    var email = document.getElementById('nc-email').value.trim();
    var type = document.getElementById('nc-type').value;
    if (!name || !email) { toast(T('eb.needNameEmail'), 'error'); return; }
    gas('ebContactSave', [{ name: name, email: email, type: type }]).then(function (r) {
      if (r && r.ok) {
        document.getElementById('nc-name').value = '';
        document.getElementById('nc-email').value = '';
        toast(T('eb.added'), 'success');
        loadPairing();
      } else toast((r && r.err) || T('eb.netErr'), 'error');
    });
  };

  window.ebDelContact = function (id) {
    if (!confirm(T('eb.confirmDelC'))) return;
    gas('ebContactDelete', [{ id: id }]).then(function (r) {
      if (r && r.ok) { toast(T('eb.deleted'), 'success'); loadPairing(); }
      else toast((r && r.err) || T('eb.netErr'), 'error');
    });
  };

  function selectedContactIds() {
    return Array.prototype.map.call(document.querySelectorAll('.cc-check:checked'), function (c) { return Number(c.value); });
  }
  function extraEmails() {
    return document.getElementById('extra-emails').value.split(',').map(function (e) { return e.trim(); }).filter(Boolean);
  }

  window.ebSavePairing = function () {
    var tid = Number(document.getElementById('pair-tpl-sel').value);
    if (!tid) { toast(T('eb.needTpl'), 'error'); return; }
    gas('ebPairingSave', [{ template_id: tid, contact_ids: selectedContactIds() }]).then(function (r) {
      if (r && r.ok) { toast(T('eb.pairSaved'), 'success'); loadMainTable(); }
      else toast((r && r.err) || T('eb.netErr'), 'error');
    });
  };

  window.ebSend = function () {
    var tid = Number(document.getElementById('pair-tpl-sel').value);
    if (!tid) { toast(T('eb.needTpl'), 'error'); return; }
    var ids = selectedContactIds();
    var extra = extraEmails();
    if (!ids.length && !extra.length) { toast(T('eb.needRcpt'), 'error'); return; }
    if (!confirm(T('eb.confirmSend') + ' (' + (ids.length + extra.length) + ')')) return;
    gas('ebSend', [{ template_id: tid, contact_ids: ids, extra_emails: extra }]).then(function (r) {
      if (!(r && r.ok)) { toast((r && r.err) || T('eb.netErr'), 'error'); return; }
      var nErr = (r.errors && r.errors.length) || 0;
      toast(T('eb.sendResult', { n: r.sent || 0, e: nErr }), nErr ? 'warn' : 'success');
      loadSendLog();
    });
  };

  function loadSendLog() {
    gas('ebSendLog').then(function (r) {
      var box = document.getElementById('send-log');
      var rows = (r && r.ok && r.logs) || [];
      if (!rows.length) { box.innerHTML = '<p style="color:var(--muted);font-size:.82rem">' + esc(T('eb.noLog')) + '</p>'; return; }
      box.innerHTML = rows.slice(0, 25).map(function (l) {
        var ok = l.status === 'sent';
        return '<div class="it ' + (ok ? 'ok' : 'err') + '">'
          + (ok ? '✅ ' : '❌ ') + '<strong>' + esc(l.to_email || '') + '</strong>'
          + (l.subject ? ' · ' + esc(l.subject) : '')
          + ' — ' + fmtDateTime(l.created_at)
          + '</div>';
      }).join('');
    });
  }

  // ── Alsó, mindig látható tábla ──
  function loadMainTable() {
    gas('ebTemplateList').then(function (r) {
      var tb = document.getElementById('main-tpl-tbody');
      var rows = (r && r.ok && r.templates) || [];
      if (!rows.length) { tb.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted)">' + esc(T('eb.noTpls')) + '</td></tr>'; return; }
      tb.innerHTML = rows.map(function (t) {
        return '<tr>'
          + '<td>' + esc(t.name) + '</td>'
          + '<td>' + esc(t.subject || '—') + '</td>'
          + '<td>' + fmtDate(t.created_at) + '</td>'
          + '<td>' + (t.pairing_count || 0) + '</td>'
          + '<td>'
          + '<button class="btn primary sm" onclick="ebEdit(' + t.id + ')">✏️</button> '
          + '<button class="btn ghost sm" onclick="ebPreview(' + t.id + ')">👁️</button> '
          + '<button class="btn danger sm" onclick="ebDelete(' + t.id + ')">🗑️</button>'
          + '</td></tr>';
      }).join('');
    });
  }

  // ── Panel 5: feladó-fiók (cég saját SMTP / Brevo) ──
  function loadSender() {
    gas('ebSenderGet').then(function (r) {
      var box = document.getElementById('sender-status');
      if (!(r && r.ok)) { if (box) box.innerHTML = ''; return; }
      if (r.configured) {
        document.getElementById('snd-prefer').value = r.prefer || 'smtp';
        document.getElementById('snd-fromname').value = r.from_name || '';
        document.getElementById('snd-fromemail').value = r.from_email || '';
        document.getElementById('snd-host').value = r.host || '';
        document.getElementById('snd-port').value = r.port || '';
        document.getElementById('snd-user').value = r.user || '';
        document.getElementById('snd-secure').checked = !!r.secure;
        document.getElementById('snd-pass').value = '';
        document.getElementById('snd-brevokey').value = '';
        if (box) box.innerHTML = '<div class="it ok">✅ ' + esc(T('eb.senderConfigured'))
          + (r.has_pass ? ' · SMTP' : '') + (r.has_brevo_key ? ' · Brevo' : '') + '</div>';
      } else if (box) {
        box.innerHTML = '<div class="it" style="color:var(--muted)">' + esc(T('eb.senderNotConfigured')) + '</div>';
      }
    });
  }

  window.ebSenderSave = function () {
    var payload = {
      prefer: document.getElementById('snd-prefer').value,
      from_name: document.getElementById('snd-fromname').value.trim(),
      from_email: document.getElementById('snd-fromemail').value.trim(),
      host: document.getElementById('snd-host').value.trim(),
      port: document.getElementById('snd-port').value.trim(),
      secure: document.getElementById('snd-secure').checked,
      user: document.getElementById('snd-user').value.trim(),
      pass: document.getElementById('snd-pass').value,
      brevo_api_key: document.getElementById('snd-brevokey').value,
    };
    gas('ebSenderSave', [payload]).then(function (r) {
      if (r && r.ok) { toast(T('eb.senderSaved'), 'success'); loadSender(); }
      else toast((r && r.err) || T('eb.netErr'), 'error');
    });
  };

  window.ebSenderTest = function () {
    toast(T('eb.testing'), 'info');
    gas('ebSenderTest').then(function (r) {
      if (r && r.ok) toast(r.message || T('eb.testSent'), 'success');
      else toast((r && r.err) || T('eb.netErr'), 'error');
    });
  };

  window.ebSenderDelete = function () {
    if (!confirm(T('eb.confirmDelSender'))) return;
    gas('ebSenderDelete').then(function (r) {
      if (r && r.ok) {
        toast(T('eb.senderDeleted'), 'success');
        ['snd-fromname', 'snd-fromemail', 'snd-host', 'snd-port', 'snd-user', 'snd-pass', 'snd-brevokey'].forEach(function (id) {
          var el = document.getElementById(id); if (el) el.value = '';
        });
        document.getElementById('snd-secure').checked = false;
        loadSender();
      } else toast((r && r.err) || T('eb.netErr'), 'error');
    });
  };

  function fmtDate(d) { try { return new Date(d).toLocaleDateString(); } catch (e) { return ''; } }
  function fmtDateTime(d) { try { return new Date(d).toLocaleString(); } catch (e) { return ''; } }

  // Nyelvváltáskor a dinamikus tartalom újrarajzolása.
  window.onLangChange = function () {
    loadMainTable();
    var act = document.querySelector('.eb-card.active');
    if (act && act.getAttribute('data-panel') === 'browse') loadBrowse();
    if (act && act.getAttribute('data-panel') === 'gallery') loadGallery();
    if (act && act.getAttribute('data-panel') === 'pairing') loadPairing();
    if (!editingId) document.getElementById('btn-save-tpl').textContent = T('eb.saveTpl');
  };

  // ── Boot ──
  function boot() {
    // "Vissza" cél a szerepkör szerint (Manager → /manager, egyébként /admin).
    gas('getMyFeatures').then(function (r) {
      var back = document.getElementById('ebBack');
      if (back && r && r.pozicio === 'Manager') back.setAttribute('href', '/manager');
    });
    initGjs();
    loadMainTable();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
