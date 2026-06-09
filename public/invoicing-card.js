// public/invoicing-card.js  — Integrációk fül: számlázó beállítása. InvoicingCard.mount('konténerId')
window.InvoicingCard = (function () {
  const STYLE = `
  .inv-card{max-width:640px;border:1px solid #e2e6ee;border-radius:12px;padding:16px;background:#fff;font-family:inherit}
  .inv-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px}
  .inv-title{font-weight:600;font-size:16px}.inv-sub{font-size:13px;color:#6b7280;margin-top:2px}
  .inv-badge{font-size:12px;font-weight:600;border-radius:999px;padding:4px 10px}
  .inv-badge--off{background:#eef1f6;color:#5b6577}.inv-badge--ok{background:#e7f6ec;color:#1a7f37}
  .inv-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .inv-l{display:flex;flex-direction:column;font-size:13px;color:#374151;gap:6px}
  .inv-l.full{grid-column:1/-1}.inv-check{flex-direction:row;align-items:center;gap:8px;align-self:end}
  .inv-in{font-size:16px;padding:9px 11px;border:1px solid #d0d5dd;border-radius:8px}
  .inv-hint{font-size:11px;color:#9aa3b2}
  .inv-msg{font-size:13px;min-height:18px;margin:10px 0}.inv-msg--ok{color:#1a7f37}.inv-msg--err{color:#c0341a}
  .inv-actions{display:flex;gap:8px}
  .inv-btn{font-size:14px;padding:9px 14px;border-radius:8px;border:1px solid transparent;cursor:pointer;touch-action:manipulation}
  .inv-btn--primary{background:#2563eb;color:#fff}.inv-btn--ghost{background:#fff;border-color:#d0d5dd;color:#374151}
  @media(max-width:560px){.inv-grid{grid-template-columns:1fr}}`;
  const MARKUP = `
  <div class="inv-card">
    <div class="inv-head"><div><div class="inv-title">Fuvar-számlázás — ügyfeleknek</div><div class="inv-sub">Ezt használja a fuvarok 🧾 gombja (számla + storno) · FGO</div></div>
      <span class="inv-badge inv-badge--off" id="invBadge">Nincs beállítva</span></div>
    <div class="inv-grid">
      <label class="inv-l">Szolgáltató<select id="invProvider" class="inv-in"><option value="fgo">FGO</option><option value="smartbill" disabled>SmartBill (hamarosan)</option><option value="oblio" disabled>Oblio (hamarosan)</option></select></label>
      <label class="inv-l">Környezet<select id="invEnv" class="inv-in"><option value="test">Teszt</option><option value="production">Éles</option></select></label>
      <label class="inv-l">CodUnic (cég CUI)<input id="invCod" class="inv-in" autocomplete="off" placeholder="2864518"></label>
      <label class="inv-l">PrivateKey<input id="invKey" type="password" class="inv-in" autocomplete="off" placeholder="FGO privát kulcs"></label>
      <label class="inv-l full">Sorozatok (vesszővel, az első az alapértelmezett)<input id="invSeries" class="inv-in" placeholder="VLR, VLR2"><span class="inv-hint">A modalban legördülőből választható.</span></label>
      <label class="inv-l full">Alapértelmezett tétel-megnevezés<input id="invLabel" class="inv-in" placeholder="Transport marfă conform contractului/comenzii"></label>
      <label class="inv-l">Pénznem<input id="invCurrency" class="inv-in" value="RON"></label>
      <label class="inv-l">Alap ÁFA %<input id="invTva" type="number" class="inv-in" value="21"></label>
      <label class="inv-l">Fizetési határidő (nap)<input id="invScad" type="number" class="inv-in" placeholder="30"></label>
      <label class="inv-l inv-check"><input id="invVat" type="checkbox" checked> ÁFA-alany vagyunk</label>
    </div>
    <div class="inv-msg" id="invMsg"></div>
    <div class="inv-actions"><button class="inv-btn inv-btn--primary" id="invSave">Mentés és bekapcsolás</button><button class="inv-btn inv-btn--ghost" id="invTest">🔌 Kapcsolat tesztelése</button></div>
  </div>`;
  function ensureStyle(){ if(!document.getElementById('inv-card-style')){const s=document.createElement('style');s.id='inv-card-style';s.textContent=STYLE;document.head.appendChild(s);} }
  async function api(m,u,b){const r=await fetch(u,{method:m,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||('Hiba '+r.status));return d;}
  function mount(target){
    const el = typeof target==='string'?document.getElementById(target):target;
    if(!el){console.warn('invoicing-card: nincs konténer');return;}
    ensureStyle(); el.innerHTML = MARKUP;
    const $=id=>el.querySelector('#'+id);
    const setMsg=(t,k)=>{$('invMsg').textContent=t||'';$('invMsg').className='inv-msg'+(k?' inv-msg--'+k:'');};
    const load=async()=>{ try{ const s=await api('GET','/api/integrations/invoicing'); if(s.connected){ $('invBadge').textContent='Bekapcsolva: '+(s.provider||'').toUpperCase(); $('invBadge').className='inv-badge inv-badge--ok'; const m=s.meta||{}; if(s.provider)$('invProvider').value=s.provider; if(m.environment)$('invEnv').value=m.environment; if(m.series)$('invSeries').value=(m.series||[]).join(', '); if(m.article_label)$('invLabel').value=m.article_label; if(m.currency)$('invCurrency').value=m.currency; if(m.default_tva!=null)$('invTva').value=m.default_tva; if(m.scadenta_days!=null)$('invScad').value=m.scadenta_days; $('invVat').checked=m.vat_payer!==false; if(s.masked_key)$('invKey').placeholder=s.masked_key; } }catch(e){setMsg(e.message,'err');} };
    $('invSave').addEventListener('click', async ()=>{ setMsg('Mentés…'); try{ await api('POST','/api/integrations/invoicing',{ provider:$('invProvider').value, environment:$('invEnv').value, cod_unic:$('invCod').value, private_key:$('invKey').value, series:$('invSeries').value, article_label:$('invLabel').value, currency:$('invCurrency').value, default_tva:$('invTva').value, scadenta_days:$('invScad').value, vat_payer:$('invVat').checked }); setMsg('Elmentve és bekapcsolva.','ok'); $('invKey').value=''; await load(); }catch(e){setMsg(e.message,'err');} });
    $('invTest').addEventListener('click', async ()=>{ setMsg('FGO kapcsolat tesztelése… (a legutóbb mentett adatokkal)'); try{ const r=await api('POST','/api/integrations/invoicing/test'); setMsg(r.message||(r.ok?'Kapcsolat OK.':'Sikertelen.'), r.ok?'ok':'err'); }catch(e){ setMsg(e.message,'err'); } });
    load();
  }
  return { mount };
})();
