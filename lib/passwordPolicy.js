// ============================================================
//  VallorSoft — Jelszó-szabály (közös, EGY forrás)
//
//  Kötelező jelszó-erősség MINDEN ÚJ jelszó beállításánál:
//  regisztráció (meghívóval / nyilvános), jelszó-reset, jelszó-csere,
//  admin által beállított jelszó, ügyfél-/alvállalkozói portál belépő.
//
//  Szabály: min. 8 karakter, ÉS tartalmaz legalább
//    - 1 kisbetűt (a–z)
//    - 1 nagybetűt (A–Z)
//    - 1 számjegyet (0–9)
//    - 1 szimbólumot (nem betű/számjegy, pl. _ )
//
//  FONTOS: ez CSAK a jelszó-beállítást validálja, a BELÉPÉST (bcrypt.compare)
//  NEM érinti — a már regisztrált felhasználók (jelenleg a developer) régi
//  jelszava változatlanul működik, nem kell azonnal cserélniük.
// ============================================================
'use strict';

const MIN_LEN = 8;

// Kétnyelvű (RO-alap + HU) hibaüzenet — a kifelé menő szöveg románul elöl.
const POLICY_ERR =
  'Parola trebuie să aibă minim 8 caractere și să conțină cel puțin o literă mică, ' +
  'o literă mare, o cifră și un simbol (ex. _). / A jelszónak legalább 8 karakterből kell ' +
  'állnia, és tartalmaznia kell legalább egy kisbetűt, egy nagybetűt, egy számjegyet és egy szimbólumot (pl. _).';

/**
 * Megvizsgálja, hogy a jelszó megfelel-e a kötelező szabálynak.
 * @param {string} pw
 * @returns {{ ok: boolean, err?: string }}
 */
function validatePassword(pw) {
  const s = String(pw == null ? '' : pw);
  if (s.length < MIN_LEN) return { ok: false, err: POLICY_ERR };
  if (!/[a-z]/.test(s))    return { ok: false, err: POLICY_ERR };
  if (!/[A-Z]/.test(s))    return { ok: false, err: POLICY_ERR };
  if (!/[0-9]/.test(s))    return { ok: false, err: POLICY_ERR };
  if (!/[^A-Za-z0-9]/.test(s)) return { ok: false, err: POLICY_ERR };
  return { ok: true };
}

module.exports = { validatePassword, MIN_LEN, POLICY_ERR };
