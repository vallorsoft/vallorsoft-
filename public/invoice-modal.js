// public/invoice-modal.js — "Számlázás" modal. Használat: InvoiceModal.open('CMD-1234')
(window.registerI18n||function(d){(window.__i18nQueue=window.__i18nQueue||[]).push(d);})({
  'bil.title': { hu: 'Számlázás', ro: 'Facturare' },
  'bil.loading': { hu: 'Betöltés…', ro: 'Se încarcă…' },
  'bil.err': { hu: 'Hiba', ro: 'Eroare' },
  'bil.sec.invoice': { hu: 'Számla', ro: 'Factură' },
  'bil.tip': { hu: 'Tip', ro: 'Tip' },
  'bil.serie': { hu: 'Serie', ro: 'Serie' },
  'bil.num': { hu: 'Szám', ro: 'Număr' },
  'bil.auto': { hu: 'automatikus', ro: 'automat' },
  'bil.currency': { hu: 'Pénznem', ro: 'Monedă' },
  'bil.issueDate': { hu: 'Dată emitere', ro: 'Dată emitere' },
  'bil.dueDate': { hu: 'Dată scadentă', ro: 'Dată scadentă' },
  'bil.sec.client': { hu: 'Ügyfél', ro: 'Client' },
  'bil.name': { hu: 'Megnevezés', ro: 'Denumire' },
  'bil.clientType': { hu: 'Típus', ro: 'Tip' },
  'bil.country': { hu: 'Țară', ro: 'Țară' },
  'bil.county': { hu: 'Județ', ro: 'Județ' },
  'bil.address': { hu: 'Adresă', ro: 'Adresă' },
  'bil.reverseCharge': { hu: 'Fordított adózás (taxare inversă) — ÁFA nélkül', ro: 'Taxare inversă — fără TVA' },
  'bil.sec.line': { hu: 'Tétel', ro: 'Articol' },
  'bil.articleName': { hu: 'Denumire articol', ro: 'Denumire articol' },
  'bil.descr': { hu: 'Descriere / Info suplimentară', ro: 'Descriere / Info suplimentară' },
  'bil.um': { hu: 'U.M.', ro: 'U.M.' },
  'bil.qty': { hu: 'Cantitate', ro: 'Cantitate' },
  'bil.tva': { hu: 'TVA %', ro: 'TVA %' },
  'bil.netPrice': { hu: 'Preț net (fără TVA)', ro: 'Preț net (fără TVA)' },
  'bil.totNet': { hu: 'Nettó', ro: 'Net' },
  'bil.totVat': { hu: 'ÁFA', ro: 'TVA' },
  'bil.totGross': { hu: 'Brutto', ro: 'Brut' },
  'bil.more1': { hu: '▸ Több (Cod articol, Gestiune, Centru cost)', ro: '▸ Mai mult (Cod articol, Gestiune, Centru cost)' },
  'bil.codArticol': { hu: 'Cod articol', ro: 'Cod articol' },
  'bil.gestiune': { hu: 'Gestiune', ro: 'Gestiune' },
  'bil.centruCost': { hu: 'Centru cost', ro: 'Centru cost' },
  'bil.more2': { hu: '▸ Megjegyzések (INFO 1 / INFO 2)', ro: '▸ Observații (INFO 1 / INFO 2)' },
  'bil.cancel': { hu: 'Mégse', ro: 'Anulează' },
  'bil.storno': { hu: '↩️ Storno számla', ro: '↩️ Factură storno' },
  'bil.emit': { hu: 'Számla kiállítása', ro: 'Emite factura' },
  'bil.enterCui': { hu: 'Írd be a CUI-t.', ro: 'Introdu CUI-ul.' },
  'bil.anafLoading': { hu: 'ANAF…', ro: 'ANAF…' },
  'bil.noCui': { hu: 'Nincs ilyen CUI.', ro: 'Nu există acest CUI.' },
  'bil.updated': { hu: 'Frissítve', ro: 'Actualizat' },
  'bil.vatPayer': { hu: 'ÁFA-alany', ro: 'plătitor TVA' },
  'bil.notVatPayer': { hu: 'NEM ÁFA-alany', ro: 'NEplătitor TVA' },
  'bil.active': { hu: 'aktív', ro: 'activ' },
  'bil.inactive': { hu: 'INAKTÍV!', ro: 'INACTIV!' },
  'bil.stornoed': { hu: 'Stornózva', ro: 'Stornat' },
  'bil.alreadyEmitted': { hu: 'Már kiállítva', ro: 'Deja emisă' },
  'bil.thisStornoed': { hu: 'Ez a számla stornózva:', ro: 'Această factură este stornată:' },
  'bil.alreadyHasInvoice': { hu: 'Ehhez a fuvarhoz már van számla:', ro: 'Acest transport are deja factură:' },
  'bil.efacturaStatusBtn': { hu: '🔄 e-Factura státusz', ro: '🔄 Status e-Factura' },
  'bil.efacturaStatusTitle': { hu: 'Számla- és e-Factura státusz lekérése a szolgáltatótól', ro: 'Obține statusul facturii și e-Factura de la furnizor' },
  'bil.querying': { hu: 'Lekérdezés…', ro: 'Se interoghează…' },
  'bil.paidAtProvider': { hu: 'fizetve a szolgáltatónál:', ro: 'plătită la furnizor:' },
  'bil.statusOkNoEf': { hu: 'státusz rendben, e-Factura adat még nincs', ro: 'status în regulă, încă fără date e-Factura' },
  'bil.statusNotAvailable': { hu: 'A státusz nem kérdezhető le.', ro: 'Statusul nu poate fi interogat.' },
  'bil.confirmStorno': { hu: 'Biztosan kiállítasz egy STORNO számlát a meglévő alapján (minden adat ugyanaz, a mennyiség negatív)? A művelet nem visszavonható.', ro: 'Sigur emiți o factură STORNO pe baza celei existente (aceleași date, cantitate negativă)? Operațiunea este ireversibilă.' },
  'bil.stornoInProgress': { hu: 'Storno folyamatban…', ro: 'Storno în curs…' },
  'bil.stornoEmitting': { hu: 'Storno számla kiállítása…', ro: 'Se emite factura storno…' },
  'bil.stornoEmitted': { hu: '↩️ Storno számla kiállítva:', ro: '↩️ Factură storno emisă:' },
  'bil.stornoedBtn': { hu: '✅ Stornózva', ro: '✅ Stornat' },
  'bil.closeBtn': { hu: 'Bezárás', ro: 'Închide' },
  'bil.openPdf': { hu: 'PDF megnyitása', ro: 'Deschide PDF' },
  'bil.missingSerie': { hu: 'Hiányzik a serie.', ro: 'Lipsește seria.' },
  'bil.missingLineName': { hu: 'Hiányzik a tétel megnevezése.', ro: 'Lipsește denumirea articolului.' },
  'bil.emitInProgress': { hu: 'Kiállítás folyamatban…', ro: 'Emitere în curs…' },
  'bil.emitting': { hu: 'Számla kiállítása a szolgáltatónál…', ro: 'Se emite factura la furnizor…' },
  'bil.invoiceEmitted': { hu: '✅ Számla kiállítva:', ro: '✅ Factură emisă:' },
  'bil.done': { hu: '✅ Kész', ro: '✅ Gata' }
});
function T(k,v){return (typeof window.t==='function')?window.t(k,v):k;}
window.InvoiceModal = (function () {
  const STYLE = `
  .im-ov{position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px}
  .im-box{background:#fff;border-radius:14px;width:100%;max-width:580px;max-height:92vh;overflow:auto;font-family:inherit}
  .im-head{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid #eef1f6;position:sticky;top:0;background:#fff;z-index:2}
  .im-h{font-weight:600}.im-x{border:none;background:none;font-size:22px;cursor:pointer;color:#6b7280}
  .im-b{padding:14px 16px}
  .im-sec{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8696ad;font-weight:700;margin:14px 0 8px}
  .im-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px}
  .im-l{display:flex;flex-direction:column;font-size:12px;color:#6b7280;gap:5px}
  .im-l.full{grid-column:1/-1}
  .im-in{font-size:16px;padding:8px 10px;border:1px solid #d0d5dd;border-radius:8px;color:#111;width:100%}
  .im-static{font-size:14px;color:#33485f;padding:8px 0}
  .im-cui{display:flex;gap:6px}.im-cui .im-in{flex:1}
  .im-check{display:flex;align-items:center;gap:8px;font-size:13px;color:#374151;margin:6px 0 4px}
  .im-tot{background:#f3f6fb;border-radius:8px;padding:10px 12px;font-size:14px;margin:6px 0}
  .im-tot b{color:#0c1b30}
  .im-more{font-size:13px;color:#2563eb;cursor:pointer;margin:8px 0;display:inline-block}
  .im-msg{font-size:13px;min-height:18px;margin:8px 0}.im-msg--ok{color:#1a7f37}.im-msg--err{color:#c0341a}
  .im-foot{display:flex;gap:8px;justify-content:flex-end;padding-top:8px}
  .im-btn{font-size:14px;padding:10px 14px;border-radius:8px;border:1px solid transparent;cursor:pointer;touch-action:manipulation}
  .im-btn--primary{background:#2563eb;color:#fff}.im-btn--ghost{background:#fff;border:1px solid #d0d5dd;color:#374151}
  .im-btn--mini{font-size:12px;padding:8px 10px;background:#fff;border:1px solid #d0d5dd;color:#33485f}
  .im-link{color:#2563eb;font-weight:600}
  @media(max-width:560px){.im-row{grid-template-columns:1fr}}`;
  function ensureStyle(){ if(!document.getElementById('im-style')){const s=document.createElement('style');s.id='im-style';s.textContent=STYLE;document.head.appendChild(s);} }
  function close(){ const o=document.getElementById('im-ov'); if(o)o.remove(); if(typeof window.__invoiceRefresh==='function') window.__invoiceRefresh(); }
  async function api(m,u,b){const r=await fetch(u,{method:m,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||(T('bil.err')+' '+r.status));return d;}
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  const opt=(v,sel)=>`<option value="${esc(v)}"${String(v)===String(sel)?' selected':''}>${esc(v)}</option>`;

  async function open(orderId){
    ensureStyle();
    const ov=document.createElement('div'); ov.className='im-ov'; ov.id='im-ov';
    ov.innerHTML=`<div class="im-box"><div class="im-head"><div class="im-h">${T('bil.title')} — ${esc(orderId)}</div><button class="im-x">×</button></div><div class="im-b" id="im-b">${T('bil.loading')}</div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click',e=>{if(e.target===ov)close();});
    ov.querySelector('.im-x').addEventListener('click',close);
    const body=ov.querySelector('#im-b');
    try{
      const pv=await api('POST','/api/orders/'+encodeURIComponent(orderId)+'/invoice/preview');
      let lists={tipfactura:[],tva:[]}; try{ lists=await api('GET','/api/integrations/invoicing/nomenclator'); }catch(_){}
      let existing=null; try{ const s=await api('GET','/api/invoices/summary?order_ids='+encodeURIComponent(orderId)); existing=(s.summary||{})[orderId]||null; }catch(_){}
      render(body, orderId, pv.invoice, lists, existing);
    }catch(e){ body.textContent=e.message; }
  }

  function render(body, orderId, inv, lists, existing){
    const tipList = (lists.tipfactura&&lists.tipfactura.length)?lists.tipfactura:['Factura','Proforma','Aviz'];
    const tvaList = (lists.tva&&lists.tva.length)?lists.tva:[21,11,9,5,0];
    const curList = [...new Set([inv.currency,'RON','EUR','USD'])];
    const serieField = (inv.seriesOptions&&inv.seriesOptions.length)
      ? `<select class="im-in" id="f-serie">${inv.seriesOptions.map(s=>opt(s,inv.serie)).join('')}</select>`
      : `<input class="im-in" id="f-serie" value="${esc(inv.serie)}">`;
    const c=inv.client, l=inv.lines[0];
    body.innerHTML=`
      <div class="im-msg" id="im-msg"></div>
      <div class="im-sec">${T('bil.sec.invoice')}</div>
      <div class="im-row">
        <label class="im-l">${T('bil.tip')}<select class="im-in" id="f-tip">${tipList.map(t=>opt(t,inv.type)).join('')}</select></label>
        <label class="im-l">${T('bil.serie')}<br>${serieField}</label>
        <label class="im-l">${T('bil.num')}<div class="im-static">${T('bil.auto')}</div></label>
        <label class="im-l">${T('bil.currency')}<select class="im-in" id="f-cur">${curList.map(x=>opt(x,inv.currency)).join('')}</select></label>
        <label class="im-l">${T('bil.issueDate')}<input type="date" class="im-in" id="f-issue" value="${esc(inv.issueDate)}"></label>
        <label class="im-l">${T('bil.dueDate')}<input type="date" class="im-in" id="f-due" value="${esc(inv.dueDate)}"></label>
      </div>
      <div class="im-sec">${T('bil.sec.client')}</div>
      <div class="im-row">
        <label class="im-l full">${T('bil.name')}<input class="im-in" id="f-name" value="${esc(c.name)}"></label>
        <label class="im-l">CUI / CIF<span class="im-cui"><input class="im-in" id="f-cui" value="${esc(c.cui)}"><button type="button" class="im-btn im-btn--mini" id="f-anaf">ANAF</button></span></label>
        <label class="im-l">${T('bil.clientType')}<select class="im-in" id="f-tipc">${opt('PJ',c.type)}${opt('PF',c.type)}</select></label>
        <label class="im-l">${T('bil.country')}<input class="im-in" id="f-tara" value="${esc(c.country||'RO')}"></label>
        <label class="im-l">${T('bil.county')}<input class="im-in" id="f-judet" value="${esc(c.county)}"></label>
        <label class="im-l full">${T('bil.address')}<input class="im-in" id="f-adr" value="${esc(c.address)}"></label>
      </div>
      <label class="im-check"><input type="checkbox" id="f-rc"> ${T('bil.reverseCharge')}</label>
      <div class="im-sec">${T('bil.sec.line')}</div>
      <div class="im-row">
        <label class="im-l full">${T('bil.articleName')}<input class="im-in" id="f-lname" list="im-articles" value="${esc(l.name)}"><datalist id="im-articles"></datalist></label>
        <label class="im-l full">${T('bil.descr')}<textarea class="im-in" id="f-desc" rows="2">${esc(l.description)}</textarea></label>
        <label class="im-l">${T('bil.um')}<input class="im-in" id="f-um" value="${esc(l.unit||'BUC')}"></label>
        <label class="im-l">${T('bil.qty')}<input type="number" step="0.001" class="im-in" id="f-qty" value="${esc(l.qty)}"></label>
        <label class="im-l">${T('bil.tva')}<select class="im-in" id="f-tva">${tvaList.map(t=>opt(t,l.vatRate)).join('')}</select></label>
        <label class="im-l">${T('bil.netPrice')}<input type="number" step="0.01" class="im-in" id="f-price" value="${esc(l.unitPrice)}"></label>
      </div>
      <div class="im-tot" id="im-tot"></div>
      <span class="im-more" id="im-more1">${T('bil.more1')}</span>
      <div id="im-extra1" style="display:none" class="im-row">
        <label class="im-l">${T('bil.codArticol')}<input class="im-in" id="f-code"></label>
        <label class="im-l">${T('bil.gestiune')}<input class="im-in" id="f-gest"></label>
        <label class="im-l">${T('bil.centruCost')}<input class="im-in" id="f-cc"></label>
      </div>
      <span class="im-more" id="im-more2">${T('bil.more2')}</span>
      <div id="im-extra2" style="display:none" class="im-row">
        <label class="im-l full">INFO 1<input class="im-in" id="f-text"></label>
        <label class="im-l full">INFO 2<input class="im-in" id="f-notes"></label>
      </div>
      <div class="im-foot"><div class="im-msg" id="im-send-msg" style="flex:1;text-align:left;margin:0;align-self:center"></div><button class="im-btn im-btn--ghost" id="im-cancel">${T('bil.cancel')}</button><button class="im-btn im-btn--ghost" id="im-storno" style="display:none;border-color:#c0341a;color:#c0341a">${T('bil.storno')}</button><button class="im-btn im-btn--primary" id="im-send">${T('bil.emit')}</button></div>`;

    const $=id=>body.querySelector('#'+id);
    const setMsg=(t,k)=>{$('im-msg').textContent=t||'';$('im-msg').className='im-msg'+(k?' im-msg--'+k:'');};
    const num=id=>Number($(id).value)||0;
    function recalc(){ const rc=$('f-rc').checked; const vat=rc?0:num('f-tva'); const net=num('f-qty')*num('f-price'); const tva=net*vat/100; $('im-tot').innerHTML=`${T('bil.totNet')}: <b>${net.toFixed(2)}</b> · ${T('bil.totVat')} ${vat}%: <b>${tva.toFixed(2)}</b> · ${T('bil.totGross')}: <b>${(net+tva).toFixed(2)} ${esc($('f-cur').value)}</b>`; }
    ['f-qty','f-price','f-tva','f-cur'].forEach(id=>$(id).addEventListener('input',recalc));
    $('f-rc').addEventListener('change',recalc); recalc();
    $('im-more1').addEventListener('click',()=>{const e=$('im-extra1');e.style.display=e.style.display==='none'?'grid':'none';});
    $('im-more2').addEventListener('click',()=>{const e=$('im-extra2');e.style.display=e.style.display==='none'?'grid':'none';});
    $('im-cancel').addEventListener('click',close);

    // mentett cikkek (csak ENTERPRISE-nél tölt; egyébként üres datalist -> szabad szöveg)
    let artsLoaded=false;
    $('f-lname').addEventListener('focus', async ()=>{ if(artsLoaded)return; artsLoaded=true; try{ const d=await api('GET','/api/integrations/invoicing/articles'); $('im-articles').innerHTML=(d.articles||[]).slice(0,200).map(a=>`<option value="${esc(a.name)}">`).join(''); }catch(_){} });

    $('f-anaf').addEventListener('click', async ()=>{ const cui=$('f-cui').value.trim(); if(!cui)return setMsg(T('bil.enterCui'),'err'); setMsg(T('bil.anafLoading')); try{ const r=await api('GET','/api/clients/anaf?cui='+encodeURIComponent(cui)); if(!r.found)return setMsg(r.error||T('bil.noCui'),'err'); if(r.name)$('f-name').value=r.name; if(r.address)$('f-adr').value=r.address; if(r.judet)$('f-judet').value=r.judet; setMsg(T('bil.updated')+' · '+(r.vatPayer?T('bil.vatPayer'):T('bil.notVatPayer'))+' · '+(r.active?T('bil.active'):T('bil.inactive')), r.active?'ok':'err'); }catch(e){setMsg(e.message,'err');} });

    // Visszajelzés a GOMB MELLETT — a hosszú űrlap tetején lévő üzenet könnyen kimaradt a látómezőből.
    const sendMsg=(t,k)=>{ const el=$('im-send-msg'); el.textContent=t||''; el.className='im-msg'+(k?' im-msg--'+k:''); };
    let emitting=false, emitted=false;     // dupla-kiállítás elleni zár (folyamatban / már kész)

    // Számla-állapot a fuvarnál: nincs / már kiállítva (storno lehetséges) / stornózva.
    if(existing && existing.stornoed){
      emitted=true; const sb=$('im-send'); sb.disabled=true; sb.textContent=T('bil.stornoed');
      const link=existing.storno_pdf?` · <a class="im-link" href="${esc(existing.storno_pdf)}" target="_blank">PDF</a>`:'';
      $('im-send-msg').innerHTML=`↩️ ${T('bil.thisStornoed')} <b>${esc(existing.storno_serie||'')}-${esc(existing.storno_numar||'')}</b>${link}`;
      $('im-send-msg').className='im-msg im-msg--err';
    } else if(existing && existing.invoiced){
      emitted=true; const sb=$('im-send'); sb.disabled=true; sb.textContent=T('bil.alreadyEmitted');
      $('im-storno').style.display='';     // storno csak a már kiállított számlánál
      const link=existing.pdf_link?` · <a class="im-link" href="${esc(existing.pdf_link)}" target="_blank">PDF</a>`:'';
      const efTxt=existing.efactura?` · 📨 e-Factura: <b>${esc(existing.efactura)}</b>`:'';
      const efBtn=existing.inv_id?` <button class="im-btn im-btn--ghost" id="im-efstat" type="button" style="padding:2px 10px;font-size:11px;margin-left:6px" title="${T('bil.efacturaStatusTitle')}">${T('bil.efacturaStatusBtn')}</button>`:'';
      $('im-send-msg').innerHTML=`ℹ️ ${T('bil.alreadyHasInvoice')} <b>${esc(existing.serie||'')}-${esc(existing.numar||'')}</b>${link}${efTxt}${efBtn}`;
      $('im-send-msg').className='im-msg im-msg--ok';
      // 🔄 e-Factura / számla-státusz frissítése a szolgáltatótól (FGO: getstatus)
      const efb=$('im-efstat');
      if(efb) efb.addEventListener('click', async ()=>{
        efb.disabled=true; efb.textContent=T('bil.querying');
        try{
          const d=await api('POST','/api/invoices/'+existing.inv_id+'/status');
          if(d && d.ok){
            const parts=[];
            if(d.efactura) parts.push('📨 e-Factura: <b>'+esc(d.efactura)+'</b>');
            if(d.paid!=null) parts.push(T('bil.paidAtProvider')+' <b>'+esc(String(d.paid))+'</b>');
            efb.outerHTML=' · '+(parts.length?parts.join(' · '):'<span class="im-msg--ok">'+T('bil.statusOkNoEf')+'</span>');
            if(window.__invoiceRefresh) window.__invoiceRefresh();   // fuvarlista 📨 jelző frissítése
          } else {
            efb.disabled=false; efb.textContent=T('bil.efacturaStatusBtn');
            sendMsg((d&&d.message)||T('bil.statusNotAvailable'),'err');
          }
        }catch(e){
          efb.disabled=false; efb.textContent=T('bil.efacturaStatusBtn');
          sendMsg(e.message,'err');
        }
      });
    }

    // ── Storno (jóváíró) számla: a kiállított számla alapján, mennyiség negatív ──
    $('im-storno').addEventListener('click', async ()=>{
      if(emitting)return;
      if(!confirm(T('bil.confirmStorno')))return;
      emitting=true;
      const stb=$('im-storno'), orig=stb.textContent;
      stb.disabled=true; $('im-cancel').disabled=true; stb.textContent=T('bil.stornoInProgress');
      sendMsg(T('bil.stornoEmitting'));
      try{
        const d=await api('POST','/api/orders/'+encodeURIComponent(orderId)+'/invoice/storno');
        const link=d.pdf_link?` · <a class="im-link" href="${esc(d.pdf_link)}" target="_blank">${T('bil.openPdf')}</a>`:'';
        $('im-send-msg').innerHTML=`${T('bil.stornoEmitted')} <b>${esc(d.serie||'')}-${esc(d.numar||'')}</b>${link}`;
        $('im-send-msg').className='im-msg im-msg--ok';
        stb.textContent=T('bil.stornoedBtn'); stb.disabled=true; emitting=false;
        $('im-cancel').disabled=false; $('im-cancel').textContent=T('bil.closeBtn');
      }catch(e){
        emitting=false; stb.disabled=false; $('im-cancel').disabled=false; stb.textContent=orig;
        sendMsg(e.message,'err');
      }
    });

    $('im-send').addEventListener('click', async ()=>{
      if(emitting||emitted)return;          // folyamatban / már kiállítva → nincs 2. számla
      const payload={ serie:$('f-serie').value, currency:$('f-cur').value, type:$('f-tip').value,
        issueDate:$('f-issue').value||undefined, dueDate:$('f-due').value||undefined,
        text:$('f-text').value||undefined, notes:$('f-notes').value||undefined, reverseCharge:$('f-rc').checked,
        client:{ name:$('f-name').value.trim(), cui:$('f-cui').value.trim(), type:$('f-tipc').value, country:$('f-tara').value.trim(), county:$('f-judet').value.trim(), address:$('f-adr').value.trim() },
        lines:[{ name:$('f-lname').value.trim(), description:$('f-desc').value.trim(), unit:$('f-um').value.trim(), qty:num('f-qty'), vatRate:num('f-tva'), unitPrice:num('f-price'), code:$('f-code').value.trim(), gestiune:$('f-gest').value.trim(), costCenter:$('f-cc').value.trim() }] };
      if(!payload.serie)return sendMsg(T('bil.missingSerie'),'err');
      if(!payload.lines[0].name)return sendMsg(T('bil.missingLineName'),'err');
      emitting=true;
      const btn=$('im-send'), orig=btn.textContent;
      btn.disabled=true; $('im-cancel').disabled=true; btn.textContent=T('bil.emitInProgress');
      sendMsg(T('bil.emitting'));
      try{
        const d=await api('POST','/api/orders/'+encodeURIComponent(orderId)+'/invoice/emit',{invoice:payload});
        emitted=true;
        const link=d.pdf_link?` · <a class="im-link" href="${esc(d.pdf_link)}" target="_blank">${T('bil.openPdf')}</a>`:'';
        $('im-send-msg').innerHTML=`${T('bil.invoiceEmitted')} <b>${esc(d.serie||'')}-${esc(d.numar||'')}</b>${link}`;
        $('im-send-msg').className='im-msg im-msg--ok';
        btn.textContent=T('bil.done');            // letiltva marad → nem készülhet 2. számla
        $('im-cancel').disabled=false; $('im-cancel').textContent=T('bil.closeBtn');
      }catch(e){
        emitting=false;                        // hiba → újra lehet próbálni
        btn.disabled=false; $('im-cancel').disabled=false; btn.textContent=orig;
        sendMsg(e.message,'err');
      }
    });
  }
  return { open, close };
})();
