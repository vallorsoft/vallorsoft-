// VallorSoft — legal-ack.js
// Jogi oldal visszaigazolás modal (minden felhasználó-típusnál, románul)
(function () {
  'use strict';

  let _pending = [];
  let _currentIdx = 0;

  async function checkPending() {
    try {
      const r    = await fetch('/api/legal/pending-ack');
      const data = await r.json();
      if (data.ok && data.pending && data.pending.length) {
        _pending     = data.pending;
        _currentIdx  = 0;
        showModal(_pending[0]);
      }
    } catch (_) {}
  }

  function showModal(item) {
    const existing = document.getElementById('vs-legal-ack-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'vs-legal-ack-overlay';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'background:rgba(5,7,11,.92)', 'z-index:99999',
      'display:flex', 'align-items:center', 'justify-content:center', 'padding:1rem',
      'backdrop-filter:blur(6px)',
    ].join(';');

    const counter = _pending.length > 1
      ? `<span style="color:#9ca6b5;font-size:.78rem;white-space:nowrap">${_currentIdx + 1} / ${_pending.length}</span>`
      : '';

    const diffSection = item.diff_html
      ? `<div style="font-size:.82rem;line-height:1.65">${item.diff_html}</div>`
      : `<p style="color:#9ca6b5;font-size:.84rem">Document actualizat. Vă rugăm să citiți versiunea completă.</p>`;

    overlay.innerHTML = `
      <div style="
        background:#0c1218;border:1px solid rgba(99,102,241,.35);border-radius:18px;
        max-width:640px;width:100%;max-height:85vh;overflow:hidden;
        display:flex;flex-direction:column;
        box-shadow:0 0 60px rgba(99,102,241,.18),0 24px 48px rgba(0,0,0,.5)">

        <!-- fejléc -->
        <div style="padding:1.4rem 1.6rem;border-bottom:1px solid rgba(255,255,255,.08)">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:.8rem">
            <h3 style="margin:0;color:#e9eef5;font-size:1rem;font-weight:700">
              📋 Actualizare document: <span style="color:#6366f1">${escHtml(item.page_name)}</span>
            </h3>
            ${counter}
          </div>
          <p style="margin:.35rem 0 0;color:#9ca6b5;font-size:.8rem">
            Ultima actualizare: <strong style="color:#e9eef5">${escHtml(item.updated_at)}</strong>
          </p>
        </div>

        <!-- tartalom / diff -->
        <div style="flex:1;overflow-y:auto;padding:1.2rem 1.6rem">
          <p style="color:#8a97a8;font-size:.8rem;margin:0 0 .8rem">
            Rezumatul modificărilor față de versiunea anterioară:
          </p>
          ${diffSection}
        </div>

        <!-- lábléc -->
        <div style="padding:1.2rem 1.6rem;border-top:1px solid rgba(255,255,255,.08)">
          <a href="${escHtml(item.link)}" target="_blank" rel="noopener" style="
            display:block;text-align:center;color:#6366f1;font-size:.82rem;
            margin-bottom:.9rem;text-decoration:none;
            padding:.45rem;border:1px solid rgba(99,102,241,.3);border-radius:8px;
            transition:background .15s">
            📄 Citește documentul complet →
          </a>
          <button id="vs-legal-ack-btn" style="
            width:100%;padding:.8rem;
            background:linear-gradient(135deg,#6366f1 0%,#4f46e5 100%);
            color:#fff;border:none;border-radius:10px;
            font-size:.95rem;font-weight:700;cursor:pointer;
            box-shadow:0 0 20px rgba(99,102,241,.35);
            transition:opacity .2s">
            Am luat la cunoștință
          </button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    document.getElementById('vs-legal-ack-btn').addEventListener('click', async () => {
      const btn = document.getElementById('vs-legal-ack-btn');
      btn.disabled = true;
      btn.textContent = 'Se înregistrează...';
      try {
        await fetch('/api/legal/ack', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page_key: item.page_key, version: item.version }),
        });
      } catch (_) {}
      overlay.remove();
      _currentIdx++;
      if (_currentIdx < _pending.length) showModal(_pending[_currentIdx]);
    });
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkPending);
  } else {
    checkPending();
  }
})();
