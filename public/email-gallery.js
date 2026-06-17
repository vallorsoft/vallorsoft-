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

  ];
})();
