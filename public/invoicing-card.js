// public/invoicing-card.js  — Integrációk fül: számlázó beállítása. InvoicingCard.mount('konténerId')
(window.registerI18n||function(d){(window.__i18nQueue=window.__i18nQueue||[]).push(d);})({
  'bil.ic.title': { hu: 'Fuvar-számlázás — ügyfeleknek', ro: 'Facturare transport — pentru clienți' },
  'bil.ic.sub': { hu: 'Ezt használja a fuvarok 🧾 gombja (számla + storno) · FGO', ro: 'Folosit de butonul 🧾 al transporturilor (factură + storno) · FGO' },
  'bil.ic.notSet': { hu: 'Nincs beállítva', ro: 'Neconfigurat' },
  'bil.ic.provider': { hu: 'Szolgáltató', ro: 'Furnizor' },
  'bil.ic.soon': { hu: ' (hamarosan)', ro: ' (în curând)' },
  'bil.ic.env': { hu: 'Környezet', ro: 'Mediu' },
  'bil.ic.envTest': { hu: 'Teszt', ro: 'Test' },
  'bil.ic.envProd': { hu: 'Éles', ro: 'Producție' },
  'bil.ic.codUnic': { hu: 'CodUnic (cég CUI)', ro: 'CodUnic (CUI firmă)' },
  'bil.ic.privateKey': { hu: 'PrivateKey', ro: 'PrivateKey' },
  'bil.ic.keyPh': { hu: 'FGO privát kulcs', ro: 'cheie privată FGO' },
  'bil.ic.series': { hu: 'Sorozatok (vesszővel, az első az alapértelmezett)', ro: 'Serii (separate prin virgulă, prima este implicită)' },
  'bil.ic.seriesHint': { hu: 'A modalban legördülőből választható.', ro: 'Se poate alege din listă în fereastră.' },
  'bil.ic.defLabel': { hu: 'Alapértelmezett tétel-megnevezés', ro: 'Denumire articol implicită' },
  'bil.ic.currency': { hu: 'Pénznem', ro: 'Monedă' },
  'bil.ic.defTva': { hu: 'Alap ÁFA %', ro: 'TVA implicit %' },
  'bil.ic.scad': { hu: 'Fizetési határidő (nap)', ro: 'Termen de plată (zile)' },
  'bil.ic.vatPayer': { hu: 'ÁFA-alany vagyunk', ro: 'Suntem plătitori de TVA' },
  'bil.ic.saveOn': { hu: 'Mentés és bekapcsolás', ro: 'Salvează și activează' },
  'bil.ic.testConn': { hu: '🔌 Kapcsolat tesztelése', ro: '🔌 Testează conexiunea' },
  'bil.ic.noContainer': { hu: 'invoicing-card: nincs konténer', ro: 'invoicing-card: lipsește containerul' },
  'bil.ic.err': { hu: 'Hiba', ro: 'Eroare' },
  'bil.ic.fwActive': { hu: 'ℹ️ Az univerzális számlázó-integráció aktív ({p}) — a fuvar-számlázás azon keresztül megy. Ez a kártya a régi FGO-beállítást kezeli.', ro: 'ℹ️ Integrarea universală de facturare este activă ({p}) — facturarea transporturilor merge prin ea. Acest card gestionează vechea configurare FGO.' },
  'bil.ic.connectedAs': { hu: 'Bekapcsolva: ', ro: 'Activat: ' },
  'bil.ic.saving': { hu: 'Mentés…', ro: 'Se salvează…' },
  'bil.ic.savedOn': { hu: 'Elmentve és bekapcsolva.', ro: 'Salvat și activat.' },
  'bil.ic.testingFgo': { hu: 'FGO kapcsolat tesztelése… (a legutóbb mentett adatokkal)', ro: 'Se testează conexiunea FGO… (cu datele salvate ultima dată)' },
  'bil.ic.connOk': { hu: 'Kapcsolat OK.', ro: 'Conexiune OK.' },
  'bil.ic.connFail': { hu: 'Sikertelen.', ro: 'Eșuat.' }
});
function T(k,v){return (typeof window.t==='function')?window.t(k,v):k;}
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
  function buildMarkup(){ return `
  <div class="inv-card">
    <div class="inv-head"><div><div class="inv-title">${T('bil.ic.title')}</div><div class="inv-sub">${T('bil.ic.sub')}</div></div>
      <span class="inv-badge inv-badge--off" id="invBadge">${T('bil.ic.notSet')}</span></div>
    <div class="inv-grid">
      <label class="inv-l">${T('bil.ic.provider')}<select id="invProvider" class="inv-in"><option value="fgo">FGO</option><option value="smartbill" disabled>SmartBill${T('bil.ic.soon')}</option><option value="oblio" disabled>Oblio${T('bil.ic.soon')}</option></select></label>
      <label class="inv-l">${T('bil.ic.env')}<select id="invEnv" class="inv-in"><option value="test">${T('bil.ic.envTest')}</option><option value="production">${T('bil.ic.envProd')}</option></select></label>
      <label class="inv-l">${T('bil.ic.codUnic')}<input id="invCod" class="inv-in" autocomplete="off" placeholder="2864518"></label>
      <label class="inv-l">${T('bil.ic.privateKey')}<input id="invKey" type="password" class="inv-in" autocomplete="off" placeholder="${T('bil.ic.keyPh')}"></label>
      <label class="inv-l full">${T('bil.ic.series')}<input id="invSeries" class="inv-in" placeholder="VLR, VLR2"><span class="inv-hint">${T('bil.ic.seriesHint')}</span></label>
      <label class="inv-l full">${T('bil.ic.defLabel')}<input id="invLabel" class="inv-in" placeholder="Transport marfă conform contractului/comenzii"></label>
      <label class="inv-l">${T('bil.ic.currency')}<input id="invCurrency" class="inv-in" value="RON"></label>
      <label class="inv-l">${T('bil.ic.defTva')}<input id="invTva" type="number" class="inv-in" value="21"></label>
      <label class="inv-l">${T('bil.ic.scad')}<input id="invScad" type="number" class="inv-in" placeholder="30"></label>
      <label class="inv-l inv-check"><input id="invVat" type="checkbox" checked> ${T('bil.ic.vatPayer')}</label>
    </div>
    <div class="inv-msg" id="invMsg"></div>
    <div class="inv-actions"><button class="inv-btn inv-btn--primary" id="invSave">${T('bil.ic.saveOn')}</button><button class="inv-btn inv-btn--ghost" id="invTest">${T('bil.ic.testConn')}</button></div>
  </div>`; }
  function ensureStyle(){ if(!document.getElementById('inv-card-style')){const s=document.createElement('style');s.id='inv-card-style';s.textContent=STYLE;document.head.appendChild(s);} }
  async function api(m,u,b){const r=await fetch(u,{method:m,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||(T('bil.ic.err')+' '+r.status));return d;}
  let _lastTarget=null;
  function mount(target){
    const el = typeof target==='string'?document.getElementById(target):target;
    if(!el){console.warn(T('bil.ic.noContainer'));return;}
    _lastTarget=target;
    ensureStyle(); el.innerHTML = buildMarkup();
    const $=id=>el.querySelector('#'+id);
    const setMsg=(t,k)=>{$('invMsg').textContent=t||'';$('invMsg').className='inv-msg'+(k?' inv-msg--'+k:'');};
    const load=async()=>{ try{ const s=await api('GET','/api/integrations/invoicing'); if(s.framework_active){ setMsg(T('bil.ic.fwActive',{p:(s.framework_provider||'').toUpperCase()}),'ok'); } if(s.connected){ $('invBadge').textContent=T('bil.ic.connectedAs')+(s.provider||'').toUpperCase(); $('invBadge').className='inv-badge inv-badge--ok'; const m=s.meta||{}; if(s.provider)$('invProvider').value=s.provider; if(m.environment)$('invEnv').value=m.environment; if(m.series)$('invSeries').value=(m.series||[]).join(', '); if(m.article_label)$('invLabel').value=m.article_label; if(m.currency)$('invCurrency').value=m.currency; if(m.default_tva!=null)$('invTva').value=m.default_tva; if(m.scadenta_days!=null)$('invScad').value=m.scadenta_days; $('invVat').checked=m.vat_payer!==false; if(s.masked_key)$('invKey').placeholder=s.masked_key; } }catch(e){setMsg(e.message,'err');} };
    $('invSave').addEventListener('click', async ()=>{ setMsg(T('bil.ic.saving')); try{ await api('POST','/api/integrations/invoicing',{ provider:$('invProvider').value, environment:$('invEnv').value, cod_unic:$('invCod').value, private_key:$('invKey').value, series:$('invSeries').value, article_label:$('invLabel').value, currency:$('invCurrency').value, default_tva:$('invTva').value, scadenta_days:$('invScad').value, vat_payer:$('invVat').checked }); setMsg(T('bil.ic.savedOn'),'ok'); $('invKey').value=''; await load(); }catch(e){setMsg(e.message,'err');} });
    $('invTest').addEventListener('click', async ()=>{ setMsg(T('bil.ic.testingFgo')); try{ const r=await api('POST','/api/integrations/invoicing/test'); setMsg(r.message||(r.ok?T('bil.ic.connOk'):T('bil.ic.connFail')), r.ok?'ok':'err'); }catch(e){ setMsg(e.message,'err'); } });
    load();
  }
  if (window.I18N && typeof window.I18N.onLang === 'function') {
    window.I18N.onLang(function(){ if(_lastTarget){ const el = typeof _lastTarget==='string'?document.getElementById(_lastTarget):_lastTarget; if(el) mount(_lastTarget); } });
  }
  return { mount };
})();
