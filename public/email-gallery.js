/* ============================================================
 *  VallorSoft — public/email-gallery.js
 *  Beépített e-mail-sablon galéria (MINDEN cég számára elérhető).
 *
 *  A sablonok kódból jönnek (nem cégenkénti DB-tétel) → mindenki ugyanazt a
 *  galériát látja. A felhasználó egy kattintással betölti a GrapesJS
 *  szerkesztőbe, ott testreszabja és SAJÁT sablonként menti.
 *
 *  Minden sablon e-mail-biztos (táblázatos elrendezés, inline CSS) és
 *  használja a {{nev}} / {{cegnev}} / {{datum}} helyőrzőket, amelyek
 *  kiküldéskor automatikusan kitöltődnek.
 * ============================================================ */
(function () {
  'use strict';

  // Közös külső keret-segéd: középre zárt, 600px-es kártya adott háttérrel.
  function wrap(bg, inner) {
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + bg + ';padding:24px 0;margin:0;">'
      + '<tr><td align="center">'
      + '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.08);">'
      + inner
      + '</table></td></tr></table>';
  }
  function footer(textColor, accent) {
    return '<tr><td style="padding:18px 32px 26px;background:#fafafa;border-top:1px solid #eee;">'
      + '<p style="margin:0;font-size:12px;line-height:1.6;color:' + (textColor || '#888') + ';text-align:center;">'
      + '{{cegnev}} · {{datum}}<br>'
      + '<a href="#" style="color:' + accent + ';text-decoration:none;">Dezabonare</a> · '
      + '<a href="#" style="color:' + accent + ';text-decoration:none;">Contact</a>'
      + '</p></td></tr>';
  }
  function btn(color, label) {
    return '<a href="#" style="display:inline-block;background:' + color + ';color:#ffffff;text-decoration:none;font-weight:700;padding:14px 32px;border-radius:9px;font-size:15px;">' + label + '</a>';
  }
  // Sötét / futurisztikus keret (kártya egyedi háttérrel).
  function darkWrap(outerBg, cardBg, font, inner) {
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + outerBg + ';padding:26px 0;margin:0;">'
      + '<tr><td align="center">'
      + '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:' + cardBg + ';border-radius:16px;overflow:hidden;font-family:' + (font || 'Arial,Helvetica,sans-serif') + ';">'
      + inner + '</table></td></tr></table>';
  }
  // Gradiens gomb (solid fallback a háttérben a nem támogató kliensekhez).
  function gbtn(solid, grad, label) {
    return '<a href="#" style="display:inline-block;background:' + solid + ';background:' + grad + ';color:#ffffff;text-decoration:none;font-weight:700;padding:14px 34px;border-radius:10px;font-size:14px;letter-spacing:.5px;">' + label + '</a>';
  }

  window.EB_GALLERY = [

    // 1 — Napnyugta hero (meleg narancs/korall gradiens + CTA)
    { key: 'sunset-hero', accent: '#f6711e',
      name: { hu: '🌅 Napnyugta — ajánlat', ro: '🌅 Apus — ofertă' },
      html: wrap('#f4efe9',
        '<tr><td style="background:linear-gradient(135deg,#fb8c3a,#f6517b);padding:46px 32px;text-align:center;">'
        + '<h1 style="margin:0;color:#fff;font-size:28px;font-weight:800;">Ofertă specială pentru dvs.</h1>'
        + '<p style="margin:10px 0 0;color:#fff;opacity:.92;font-size:15px;">{{cegnev}}</p></td></tr>'
        + '<tr><td style="padding:34px 32px;color:#3a2a1c;">'
        + '<p style="margin:0 0 14px;font-size:16px;">Stimate <b>{{nev}}</b>,</p>'
        + '<p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:#5a4636;">Vă mulțumim pentru încrederea acordată. Am pregătit o ofertă personalizată de transport, adaptată nevoilor dvs. Echipa noastră vă stă la dispoziție pentru orice detaliu.</p>'
        + '<div style="text-align:center;margin:8px 0 4px;">' + btn('#f6711e', 'Vezi oferta') + '</div></td></tr>'
        + footer('#a08a76', '#f6711e')) },

    // 2 — Óceán kék (üzleti fejléc-sáv, formális)
    { key: 'ocean-business', accent: '#2563eb',
      name: { hu: '🌊 Óceán kék — üzleti', ro: '🌊 Albastru — business' },
      html: wrap('#eef2f8',
        '<tr><td style="background:#1e3a8a;padding:26px 32px;">'
        + '<span style="color:#fff;font-size:20px;font-weight:800;">{{cegnev}}</span></td></tr>'
        + '<tr><td style="height:4px;background:#3b82f6;"></td></tr>'
        + '<tr><td style="padding:34px 32px;color:#1f2937;">'
        + '<h2 style="margin:0 0 14px;font-size:21px;color:#1e3a8a;">Bună ziua, {{nev}}!</h2>'
        + '<p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#475569;">Vă scriem pentru a vă informa despre serviciile noastre de transport și logistică. Suntem dedicați livrărilor la timp și comunicării transparente.</p>'
        + '<p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#475569;">Pentru o ofertă detaliată, răspundeți la acest e-mail.</p>'
        + '<div style="text-align:center;">' + btn('#2563eb', 'Solicită ofertă') + '</div></td></tr>'
        + footer('#94a3b8', '#2563eb')) },

    // 3 — Erdő zöld (kézbesítés visszaigazolása, pipa)
    { key: 'forest-confirm', accent: '#16a34a',
      name: { hu: '✅ Erdő zöld — visszaigazolás', ro: '✅ Verde — confirmare' },
      html: wrap('#eaf6ee',
        '<tr><td style="padding:40px 32px 18px;text-align:center;">'
        + '<div style="width:64px;height:64px;line-height:64px;border-radius:50%;background:#16a34a;color:#fff;font-size:32px;margin:0 auto 16px;">✓</div>'
        + '<h1 style="margin:0;font-size:24px;color:#14532d;">Transport confirmat</h1></td></tr>'
        + '<tr><td style="padding:0 32px 30px;color:#1f3d2b;">'
        + '<p style="margin:0 0 14px;font-size:15px;line-height:1.7;">Stimate <b>{{nev}}</b>, confirmăm preluarea comenzii dvs. Veți primi actualizări pe măsură ce marfa avansează către destinație.</p>'
        + '<table role="presentation" width="100%" style="background:#f1faf3;border:1px solid #cfe9d6;border-radius:10px;margin:6px 0 22px;"><tr><td style="padding:16px 18px;font-size:14px;color:#2f5d42;"><b>Companie:</b> {{cegnev}}<br><b>Data:</b> {{datum}}</td></tr></table>'
        + '<div style="text-align:center;">' + btn('#16a34a', 'Urmărește transportul') + '</div></td></tr>'
        + footer('#7aa98a', '#16a34a')) },

    // 4 — Espresso prémium (sötét, elegáns)
    { key: 'espresso-premium', accent: '#d4a14e',
      name: { hu: '🖤 Espresso — prémium', ro: '🖤 Espresso — premium' },
      html: '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#15110d;padding:28px 0;margin:0;"><tr><td align="center">'
        + '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#1e1812;border-radius:14px;overflow:hidden;font-family:Georgia,\'Times New Roman\',serif;">'
        + '<tr><td style="padding:44px 36px 14px;text-align:center;">'
        + '<div style="font-size:13px;letter-spacing:3px;color:#d4a14e;text-transform:uppercase;">{{cegnev}}</div>'
        + '<h1 style="margin:14px 0 0;font-size:27px;color:#faf6f0;font-weight:400;">O experiență premium</h1></td></tr>'
        + '<tr><td style="padding:18px 36px 34px;text-align:center;">'
        + '<p style="margin:0 0 24px;font-size:15px;line-height:1.8;color:#cdbfb0;">Stimate {{nev}}, vă invităm să descoperiți serviciile noastre de top, gândite pentru parteneri exigenți.</p>'
        + '<a href="#" style="display:inline-block;border:1px solid #d4a14e;color:#d4a14e;text-decoration:none;font-weight:600;padding:13px 34px;border-radius:4px;font-size:14px;letter-spacing:1px;font-family:Arial,sans-serif;">DESCOPERĂ</a></td></tr>'
        + '<tr><td style="padding:16px 36px 26px;border-top:1px solid #33291f;text-align:center;font-size:11px;color:#8a7a68;font-family:Arial,sans-serif;">{{cegnev}} · {{datum}}</td></tr>'
        + '</table></td></tr></table>' },

    // 5 — Minimál fehér (tiszta, sok fehér tér)
    { key: 'minimal-clean', accent: '#111827',
      name: { hu: '⚪ Minimál — letisztult', ro: '⚪ Minimal — curat' },
      html: wrap('#ffffff',
        '<tr><td style="padding:48px 40px 0;">'
        + '<div style="font-size:18px;font-weight:700;color:#111827;letter-spacing:-.5px;">{{cegnev}}</div>'
        + '<div style="height:2px;width:42px;background:#111827;margin:16px 0 28px;"></div>'
        + '<h1 style="margin:0 0 18px;font-size:24px;color:#111827;font-weight:600;line-height:1.3;">Bună, {{nev}}.</h1>'
        + '<p style="margin:0 0 16px;font-size:16px;line-height:1.8;color:#4b5563;">Un mesaj scurt și clar. Fără zgomot, doar informația esențială pe care doriți să o transmiteți.</p>'
        + '<p style="margin:0 0 30px;font-size:16px;line-height:1.8;color:#4b5563;">Cu stimă,<br>echipa {{cegnev}}</p>'
        + '<a href="#" style="font-size:15px;color:#111827;font-weight:700;text-decoration:none;border-bottom:2px solid #111827;padding-bottom:2px;">Află mai mult →</a>'
        + '<div style="height:40px;"></div></td></tr>'
        + footer('#9ca3af', '#111827')) },

    // 6 — Korall promó (nagy kedvezmény-jelvény + CTA)
    { key: 'coral-promo', accent: '#f6517b',
      name: { hu: '🎉 Korall — promóció', ro: '🎉 Coral — promoție' },
      html: wrap('#fdeef3',
        '<tr><td style="background:#f6517b;padding:18px;text-align:center;">'
        + '<span style="color:#fff;font-size:13px;letter-spacing:2px;font-weight:700;">PROMOȚIE LIMITATĂ</span></td></tr>'
        + '<tr><td style="padding:36px 32px 8px;text-align:center;">'
        + '<div style="display:inline-block;background:#fff0f5;border:2px dashed #f6517b;border-radius:14px;padding:18px 30px;">'
        + '<div style="font-size:46px;font-weight:800;color:#f6517b;line-height:1;">-20%</div>'
        + '<div style="font-size:13px;color:#b03a5b;margin-top:4px;">la primul transport</div></div></td></tr>'
        + '<tr><td style="padding:18px 32px 32px;text-align:center;color:#5a2030;">'
        + '<p style="margin:0 0 22px;font-size:15px;line-height:1.7;">Salut {{nev}}! Profită de oferta noastră și colaborează cu {{cegnev}} în condiții avantajoase.</p>'
        + btn('#f6517b', 'Profită acum') + '</td></tr>'
        + footer('#c98aa0', '#f6517b')) },

    // 7 — Teal hírlevél (két kártya)
    { key: 'teal-newsletter', accent: '#0d9488',
      name: { hu: '📰 Teal — hírlevél', ro: '📰 Teal — newsletter' },
      html: wrap('#e6f4f2',
        '<tr><td style="background:#0d9488;padding:24px 32px;text-align:center;">'
        + '<span style="color:#fff;font-size:20px;font-weight:800;">Buletin {{cegnev}}</span></td></tr>'
        + '<tr><td style="padding:28px 32px 6px;color:#134e4a;">'
        + '<p style="margin:0 0 18px;font-size:15px;line-height:1.7;">Bună {{nev}}, iată noutățile lunii:</p></td></tr>'
        + '<tr><td style="padding:0 32px;"><table role="presentation" width="100%" style="background:#f0fbf9;border-radius:10px;margin-bottom:14px;"><tr><td style="padding:18px 20px;"><h3 style="margin:0 0 6px;font-size:16px;color:#0d9488;">🚚 Rute noi</h3><p style="margin:0;font-size:14px;line-height:1.6;color:#3a6b65;">Am extins acoperirea către noi destinații europene.</p></td></tr></table></td></tr>'
        + '<tr><td style="padding:0 32px 26px;"><table role="presentation" width="100%" style="background:#f0fbf9;border-radius:10px;"><tr><td style="padding:18px 20px;"><h3 style="margin:0 0 6px;font-size:16px;color:#0d9488;">📦 Servicii noi</h3><p style="margin:0;font-size:14px;line-height:1.6;color:#3a6b65;">Soluții flexibile pentru transporturi parțiale (LTL).</p></td></tr></table></td></tr>'
        + footer('#79aaa3', '#0d9488')) },

    // 8 — Lila kreatív (gradiens, modern)
    { key: 'purple-creative', accent: '#7c3aed',
      name: { hu: '🟣 Lila — kreatív', ro: '🟣 Mov — creativ' },
      html: wrap('#f1ecfb',
        '<tr><td style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:42px 32px;text-align:center;">'
        + '<h1 style="margin:0;color:#fff;font-size:26px;font-weight:800;">Ceva nou de la {{cegnev}}</h1>'
        + '<p style="margin:10px 0 0;color:#e9e2fb;font-size:14px;">special pentru {{nev}}</p></td></tr>'
        + '<tr><td style="padding:32px;color:#3b2a63;">'
        + '<p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:#5b4a82;">Avem o veste care credem că vă va interesa. Descoperiți cum vă putem ajuta să creșteți eficiența transporturilor.</p>'
        + '<div style="text-align:center;">' + btn('#7c3aed', 'Hai să vedem') + '</div></td></tr>'
        + footer('#a594c9', '#7c3aed')) },

    // 9 — Borostyán emlékeztető (ikon + figyelemfelhívás)
    { key: 'amber-reminder', accent: '#d97706',
      name: { hu: '🔔 Borostyán — emlékeztető', ro: '🔔 Chihlimbar — reminder' },
      html: wrap('#fdf6e8',
        '<tr><td style="padding:34px 32px 10px;text-align:center;">'
        + '<div style="font-size:40px;">🔔</div>'
        + '<h1 style="margin:10px 0 0;font-size:23px;color:#92400e;">Un memento prietenos</h1></td></tr>'
        + '<tr><td style="padding:12px 32px 30px;color:#5b3d12;">'
        + '<p style="margin:0 0 16px;font-size:15px;line-height:1.7;">Stimate {{nev}}, dorim să vă reamintim de colaborarea noastră. Dacă aveți întrebări, suntem aici.</p>'
        + '<table role="presentation" width="100%" style="background:#fff7e6;border-left:4px solid #d97706;border-radius:6px;margin:4px 0 22px;"><tr><td style="padding:14px 18px;font-size:14px;color:#7a5212;">Data: <b>{{datum}}</b> · {{cegnev}}</td></tr></table>'
        + '<div style="text-align:center;">' + btn('#d97706', 'Detalii') + '</div></td></tr>'
        + footer('#c2a25f', '#d97706')) },

    // 10 — Navy klasszikus céges (formális levél)
    { key: 'navy-corporate', accent: '#1e293b',
      name: { hu: '🏢 Navy — klasszikus céges', ro: '🏢 Navy — corporativ' },
      html: wrap('#eef0f3',
        '<tr><td style="padding:36px 40px 0;border-top:6px solid #1e293b;">'
        + '<table role="presentation" width="100%"><tr>'
        + '<td style="font-size:19px;font-weight:800;color:#1e293b;">{{cegnev}}</td>'
        + '<td style="text-align:right;font-size:12px;color:#64748b;">{{datum}}</td></tr></table>'
        + '<div style="height:24px;"></div></td></tr>'
        + '<tr><td style="padding:0 40px 34px;color:#334155;">'
        + '<p style="margin:0 0 16px;font-size:15px;">Stimate domnule/doamnă <b>{{nev}}</b>,</p>'
        + '<p style="margin:0 0 16px;font-size:15px;line-height:1.8;">Vă adresăm prezenta pentru a vă prezenta serviciile companiei noastre. Ne dorim o colaborare bazată pe profesionalism și încredere reciprocă.</p>'
        + '<p style="margin:0 0 28px;font-size:15px;line-height:1.8;">Rămânem la dispoziția dvs. pentru orice clarificare.</p>'
        + '<p style="margin:0;font-size:15px;">Cu deosebită considerație,<br><b>Echipa {{cegnev}}</b></p></td></tr>'
        + footer('#94a3b8', '#1e293b')) },

    // 11 — Piros sürgős (akció / határidő)
    { key: 'red-urgent', accent: '#dc2626',
      name: { hu: '🔴 Piros — sürgős akció', ro: '🔴 Roșu — urgent' },
      html: wrap('#fdeaea',
        '<tr><td style="background:#dc2626;padding:30px 32px;text-align:center;">'
        + '<h1 style="margin:0;color:#fff;font-size:25px;font-weight:800;">Ultima șansă!</h1>'
        + '<p style="margin:8px 0 0;color:#ffe2e2;font-size:14px;">oferta expiră în curând</p></td></tr>'
        + '<tr><td style="padding:32px;text-align:center;color:#5b1414;">'
        + '<p style="margin:0 0 22px;font-size:16px;line-height:1.7;">{{nev}}, nu rata oferta {{cegnev}}! Acționează înainte de <b>{{datum}}</b>.</p>'
        + btn('#dc2626', 'Rezervă acum')
        + '<p style="margin:18px 0 0;font-size:12px;color:#a35555;">Termeni și condiții aplicabile.</p></td></tr>'
        + footer('#c98484', '#dc2626')) },

    // 12 — Pasztel köszönő (lágy, hála)
    { key: 'pastel-thanks', accent: '#db2777',
      name: { hu: '💗 Pasztel — köszönet', ro: '💗 Pastel — mulțumire' },
      html: wrap('#fbeef5',
        '<tr><td style="padding:46px 36px 12px;text-align:center;">'
        + '<div style="font-size:42px;">💗</div>'
        + '<h1 style="margin:12px 0 0;font-size:26px;color:#9d174d;font-weight:700;">Vă mulțumim!</h1></td></tr>'
        + '<tr><td style="padding:14px 40px 36px;text-align:center;color:#7a2a4f;">'
        + '<p style="margin:0 0 14px;font-size:16px;line-height:1.8;">Dragă {{nev}},</p>'
        + '<p style="margin:0 0 24px;font-size:15px;line-height:1.8;color:#9a5575;">Vă mulțumim pentru încrederea acordată companiei {{cegnev}}. Colaborarea cu dvs. înseamnă mult pentru noi.</p>'
        + '<a href="#" style="display:inline-block;background:#fff;border:1.5px solid #db2777;color:#db2777;text-decoration:none;font-weight:700;padding:12px 30px;border-radius:30px;font-size:14px;">Rămânem în legătură</a></td></tr>'
        + footer('#c98aa9', '#db2777')) },

    // ───────── KOMOLYABB / SŰRŰBB SABLONOK ─────────

    // 13 — Számla / kimutatás (tételes tábla + összeg)
    { key: 'invoice-statement', accent: '#334155',
      name: { hu: '🧾 Számla / kimutatás', ro: '🧾 Factură / situație' },
      html: wrap('#eef1f5',
        '<tr><td style="background:#334155;padding:24px 32px;">'
        + '<table role="presentation" width="100%"><tr><td style="color:#fff;font-size:18px;font-weight:800;">{{cegnev}}</td>'
        + '<td style="text-align:right;color:#cbd5e1;font-size:13px;">Document · {{datum}}</td></tr></table></td></tr>'
        + '<tr><td style="padding:28px 32px 8px;color:#1f2937;">'
        + '<p style="margin:0 0 16px;font-size:14px;">Stimate <b>{{nev}}</b>, mai jos găsiți situația serviciilor:</p>'
        + '<table role="presentation" width="100%" style="border-collapse:collapse;font-size:13px;">'
        + '<tr style="background:#f1f5f9;color:#475569;"><th align="left" style="padding:10px;border:1px solid #e2e8f0;">Descriere</th><th align="center" style="padding:10px;border:1px solid #e2e8f0;">Cant.</th><th align="right" style="padding:10px;border:1px solid #e2e8f0;">Valoare</th></tr>'
        + '<tr><td style="padding:10px;border:1px solid #e2e8f0;">Transport rutier intern</td><td align="center" style="padding:10px;border:1px solid #e2e8f0;">1</td><td align="right" style="padding:10px;border:1px solid #e2e8f0;">1.200,00</td></tr>'
        + '<tr><td style="padding:10px;border:1px solid #e2e8f0;">Transport internațional</td><td align="center" style="padding:10px;border:1px solid #e2e8f0;">2</td><td align="right" style="padding:10px;border:1px solid #e2e8f0;">3.400,00</td></tr>'
        + '<tr><td style="padding:10px;border:1px solid #e2e8f0;">Servicii suplimentare</td><td align="center" style="padding:10px;border:1px solid #e2e8f0;">1</td><td align="right" style="padding:10px;border:1px solid #e2e8f0;">250,00</td></tr>'
        + '<tr style="background:#334155;color:#fff;font-weight:700;"><td colspan="2" style="padding:11px;border:1px solid #334155;">Total</td><td align="right" style="padding:11px;border:1px solid #334155;">4.850,00</td></tr>'
        + '</table>'
        + '<p style="margin:16px 0 22px;font-size:12px;color:#64748b;">Sumele sunt orientative. Vă rugăm verificați documentul fiscal atașat.</p>'
        + '<div style="text-align:center;">' + btn('#334155', 'Descarcă documentul') + '</div></td></tr>'
        + footer('#94a3b8', '#334155')) },

    // 14 — Részletes árajánlat (tétel-tábla)
    { key: 'quote-detailed', accent: '#0f766e',
      name: { hu: '📋 Részletes árajánlat', ro: '📋 Ofertă detaliată' },
      html: wrap('#eaf2f0',
        '<tr><td style="background:#0f766e;padding:26px 32px;text-align:center;">'
        + '<h1 style="margin:0;color:#fff;font-size:22px;font-weight:800;">Ofertă de transport</h1>'
        + '<p style="margin:6px 0 0;color:#ccfbf1;font-size:13px;">pregătită pentru {{nev}}</p></td></tr>'
        + '<tr><td style="padding:26px 32px 8px;color:#134e4a;">'
        + '<table role="presentation" width="100%" style="border-collapse:collapse;font-size:13px;">'
        + '<tr style="background:#f0fdfa;color:#0f766e;"><th align="left" style="padding:10px;border:1px solid #ccebe6;">Rută</th><th align="center" style="padding:10px;border:1px solid #ccebe6;">Distanță</th><th align="right" style="padding:10px;border:1px solid #ccebe6;">Preț</th></tr>'
        + '<tr><td style="padding:10px;border:1px solid #ccebe6;">București → Cluj</td><td align="center" style="padding:10px;border:1px solid #ccebe6;">450 km</td><td align="right" style="padding:10px;border:1px solid #ccebe6;">680 €</td></tr>'
        + '<tr><td style="padding:10px;border:1px solid #ccebe6;">Cluj → München</td><td align="center" style="padding:10px;border:1px solid #ccebe6;">980 km</td><td align="right" style="padding:10px;border:1px solid #ccebe6;">1.450 €</td></tr>'
        + '<tr><td style="padding:10px;border:1px solid #ccebe6;">Retur parțial</td><td align="center" style="padding:10px;border:1px solid #ccebe6;">600 km</td><td align="right" style="padding:10px;border:1px solid #ccebe6;">820 €</td></tr>'
        + '</table>'
        + '<p style="margin:16px 0 22px;font-size:13px;line-height:1.6;color:#3a6b65;">Ofertă valabilă până la <b>{{datum}}</b>. Prețurile includ asigurarea mărfii.</p>'
        + '<div style="text-align:center;">' + btn('#0f766e', 'Acceptă oferta') + '</div></td></tr>'
        + footer('#7faaa3', '#0f766e')) },

    // 15 — Havi céges riport (stat-rács)
    { key: 'corporate-report', accent: '#1d4ed8',
      name: { hu: '📊 Havi riport', ro: '📊 Raport lunar' },
      html: wrap('#eef2fb',
        '<tr><td style="background:#1e3a8a;padding:24px 32px;"><span style="color:#fff;font-size:19px;font-weight:800;">Raport lunar — {{cegnev}}</span></td></tr>'
        + '<tr><td style="padding:26px 32px 6px;color:#1f2937;">'
        + '<p style="margin:0 0 18px;font-size:14px;">Bună {{nev}}, iată rezumatul activității:</p>'
        + '<table role="presentation" width="100%" style="border-collapse:separate;border-spacing:10px;">'
        + '<tr><td width="50%" style="background:#eff6ff;border-radius:10px;padding:16px;text-align:center;"><div style="font-size:26px;font-weight:800;color:#1d4ed8;">128</div><div style="font-size:12px;color:#64748b;">Transporturi</div></td>'
        + '<td width="50%" style="background:#eff6ff;border-radius:10px;padding:16px;text-align:center;"><div style="font-size:26px;font-weight:800;color:#1d4ed8;">96.400</div><div style="font-size:12px;color:#64748b;">Km parcurși</div></td></tr>'
        + '<tr><td style="background:#ecfdf5;border-radius:10px;padding:16px;text-align:center;"><div style="font-size:26px;font-weight:800;color:#059669;">98%</div><div style="font-size:12px;color:#64748b;">Livrări la timp</div></td>'
        + '<td style="background:#fef3c7;border-radius:10px;padding:16px;text-align:center;"><div style="font-size:26px;font-weight:800;color:#b45309;">42</div><div style="font-size:12px;color:#64748b;">Clienți activi</div></td></tr></table>'
        + '<div style="text-align:center;margin:22px 0 4px;">' + btn('#1d4ed8', 'Vezi raportul complet') + '</div></td></tr>'
        + footer('#9bb0d8', '#1d4ed8')) },

    // 16 — Hivatalos értesítés (sűrű, jogi hangvétel)
    { key: 'legal-notice', accent: '#475569',
      name: { hu: '⚖️ Hivatalos értesítés', ro: '⚖️ Notificare oficială' },
      html: wrap('#f1f1ef',
        '<tr><td style="padding:34px 40px 0;border-top:5px solid #475569;">'
        + '<table role="presentation" width="100%"><tr><td style="font-size:17px;font-weight:800;color:#334155;">{{cegnev}}</td><td style="text-align:right;font-size:12px;color:#64748b;">Nr. ref. · {{datum}}</td></tr></table>'
        + '<h2 style="margin:22px 0 14px;font-size:18px;color:#334155;text-transform:uppercase;letter-spacing:.5px;">Notificare</h2></td></tr>'
        + '<tr><td style="padding:0 40px 32px;color:#3f4756;">'
        + '<p style="margin:0 0 13px;font-size:14px;">În atenția domnului/doamnei <b>{{nev}}</b>,</p>'
        + '<p style="margin:0 0 13px;font-size:13.5px;line-height:1.85;text-align:justify;">Prin prezenta vă aducem la cunoștință informațiile relevante privind colaborarea noastră contractuală. Vă rugăm să acordați atenția cuvenită termenelor și condițiilor menționate în documentele aferente.</p>'
        + '<p style="margin:0 0 13px;font-size:13.5px;line-height:1.85;text-align:justify;">Pentru orice nelămurire, departamentul nostru rămâne la dispoziția dumneavoastră în zilele lucrătoare. Vă mulțumim pentru promptitudine și pentru buna colaborare de până acum.</p>'
        + '<p style="margin:24px 0 0;font-size:13.5px;">Cu stimă,<br><b>Departamentul Operațiuni — {{cegnev}}</b></p></td></tr>'
        + footer('#94a3b8', '#475569')) },

    // 17 — Több szekciós céges hírlevél (sűrű)
    { key: 'corporate-multi', accent: '#0369a1',
      name: { hu: '🗞️ Több szekciós hírlevél', ro: '🗞️ Newsletter multi-secțiune' },
      html: wrap('#eef2f5',
        '<tr><td style="background:#0c4a6e;padding:22px 32px;text-align:center;"><span style="color:#fff;font-size:19px;font-weight:800;">Noutăți {{cegnev}}</span><div style="color:#bae6fd;font-size:12px;margin-top:4px;">{{datum}}</div></td></tr>'
        + '<tr><td style="padding:24px 32px 4px;color:#0f2330;"><p style="margin:0 0 4px;font-size:14px;">Bună {{nev}}, pe scurt ce e nou:</p></td></tr>'
        + '<tr><td style="padding:8px 32px;"><h3 style="margin:0 0 6px;font-size:15px;color:#0369a1;">1 · Flotă extinsă</h3><p style="margin:0;font-size:13px;line-height:1.65;color:#475569;">Am adăugat noi vehicule pentru a reduce timpii de livrare pe rutele aglomerate.</p></td></tr>'
        + '<tr><td style="padding:0 32px;"><hr style="border:none;border-top:1px solid #e2e8f0;margin:14px 0;"></td></tr>'
        + '<tr><td style="padding:0 32px;"><h3 style="margin:0 0 6px;font-size:15px;color:#0369a1;">2 · Portal clienți</h3><p style="margin:0;font-size:13px;line-height:1.65;color:#475569;">Urmăriți transporturile în timp real și descărcați documentele direct din cont.</p></td></tr>'
        + '<tr><td style="padding:0 32px;"><hr style="border:none;border-top:1px solid #e2e8f0;margin:14px 0;"></td></tr>'
        + '<tr><td style="padding:0 32px 24px;"><h3 style="margin:0 0 6px;font-size:15px;color:#0369a1;">3 · Facturare electronică</h3><p style="margin:0 0 16px;font-size:13px;line-height:1.65;color:#475569;">Facturile sunt acum integrate e-Factura pentru conformitate completă.</p><div style="text-align:center;">' + btn('#0369a1', 'Citește mai mult') + '</div></td></tr>'
        + footer('#8aa7bb', '#0369a1')) },

    // 18 — Fuvar-állapot tábla (logisztika)
    { key: 'tracking-status', accent: '#0d9488',
      name: { hu: '🚚 Fuvar állapota', ro: '🚚 Stare transport' },
      html: wrap('#e9f4f2',
        '<tr><td style="background:#0d9488;padding:24px 32px;"><span style="color:#fff;font-size:19px;font-weight:800;">Stadiul transportului</span></td></tr>'
        + '<tr><td style="padding:26px 32px 8px;color:#134e4a;">'
        + '<p style="margin:0 0 16px;font-size:14px;">Stimate {{nev}}, transportul dvs. progresează:</p>'
        + '<table role="presentation" width="100%" style="border-collapse:collapse;font-size:13px;">'
        + '<tr><td style="padding:12px 14px;border-bottom:1px solid #d5ebe7;"><span style="color:#16a34a;font-size:16px;">●</span> Comandă preluată</td><td align="right" style="padding:12px 14px;border-bottom:1px solid #d5ebe7;color:#16a34a;font-weight:700;">Finalizat</td></tr>'
        + '<tr><td style="padding:12px 14px;border-bottom:1px solid #d5ebe7;"><span style="color:#0d9488;font-size:16px;">●</span> În tranzit</td><td align="right" style="padding:12px 14px;border-bottom:1px solid #d5ebe7;color:#0d9488;font-weight:700;">În desfășurare</td></tr>'
        + '<tr><td style="padding:12px 14px;"><span style="color:#cbd5e1;font-size:16px;">●</span> Livrare la destinație</td><td align="right" style="padding:12px 14px;color:#94a3b8;">În așteptare</td></tr>'
        + '</table>'
        + '<div style="text-align:center;margin:22px 0 4px;">' + btn('#0d9488', 'Urmărește în timp real') + '</div></td></tr>'
        + footer('#79aaa3', '#0d9488')) },

    // 19 — Szolgáltatási árlista
    { key: 'price-list', accent: '#b45309',
      name: { hu: '💲 Árlista', ro: '💲 Listă de prețuri' },
      html: wrap('#fbf3e8',
        '<tr><td style="background:#92400e;padding:24px 32px;text-align:center;"><h1 style="margin:0;color:#fff;font-size:21px;font-weight:800;">Lista noastră de servicii</h1></td></tr>'
        + '<tr><td style="padding:26px 32px 8px;color:#5b3d12;">'
        + '<p style="margin:0 0 16px;font-size:14px;">Bună {{nev}}, prețurile orientative {{cegnev}}:</p>'
        + '<table role="presentation" width="100%" style="border-collapse:collapse;font-size:13.5px;">'
        + '<tr><td style="padding:12px 4px;border-bottom:1px dashed #e0c9a6;">Transport FTL (camion complet)</td><td align="right" style="padding:12px 4px;border-bottom:1px dashed #e0c9a6;font-weight:700;">de la 0,95 €/km</td></tr>'
        + '<tr><td style="padding:12px 4px;border-bottom:1px dashed #e0c9a6;">Transport LTL (parțial)</td><td align="right" style="padding:12px 4px;border-bottom:1px dashed #e0c9a6;font-weight:700;">de la 0,55 €/km</td></tr>'
        + '<tr><td style="padding:12px 4px;border-bottom:1px dashed #e0c9a6;">Depozitare temporară</td><td align="right" style="padding:12px 4px;border-bottom:1px dashed #e0c9a6;font-weight:700;">12 €/zi</td></tr>'
        + '<tr><td style="padding:12px 4px;">Asigurare suplimentară marfă</td><td align="right" style="padding:12px 4px;font-weight:700;">la cerere</td></tr>'
        + '</table>'
        + '<div style="text-align:center;margin:22px 0 4px;">' + btn('#b45309', 'Solicită ofertă fermă') + '</div></td></tr>'
        + footer('#c2a25f', '#b45309')) },

    // 20 — Időpont / találkozó visszaigazolás
    { key: 'appointment', accent: '#4338ca',
      name: { hu: '📅 Időpont visszaigazolás', ro: '📅 Confirmare programare' },
      html: wrap('#eeeefb',
        '<tr><td style="background:#4338ca;padding:26px 32px;text-align:center;"><h1 style="margin:0;color:#fff;font-size:21px;font-weight:800;">Programare confirmată</h1></td></tr>'
        + '<tr><td style="padding:26px 32px;color:#312e81;">'
        + '<p style="margin:0 0 16px;font-size:14px;">Stimate {{nev}}, vă confirmăm întâlnirea:</p>'
        + '<table role="presentation" width="100%" style="background:#f5f5ff;border:1px solid #ddd6fe;border-radius:10px;font-size:14px;">'
        + '<tr><td style="padding:12px 16px;border-bottom:1px solid #e9e4fd;color:#6b7280;">📅 Data</td><td style="padding:12px 16px;border-bottom:1px solid #e9e4fd;font-weight:700;">{{datum}}</td></tr>'
        + '<tr><td style="padding:12px 16px;border-bottom:1px solid #e9e4fd;color:#6b7280;">🕐 Ora</td><td style="padding:12px 16px;border-bottom:1px solid #e9e4fd;font-weight:700;">10:00</td></tr>'
        + '<tr><td style="padding:12px 16px;color:#6b7280;">🏢 Companie</td><td style="padding:12px 16px;font-weight:700;">{{cegnev}}</td></tr>'
        + '</table>'
        + '<div style="text-align:center;margin:22px 0 4px;">' + btn('#4338ca', 'Confirmă prezența') + '</div></td></tr>'
        + footer('#a5a0e0', '#4338ca')) },

    // 21 — Éves összegzés (komoly, nagy számok)
    { key: 'annual-summary', accent: '#0f172a',
      name: { hu: '🏆 Éves összegzés', ro: '🏆 Sumar anual' },
      html: wrap('#eceef2',
        '<tr><td style="background:#0f172a;padding:34px 32px;text-align:center;">'
        + '<div style="color:#94a3b8;font-size:12px;letter-spacing:2px;text-transform:uppercase;">Sumar anual</div>'
        + '<h1 style="margin:8px 0 0;color:#fff;font-size:25px;font-weight:800;">{{cegnev}}</h1></td></tr>'
        + '<tr><td style="padding:28px 32px 6px;color:#1f2937;">'
        + '<p style="margin:0 0 20px;font-size:14px;line-height:1.7;">Stimate {{nev}}, vă mulțumim pentru un an de colaborare. Pe scurt:</p>'
        + '<table role="presentation" width="100%"><tr>'
        + '<td width="33%" style="text-align:center;"><div style="font-size:24px;font-weight:800;color:#0f172a;">1.480</div><div style="font-size:11px;color:#64748b;">transporturi</div></td>'
        + '<td width="33%" style="text-align:center;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;"><div style="font-size:24px;font-weight:800;color:#0f172a;">1,1M</div><div style="font-size:11px;color:#64748b;">km</div></td>'
        + '<td width="33%" style="text-align:center;"><div style="font-size:24px;font-weight:800;color:#0f172a;">99%</div><div style="font-size:11px;color:#64748b;">la timp</div></td></tr></table>'
        + '<p style="margin:22px 0 22px;font-size:13.5px;line-height:1.7;color:#475569;">Ne bucurăm să continuăm parteneriatul și în anul ce vine, cu aceeași seriozitate.</p>'
        + '<div style="text-align:center;">' + btn('#0f172a', 'Vezi raportul anual') + '</div></td></tr>'
        + footer('#94a3b8', '#0f172a')) },

    // ───────── FUTURISZTIKUS SABLONOK ─────────

    // 22 — Neon sötét (cyan/magenta ragyogás)
    { key: 'neon-dark', accent: '#22d3ee',
      name: { hu: '⚡ Neon — sötét', ro: '⚡ Neon — dark' },
      html: darkWrap('#05060a', '#0b0e17', 'Arial,Helvetica,sans-serif',
        '<tr><td style="padding:44px 34px 10px;text-align:center;border-bottom:1px solid #18203a;">'
        + '<div style="font-size:12px;letter-spacing:4px;color:#22d3ee;text-transform:uppercase;">{{cegnev}}</div>'
        + '<h1 style="margin:14px 0 0;font-size:27px;color:#f0f9ff;font-weight:800;text-shadow:0 0 14px rgba(34,211,238,.6);">Viitorul transportului</h1></td></tr>'
        + '<tr><td style="padding:26px 34px 36px;text-align:center;">'
        + '<p style="margin:0 0 26px;font-size:14px;line-height:1.8;color:#9fb3d1;">Salut {{nev}}, descoperă soluții logistice de nouă generație, construite pentru viteză și precizie.</p>'
        + gbtn('#22d3ee', 'linear-gradient(90deg,#22d3ee,#d946ef)', 'ACCESEAZĂ') + '</td></tr>'
        + '<tr><td style="padding:16px 34px 26px;border-top:1px solid #18203a;text-align:center;font-size:11px;color:#54618a;">{{cegnev}} · {{datum}}</td></tr>') },

    // 23 — Üveg-gradiens (glassmorphism hatás)
    { key: 'glass-gradient', accent: '#a78bfa',
      name: { hu: '🔮 Üveg — gradiens', ro: '🔮 Sticlă — gradient' },
      html: '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#6d28d9;background:linear-gradient(135deg,#7c3aed,#2563eb);padding:34px 0;margin:0;"><tr><td align="center">'
        + '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.25);border-radius:18px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">'
        + '<tr><td style="padding:46px 36px;text-align:center;">'
        + '<h1 style="margin:0 0 10px;font-size:26px;color:#fff;font-weight:800;">Ceva nou, transparent și clar</h1>'
        + '<p style="margin:0 0 26px;font-size:14px;line-height:1.8;color:#eef2ff;">Bună {{nev}}, {{cegnev}} îți prezintă o experiență modernă și fără complicații.</p>'
        + '<a href="#" style="display:inline-block;background:rgba(255,255,255,0.92);color:#5b21b6;text-decoration:none;font-weight:800;padding:13px 32px;border-radius:30px;font-size:14px;">Hai să începem</a></td></tr>'
        + '<tr><td style="padding:14px 36px 24px;text-align:center;font-size:11px;color:#e0d7ff;border-top:1px solid rgba(255,255,255,0.18);">{{cegnev}} · {{datum}}</td></tr>'
        + '</table></td></tr></table>' },

    // 24 — Terminál / tech (monospace, zöld)
    { key: 'terminal-tech', accent: '#22c55e',
      name: { hu: '💻 Terminál — tech', ro: '💻 Terminal — tech' },
      html: darkWrap('#000000', '#0a0f0a', "'Courier New',Courier,monospace",
        '<tr><td style="padding:18px 24px;border-bottom:1px solid #16301a;"><span style="color:#22c55e;font-size:13px;">user@{{cegnev}}:~$</span> <span style="color:#7dd3a0;font-size:13px;">./mesaj.sh</span></td></tr>'
        + '<tr><td style="padding:26px 24px 30px;">'
        + '<p style="margin:0 0 10px;font-size:14px;color:#22c55e;">&gt; Bună, {{nev}}</p>'
        + '<p style="margin:0 0 10px;font-size:13px;line-height:1.8;color:#86efac;">&gt; Inițializare colaborare... <span style="color:#22c55e;">[OK]</span></p>'
        + '<p style="margin:0 0 10px;font-size:13px;line-height:1.8;color:#86efac;">&gt; Soluții de transport eficiente, monitorizate în timp real.</p>'
        + '<p style="margin:0 0 22px;font-size:13px;line-height:1.8;color:#86efac;">&gt; Status: <span style="color:#22c55e;">gata de drum</span></p>'
        + '<a href="#" style="display:inline-block;border:1px solid #22c55e;color:#22c55e;text-decoration:none;font-weight:700;padding:11px 26px;border-radius:4px;font-size:13px;">[ EXECUTĂ ]</a></td></tr>'
        + '<tr><td style="padding:14px 24px;border-top:1px solid #16301a;font-size:11px;color:#3f6b48;">// {{cegnev}} · {{datum}}</td></tr>') },

    // 25 — Holografikus (iridescent gradiens)
    { key: 'holographic', accent: '#ec4899',
      name: { hu: '🌈 Holografikus', ro: '🌈 Holografic' },
      html: wrap('#0f0f1a',
        '<tr><td style="background:#7c3aed;background:linear-gradient(120deg,#22d3ee,#a855f7,#ec4899,#f59e0b);padding:48px 32px;text-align:center;">'
        + '<h1 style="margin:0;color:#fff;font-size:27px;font-weight:800;text-shadow:0 2px 12px rgba(0,0,0,.25);">Strălucește diferit</h1>'
        + '<p style="margin:10px 0 0;color:#fff;font-size:14px;opacity:.95;">{{cegnev}}</p></td></tr>'
        + '<tr><td style="padding:32px;text-align:center;color:#1f2937;">'
        + '<p style="margin:0 0 24px;font-size:15px;line-height:1.8;color:#475569;">Bună {{nev}}, ieși în evidență cu o abordare modernă și plină de culoare a transportului.</p>'
        + gbtn('#a855f7', 'linear-gradient(90deg,#a855f7,#ec4899)', 'Descoperă') + '</td></tr>'
        + footer('#9ca3af', '#a855f7')) },

    // 26 — Cyberpunk (neon pink/cyan)
    { key: 'cyberpunk', accent: '#ff2d95',
      name: { hu: '🌃 Cyberpunk', ro: '🌃 Cyberpunk' },
      html: darkWrap('#070311', '#0e0820', 'Arial,Helvetica,sans-serif',
        '<tr><td style="padding:40px 32px 12px;text-align:center;border-bottom:1px solid #2a1840;">'
        + '<div style="font-size:11px;letter-spacing:5px;color:#05d9e8;text-transform:uppercase;">// {{cegnev}}</div>'
        + '<h1 style="margin:14px 0 0;font-size:28px;color:#ff2d95;font-weight:800;text-transform:uppercase;text-shadow:0 0 16px rgba(255,45,149,.7);">Conectează-te</h1></td></tr>'
        + '<tr><td style="padding:24px 32px 34px;text-align:center;">'
        + '<p style="margin:0 0 26px;font-size:14px;line-height:1.8;color:#b6a7d6;">Salut {{nev}}. Intră în rețeaua noastră logistică — rapid, sigur, fără limite.</p>'
        + gbtn('#ff2d95', 'linear-gradient(90deg,#ff2d95,#05d9e8)', 'INTRĂ ÎN SISTEM') + '</td></tr>'
        + '<tr><td style="padding:14px 32px;border-top:1px solid #2a1840;text-align:center;font-size:11px;color:#6b5a8c;">{{cegnev}} · {{datum}}</td></tr>') },

    // 27 — Elektromos minimál (futurisztikus, geometrikus)
    { key: 'electric-minimal', accent: '#2f6bff',
      name: { hu: '🔷 Elektromos minimál', ro: '🔷 Minimal electric' },
      html: wrap('#f3f6ff',
        '<tr><td style="padding:0;"><div style="height:6px;background:#2f6bff;background:linear-gradient(90deg,#2f6bff,#22d3ee);"></div></td></tr>'
        + '<tr><td style="padding:42px 40px 0;">'
        + '<div style="display:inline-block;border:1px solid #2f6bff;color:#2f6bff;font-size:11px;letter-spacing:2px;padding:5px 12px;border-radius:30px;text-transform:uppercase;">{{cegnev}}</div>'
        + '<h1 style="margin:22px 0 16px;font-size:25px;color:#0b1f4d;font-weight:800;line-height:1.25;">Tehnologie care mișcă lucrurile</h1>'
        + '<p style="margin:0 0 26px;font-size:15px;line-height:1.8;color:#475569;">Bună {{nev}}, combinăm date în timp real și automatizare pentru transporturi fără fricțiune.</p>'
        + gbtn('#2f6bff', 'linear-gradient(90deg,#2f6bff,#22d3ee)', 'Vezi platforma')
        + '<div style="height:40px;"></div></td></tr>'
        + footer('#9bb0d8', '#2f6bff')) },

    // 28 — Kozmikus (sötét tér, lila)
    { key: 'cosmic-space', accent: '#8b5cf6',
      name: { hu: '🌌 Kozmikus', ro: '🌌 Cosmic' },
      html: '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b1026;background:radial-gradient(circle at 30% 20%,#1e1b4b,#0b1026 70%);padding:30px 0;margin:0;"><tr><td align="center">'
        + '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#10142e;border:1px solid #2a2f55;border-radius:18px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">'
        + '<tr><td style="padding:48px 36px 14px;text-align:center;">'
        + '<div style="font-size:34px;">🚀</div>'
        + '<h1 style="margin:14px 0 0;font-size:26px;color:#ede9fe;font-weight:800;">Lansăm ceva nou</h1></td></tr>'
        + '<tr><td style="padding:14px 36px 36px;text-align:center;">'
        + '<p style="margin:0 0 26px;font-size:14px;line-height:1.8;color:#a5b0e0;">Stimate {{nev}}, {{cegnev}} duce logistica într-o nouă dimensiune. Pregătiți-vă de decolare.</p>'
        + gbtn('#8b5cf6', 'linear-gradient(90deg,#8b5cf6,#6366f1)', 'Pornește') + '</td></tr>'
        + '<tr><td style="padding:14px 36px 24px;border-top:1px solid #2a2f55;text-align:center;font-size:11px;color:#6b73a8;">{{cegnev}} · {{datum}}</td></tr>'
        + '</table></td></tr></table>' },

    // ───────── MODERN VÁLTOZATOK ─────────

    // 29 — Lágy modern kártya (pasztel gradiens)
    { key: 'soft-modern', accent: '#6366f1',
      name: { hu: '☁️ Lágy modern', ro: '☁️ Modern delicat' },
      html: wrap('#eef0fb',
        '<tr><td style="background:#e0e7ff;background:linear-gradient(135deg,#e0e7ff,#fae8ff);padding:40px 32px;text-align:center;">'
        + '<h1 style="margin:0;font-size:24px;color:#3730a3;font-weight:800;">Bună ziua, {{nev}} 👋</h1>'
        + '<p style="margin:8px 0 0;font-size:14px;color:#6d28d9;">de la echipa {{cegnev}}</p></td></tr>'
        + '<tr><td style="padding:30px 32px;color:#3b3a52;">'
        + '<p style="margin:0 0 22px;font-size:15px;line-height:1.8;color:#52506b;">Un mesaj cald și prietenos. Suntem bucuroși să colaborăm și vă stăm la dispoziție oricând aveți nevoie.</p>'
        + '<div style="text-align:center;">' + btn('#6366f1', 'Scrie-ne') + '</div></td></tr>'
        + footer('#a3a0d0', '#6366f1')) },

    // 30 — Gradiens mesh (élénk, modern)
    { key: 'gradient-mesh', accent: '#f97316',
      name: { hu: '🎨 Gradiens mesh', ro: '🎨 Gradient mesh' },
      html: wrap('#fdeee4',
        '<tr><td style="background:#f97316;background:linear-gradient(115deg,#f97316,#ec4899,#8b5cf6);padding:46px 32px;text-align:center;">'
        + '<h1 style="margin:0;color:#fff;font-size:27px;font-weight:800;">Culoare. Energie. Mișcare.</h1>'
        + '<p style="margin:10px 0 0;color:#fff;opacity:.95;font-size:14px;">{{cegnev}}</p></td></tr>'
        + '<tr><td style="padding:32px;text-align:center;color:#3a2433;">'
        + '<p style="margin:0 0 24px;font-size:15px;line-height:1.8;color:#6b4a5c;">Salut {{nev}}! Aducem un strop de energie în fiecare livrare. Hai să creăm ceva memorabil împreună.</p>'
        + gbtn('#ec4899', 'linear-gradient(90deg,#f97316,#ec4899)', 'Începe acum') + '</td></tr>'
        + footer('#c79bb0', '#ec4899')) },

  ];
})();
