// Szerveroldali üzenetek fordítása (RO/HU) — a tx() fordított kereséshez.
// A 'hu' érték BÁJTRA AZONOS a szerver által küldött szöveggel (pontos egyezésű kereséshez).
(window.registerI18n || function (d) { (window.__i18nQueue = window.__i18nQueue || []).push(d); })({
  // ---- clientPortal.js ----
  'srv.m1': { hu: 'Válassz ügyfelet.', ro: 'Selectează un client.' },
  'srv.m2': { hu: 'Érvénytelen e-mail cím.', ro: 'Adresă de e-mail invalidă.' },
  'srv.m3': { hu: 'Az ügyfél nem található.', ro: 'Clientul nu a fost găsit.' },
  'srv.m4': { hu: 'Ez az e-mail már egy másik fuvarozónál van regisztrálva.', ro: 'Acest e-mail este deja înregistrat la un alt transportator.' },
  'srv.m5': { hu: 'ID kötelező.', ro: 'ID-ul este obligatoriu.' },
  'srv.m6': { hu: 'Nem található.', ro: 'Nu a fost găsit.' },

  // ---- hereFeatureHandlers.js ----
  'srv.m7': { hu: 'Ismeretlen szolgáltatás', ro: 'Serviciu necunoscut' },
  'srv.m8': { hu: 'Érvénytelen ár', ro: 'Preț invalid' },

  // ---- mapsProvider.js ----
  'srv.m9': { hu: 'Érvénytelen szolgáltató.', ro: 'Furnizor invalid.' },

  // ---- fleetCompliance.js ----
  'srv.m10': { hu: 'A dokumentum-típus és a lejárati dátum kötelező.', ro: 'Tipul documentului și data expirării sunt obligatorii.' },
  'srv.m11': { hu: 'Válassz járművet!', ro: 'Selectează un vehicul!' },
  'srv.m12': { hu: 'A jármű nem található.', ro: 'Vehiculul nu a fost găsit.' },
  'srv.m13': { hu: 'Válassz sofőrt!', ro: 'Selectează un șofer!' },
  'srv.m14': { hu: 'Érvénytelen összeg.', ro: 'Sumă invalidă.' },
  'srv.m15': { hu: 'A sofőr nem található.', ro: 'Șoferul nu a fost găsit.' },
  'srv.m16': { hu: 'Nincs importálható sor.', ro: 'Nu există rânduri de importat.' },
  'srv.m17': { hu: 'Szerver hiba (lefutott a phase4 migráció?)', ro: 'Eroare de server (a rulat migrarea phase4?)' },

  // ---- billingHandlers.js ----
  'srv.m18': { hu: 'Ismeretlen számlázó.', ro: 'Furnizor de facturare necunoscut.' },
  'srv.m19': { hu: 'Nincs mentett integráció ehhez a számlázóhoz.', ro: 'Nu există o integrare salvată pentru acest furnizor de facturare.' },
  'srv.m20': { hu: 'Hiányzó csomag ID', ro: 'ID-ul abonamentului lipsește' },
  'srv.m21': { hu: 'Hiányzó cég ID', ro: 'ID-ul companiei lipsește' },
  'srv.m22': { hu: 'Nincs aktív számlázó integráció ehhez a céghez.', ro: 'Nu există o integrare de facturare activă pentru această companie.' },
  'srv.m23': { hu: 'Nincs számlázható tétel (nincs csomag és nincs HERE használat).', ro: 'Nu există elemente de facturat (nici abonament, nici utilizare HERE).' },
  'srv.m24': { hu: 'A számlázó hitelesítő adatai nem olvashatók.', ro: 'Datele de autentificare ale furnizorului de facturare nu pot fi citite.' },

  // ---- fleet.js ----
  'srv.m25': { hu: 'Jármű ID kötelező.', ro: 'ID-ul vehiculului este obligatoriu.' },
  'srv.m26': { hu: 'A pótkocsi nem található.', ro: 'Remorca nu a fost găsită.' },
  'srv.m27': { hu: 'A vontató nem található.', ro: 'Capul tractor nu a fost găsit.' },

  // ---- handover.js ----
  'srv.m28': { hu: 'Add meg, mi történik az áruval (pótkocsin parkol / raktárba kerül).', ro: 'Precizează ce se întâmplă cu marfa (rămâne pe remorcă / intră în depozit).' },
  'srv.m29': { hu: 'A leadás helye (helység) kötelező.', ro: 'Locul predării (localitatea) este obligatoriu.' },
  'srv.m30': { hu: 'A darabszám és az egység (paletta/doboz/egyéb) kötelező.', ro: 'Numărul de bucăți și unitatea (palet/cutie/altele) sunt obligatorii.' },
  'srv.m31': { hu: 'A foglalt hely méretei (hossz/szélesség/magasság cm) kötelezők.', ro: 'Dimensiunile spațiului ocupat (lungime/lățime/înălțime cm) sunt obligatorii.' },
  'srv.m32': { hu: 'A súly (kg) kötelező.', ro: 'Greutatea (kg) este obligatorie.' },
  'srv.m33': { hu: 'Add meg, hány lapos a kísérő dokumentum (pl. 10).', ro: 'Precizează din câte file este documentul însoțitor (ex. 10).' },
  'srv.m34': { hu: 'Fuvar nem található', ro: 'Transportul nu a fost găsit' },
  'srv.m35': { hu: 'Lezárt/törölt fuvar nem adható le.', ro: 'Un transport finalizat/anulat nu poate fi predat.' },
  'srv.m36': { hu: 'Add meg, mi történik az áruval.', ro: 'Precizează ce se întâmplă cu marfa.' },
  'srv.m37': { hu: 'A fuvar nem található, nem a tiéd, vagy nem aktív.', ro: 'Transportul nu a fost găsit, nu îți aparține sau nu este activ.' },
  'srv.m38': { hu: 'Nincs függő leadás-kérés ezen a fuvaron.', ro: 'Nu există o cerere de predare în așteptare pentru acest transport.' },
  'srv.m39': { hu: 'A fuvar időközben lezárult — a kérés már nem igazolható vissza.', ro: 'Transportul s-a finalizat între timp — cererea nu mai poate fi confirmată.' },
  'srv.m40': { hu: 'Nincs függő leadás-kérés.', ro: 'Nu există o cerere de predare în așteptare.' },

  // ---- carriers.js ----
  'srv.m41': { hu: 'A cégnév kötelező.', ro: 'Denumirea companiei este obligatorie.' },
  'srv.m42': { hu: 'Van hozzá szállítói számla — előbb inkább tedd inaktívvá.', ro: 'Există o factură de furnizor asociată — mai bine dezactivează-l mai întâi.' },
  'srv.m43': { hu: 'Válassz alvállalkozót.', ro: 'Selectează un subcontractant.' },
  'srv.m44': { hu: 'Alvállalkozó nem található.', ro: 'Subcontractantul nu a fost găsit.' },
  'srv.m45': { hu: 'Érvénytelen e-mail.', ro: 'E-mail invalid.' },

  // ---- documents.js ----
  'srv.m46': { hu: 'Nincs jogosultság', ro: 'Acces neautorizat' },
  'srv.m47': { hu: 'Hiányzó azonosító', ro: 'Identificator lipsă' },
  'srv.m48': { hu: 'Nem található', ro: 'Nu a fost găsit' },
  'srv.m49': { hu: 'Nem található / nincs jogosultság', ro: 'Nu a fost găsit / acces neautorizat' },

  // ---- orders.js ----
  'srv.m50': { hu: 'Válaszd ki a rakomány típusát (FTL teljes / LTL részrakomány).', ro: 'Selectează tipul încărcăturii (FTL complet / LTL grupaj).' },
  'srv.m51': { hu: 'Részrakománynál (LTL) a méretek (hossz/szélesség/magasság cm) kötelezők.', ro: 'La grupaj (LTL) dimensiunile (lungime/lățime/înălțime cm) sunt obligatorii.' },
  'srv.m52': { hu: 'Az ügyfél tracking-link nincs előfizetve ennél a cégnél.', ro: 'Link-ul de urmărire pentru client nu este abonat la această companie.' },
  'srv.m53': { hu: 'Nincs módosítandó mező.', ro: 'Nu există niciun câmp de modificat.' },

  // ---- routePlannerHandlers.js ----
  'srv.m54': { hu: 'Hiányzó jármű azonosító', ro: 'Identificatorul vehiculului lipsește' },
  'srv.m55': { hu: 'Jármű nem található', ro: 'Vehiculul nu a fost găsit' },
  'srv.m56': { hu: 'GPS pozíció nem elérhető', ro: 'Poziția GPS nu este disponibilă' },
  'srv.m57': { hu: 'Az útvonaltervezés nincs előfizetve ennél a cégnél.', ro: 'Planificarea rutei nu este abonată la această companie.' },
  'srv.m58': { hu: 'Legalább a felrakó és lerakó pont szükséges.', ro: 'Sunt necesare cel puțin punctul de încărcare și cel de descărcare.' },
  'srv.m59': { hu: 'A térképes útvonal-számítás nincs engedélyezve ennél a cégnél.', ro: 'Calculul rutei pe hartă nu este activat la această companie.' },

  // ---- statisticsHandlers.js ----
  'srv.m60': { hu: 'Hibás felhasználó', ro: 'Utilizator incorect' },
  'srv.m61': { hu: 'A felhasználó nem található', ro: 'Utilizatorul nu a fost găsit' },
  'srv.m62': { hu: 'Csak Finalizat fuvarhoz rögzíthető fizetés', ro: 'Plata se poate înregistra doar pentru un transport Finalizat' },
  'srv.m63': { hu: 'Érvénytelen összeg', ro: 'Sumă invalidă' },
  'srv.m64': { hu: 'Érvénytelen árfolyam (0.5–20 között adható meg)', ro: 'Curs valutar invalid (se poate introduce între 0.5–20)' },
  'srv.m65': { hu: 'A BNR árfolyam nem olvasható ki.', ro: 'Cursul BNR nu poate fi citit.' },
  'srv.m66': { hu: 'A BNR nem elérhető.', ro: 'BNR nu este disponibil.' },
  'srv.m67': { hu: 'Az admin nem engedélyezte számodra a pénzügyi riportot', ro: 'Administratorul nu ți-a permis accesul la raportul financiar' },
  'srv.m68': { hu: 'Nincs jogosultság a pénzügyi riporthoz', ro: 'Acces neautorizat la raportul financiar' },

  // ---- toll.js ----
  'srv.m69': { hu: 'Add meg a felrakó és lerakó címet (vagy számolj térképes km-et) az útdíj-becsléshez.', ro: 'Introdu adresa de încărcare și descărcare (sau calculează km-ii pe hartă) pentru estimarea taxei de drum.' },
  'srv.m70': { hu: 'Nincs mentendő ráta.', ro: 'Nu există tarif de salvat.' },

  // ---- intakeHandlers.js ----
  'srv.m71': { hu: 'Csak Admin módosíthatja.', ro: 'Doar Administratorul poate modifica.' },
  'srv.m72': { hu: 'Nincs mentett beállítás. Add meg az adatokat és teszteld.', ro: 'Nu există setări salvate. Introdu datele și testează.' },
  'srv.m73': { hu: 'Csak Admin törölheti.', ro: 'Doar Administratorul poate șterge.' },

  // ---- developer.js ----
  'srv.m74': { hu: 'Hiányzó cég ID.', ro: 'ID-ul companiei lipsește.' },
  'srv.m75': { hu: 'Hiányzó adat.', ro: 'Date lipsă.' },
  'srv.m76': { hu: 'Hiányzó user ID.', ro: 'ID-ul utilizatorului lipsește.' },
  'srv.m77': { hu: 'Felhasználó nem található.', ro: 'Utilizatorul nu a fost găsit.' },
  'srv.m78': { hu: 'Developer fiók nem tiltható.', ro: 'Contul de developer nu poate fi blocat.' },
  'srv.m79': { hu: 'Developer fiók nem törölhető.', ro: 'Contul de developer nu poate fi șters.' },
  'srv.m80': { hu: 'Saját fiók nem törölhető.', ro: 'Propriul cont nu poate fi șters.' },
  'srv.m81': { hu: 'Írj le legalább 5 karaktert!', ro: 'Scrie cel puțin 5 caractere!' },
  'srv.m82': { hu: 'Túl hosszú szöveg (max 2000 karakter).', ro: 'Text prea lung (maxim 2000 de caractere).' },

  // ---- users.js ----
  'srv.m83': { hu: 'Csak admin állíthatja.', ro: 'Doar administratorul poate seta acest lucru.' },
  'srv.m84': { hu: 'Minden mező kötelező.', ro: 'Toate câmpurile sunt obligatorii.' },
  'srv.m85': { hu: 'Az új jelszó legalább 6 karakter legyen.', ro: 'Noua parolă trebuie să aibă cel puțin 6 caractere.' },
  'srv.m86': { hu: 'A jelenlegi jelszó helytelen.', ro: 'Parola curentă este incorectă.' },
  'srv.m87': { hu: 'A név kötelező.', ro: 'Numele este obligatoriu.' },
  'srv.m88': { hu: 'A jelszó megadása kötelező a 2FA kikapcsolásához.', ro: 'Introducerea parolei este obligatorie pentru dezactivarea 2FA.' },
  'srv.m89': { hu: 'Helytelen jelszó.', ro: 'Parolă incorectă.' },

  // ---- routes/cargotrack.js ----
  'srv.m90': { hu: 'Hiányzik az API-kulcs.', ro: 'Cheia API lipsește.' },
  'srv.m91': { hu: 'Előbb mentsd el a CargoTrack API-kulcsot.', ro: 'Salvează mai întâi cheia API CargoTrack.' },
  'srv.m92': { hu: 'Nincs beállított CargoTrack kulcs.', ro: 'Nu există o cheie CargoTrack configurată.' },
  'srv.m93': { hu: 'rendszam és object_id kötelező.', ro: 'rendszam și object_id sunt obligatorii.' },
  'srv.m94': { hu: 'rendszam kötelező.', ro: 'rendszam este obligatoriu.' },
  'srv.m95': { hu: 'Ez a rendszám nincs összepárosítva GPS-szel.', ro: 'Acest număr de înmatriculare nu este asociat cu GPS-ul.' },
  'srv.m96': { hu: 'rendszam vagy object_id kötelező.', ro: 'rendszam sau object_id este obligatoriu.' },
  'srv.m97': { hu: 'Nincs friss pozícióadat.', ro: 'Nu există date de poziție recente.' },

  // ---- routes/clients.js ----
  'srv.m98': { hu: 'cui kötelező.', ro: 'cui este obligatoriu.' },

  // ---- routes/ordersRest.js ----
  'srv.m99': { hu: 'Érvénytelen státusz', ro: 'Status invalid' },
  'srv.m100': { hu: 'Nem található vagy nincs jogosultság', ro: 'Nu a fost găsit sau acces neautorizat' },

  // ---- routes/invoices.js ----
  'srv.m101': { hu: 'provider kötelező.', ro: 'provider este obligatoriu.' },
  'srv.m102': { hu: 'Nincs mentett számlázó. Előbb add meg és mentsd el a CodUnic + kulcs adatokat.', ro: 'Nu există un furnizor de facturare salvat. Introdu și salvează mai întâi datele CodUnic + cheie.' },
  'srv.m103': { hu: 'Ehhez a szolgáltatóhoz nincs kapcsolat-teszt.', ro: 'Pentru acest furnizor nu există test de conexiune.' },
  'srv.m104': { hu: 'Nincs bekapcsolt számlázó.', ro: 'Nu există un furnizor de facturare activat.' },
  'srv.m105': { hu: 'Fuvar nem található.', ro: 'Transportul nu a fost găsit.' },
  'srv.m106': { hu: 'Számla nem található.', ro: 'Factura nu a fost găsită.' },
  'srv.m107': { hu: 'Nincs számlázó-integráció beállítva.', ro: 'Nu există o integrare de facturare configurată.' },
  'srv.m108': { hu: 'Ehhez a szolgáltatóhoz nincs számla-státusz lekérdezés.', ro: 'Pentru acest furnizor nu există interogare de status al facturii.' },

  // ---- routes/soferApi.js ----
  'srv.m109': { hu: 'Prefix kötelező.', ro: 'Prefixul este obligatoriu.' },

  // ---- routes/portal.js ----
  'srv.m110': { hu: 'E-mail és jelszó kötelező.', ro: 'E-mailul și parola sunt obligatorii.' },
  'srv.m111': { hu: 'Hibás e-mail vagy jelszó.', ro: 'E-mail sau parolă incorectă.' },
  'srv.m112': { hu: 'A hozzáférésed le van tiltva. Egyeztess a fuvarozóval.', ro: 'Accesul tău este blocat. Contactează transportatorul.' },
  'srv.m113': { hu: 'Az ügyfél-portál jelenleg nem aktív. Egyeztess a fuvarozóval.', ro: 'Portalul de client nu este activ momentan. Contactează transportatorul.' },
  'srv.m114': { hu: 'A jelszó legalább 6 karakter legyen.', ro: 'Parola trebuie să aibă cel puțin 6 caractere.' },
  'srv.m115': { hu: 'A meghívó-link érvénytelen vagy lejárt. Kérj újat a fuvarozótól.', ro: 'Link-ul de invitație este invalid sau a expirat. Cere unul nou de la transportator.' },
  'srv.m116': { hu: 'Az ügyfél-portál jelenleg nem aktív.', ro: 'Portalul de client nu este activ momentan.' },
  'srv.m117': { hu: 'A felrakó és a lerakó cím kötelező.', ro: 'Adresa de încărcare și cea de descărcare sunt obligatorii.' },

  // ---- routes/client-mail.js ----
  'srv.m118': { hu: 'Hiányzik a kép.', ro: 'Imaginea lipsește.' },
  'srv.m119': { hu: 'A logó túl nagy (max ~3 MB).', ro: 'Logo-ul este prea mare (maxim ~3 MB).' },
  'srv.m120': { hu: 'A sablon neve kötelező.', ro: 'Numele șablonului este obligatoriu.' },
  'srv.m121': { hu: 'A címzett és az üzenet kötelező.', ro: 'Destinatarul și mesajul sunt obligatorii.' },

  // ---- routes/uit.js ----
  'srv.m122': { hu: 'A UIT-kód kötelező.', ro: 'Codul UIT este obligatoriu.' },
  'srv.m123': { hu: 'Ez a UIT már rögzítve van ennél a fuvarnál.', ro: 'Acest UIT este deja înregistrat la acest transport.' },
  'srv.m124': { hu: 'Nincs bekapcsolt GPS-integráció (Integrációk fül).', ro: 'Nu există o integrare GPS activată (fila Integrări).' },
  'srv.m125': { hu: 'Nincs jogosultság ehhez a fuvarhoz.', ro: 'Acces neautorizat la acest transport.' },
  'srv.m126': { hu: 'Ehhez a fuvarhoz már van UIT-kód — sofőrként újat nem adhatsz hozzá.', ro: 'Acest transport are deja un cod UIT — ca șofer nu poți adăuga unul nou.' },
  'srv.m127': { hu: 'Ez a UIT már rögzítve van.', ro: 'Acest UIT este deja înregistrat.' },

  // ---- routes/carrier-portal.js ----
  'srv.m128': { hu: 'A hozzáférésed le van tiltva.', ro: 'Accesul tău este blocat.' },
  'srv.m129': { hu: 'Az alvállalkozói portál jelenleg nem aktív.', ro: 'Portalul subcontractanților nu este activ momentan.' },
  'srv.m130': { hu: 'A meghívó-link érvénytelen vagy lejárt.', ro: 'Link-ul de invitație este invalid sau a expirat.' },
  'srv.m131': { hu: 'A vontató rendszáma kötelező.', ro: 'Numărul de înmatriculare al capului tractor este obligatoriu.' },
  'srv.m132': { hu: 'Hiányzó fájl.', ro: 'Fișier lipsă.' },
  'srv.m133': { hu: 'A fájl túl nagy (max ~10 MB).', ro: 'Fișierul este prea mare (maxim ~10 MB).' },

  // ---- routes/inbound-orders.js ----
  'srv.m134': { hu: 'Nem található vagy már jóváhagyott.', ro: 'Nu a fost găsit sau a fost deja aprobat.' },
  'srv.m135': { hu: 'Már jóváhagyva.', ro: 'Deja aprobat.' },

  // ---- routes/auth.js ----
  'srv.m136': { hu: 'Ha létezik fiók ezzel az email címmel, elküldtük a visszaállítási linket.', ro: 'Dacă există un cont cu această adresă de e-mail, am trimis link-ul de resetare.' },
  'srv.m137': { hu: 'Szerver hiba. Próbálja újra később.', ro: 'Eroare de server. Încercați din nou mai târziu.' },
  'srv.m138': { hu: 'Hiányzó adatok.', ro: 'Date lipsă.' },
  'srv.m139': { hu: 'Érvénytelen vagy már felhasznált link.', ro: 'Link invalid sau deja folosit.' },
  'srv.m140': { hu: 'A link lejárt. Kérjen új visszaállítási linket.', ro: 'Link-ul a expirat. Solicitați un nou link de resetare.' },
  'srv.m141': { hu: 'Jelszó sikeresen megváltoztatva. Most már bejelentkezhet.', ro: 'Parola a fost schimbată cu succes. Acum vă puteți autentifica.' },
  'srv.m142': { hu: 'A fiókod le van tiltva. Kérjük vegye fel a kapcsolatot az adminisztrátorral.', ro: 'Contul tău este blocat. Vă rugăm să contactați administratorul.' },
  'srv.m143': { hu: 'A cég előfizetése lejárt vagy törölve lett. Kérjük vegye fel a kapcsolatot az adminisztrátorral.', ro: 'Abonamentul companiei a expirat sau a fost anulat. Vă rugăm să contactați administratorul.' },
  'srv.m144': { hu: '2FA nem elérhető', ro: '2FA nu este disponibil' },
  'srv.m145': { hu: 'Nincs folyamatban 2FA beállítás. Kezdd újra.', ro: 'Nu există o configurare 2FA în curs. Începe din nou.' },
  'srv.m146': { hu: 'Helytelen kód. Próbáld újra.', ro: 'Cod incorect. Încearcă din nou.' }
});
