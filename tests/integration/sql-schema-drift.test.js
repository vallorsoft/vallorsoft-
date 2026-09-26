// ============================================================
//  VALÓDI DB — SQL séma-drift őr
//  A szerveroldali kód (handlers/routes/services/lib/middleware) MINDEN
//  statikus SQL-szövegét a teljes (schema.sql + db/*.sql) sémán PREPARE-rel
//  típus-ellenőrzi — végrehajtás nélkül. Így kiderül, ha egy lekérdezés NEM
//  létező oszlopra/táblára hivatkozik, vagy típus-ütközés van benne.
//
//  Ez a hibaosztály korábban többször élesben derült ki, mert a try/catch
//  „Eroare de server"-rel vagy üres listával elnyelte (pl. carriers.denumire,
//  client_users.client_nev, subscription_plans.billing_interval,
//  order_ecmr.order_id INTEGER vs orders.id VARCHAR, users.reset_token).
//
//  A dinamikusan összefűzött (${…} / + változó) SQL-eket kihagyjuk; a
//  „could not determine data type" (paraméter-típus) hibák nem számítanak.
//  Csak DATABASE_URL mellett fut (CI Postgres service); enélkül skip.
// ============================================================
const fs = require('fs');
const path = require('path');
const { loadSchema, hasDb } = require('../helpers/real-db');

const ROOT = path.join(__dirname, '..', '..');

// Ismert hamis pozitívak: SQL-töredékek, amiket a kód később egészít ki.
const ALLOW = new Set([
  'handlers/orderAssignment.js|syntax error at end of input',
]);

function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
}

// Statikus SQL-szövegek kigyűjtése (egymás mellé +-szal fűzött literálokat
// összevonva; ha a literál változóval is össze van fűzve → kihagyjuk).
function extractSql() {
  const files = ['handlers', 'routes', 'services', 'lib', 'middleware']
    .flatMap((d) => walk(path.join(ROOT, d)))
    .filter((f) => f.endsWith('.js'));
  const out = [];
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    const re = /(`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")/g;
    const toks = [];
    let m;
    while ((m = re.exec(s))) toks.push({ t: m[0], i: m.index, e: re.lastIndex });
    for (let k = 0; k < toks.length; k++) {
      let body = toks[k].t.slice(1, -1);
      let dyn = toks[k].t[0] === '`' && /\$\{/.test(body);
      let j = k;
      while (j + 1 < toks.length && /^\s*\+\s*$/.test(s.slice(toks[j].e, toks[j + 1].i))) {
        j++;
        const b = toks[j].t.slice(1, -1);
        if (toks[j].t[0] === '`' && /\$\{/.test(b)) dyn = true;
        body += b;
      }
      const partial = /^\s*\+/.test(s.slice(toks[j].e, toks[j].e + 20)) ||
                      /\+\s*$/.test(s.slice(Math.max(0, toks[k].i - 20), toks[k].i));
      if (!dyn && !partial &&
          /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(body) &&
          /\b(FROM|INTO|SET|TABLE)\b/i.test(body)) {
        out.push({
          file: path.relative(ROOT, f),
          line: s.slice(0, toks[k].i).split('\n').length,
          sql: body.replace(/\\n/g, '\n'),
        });
      }
      k = j;
    }
  }
  return out;
}

const d = hasDb() ? describe : describe.skip;

d('SQL séma-drift őr (valódi DB)', () => {
  jest.setTimeout(120000);
  const pool = require('../../db');

  beforeAll(async () => {
    await loadSchema(pool);
    // A szerver migráció-futtatója hozza létre (a server.js-ben) — itt pótoljuk.
    await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMP DEFAULT NOW())');
  });
  afterAll(async () => { await pool.end(); });

  test('minden statikus SQL érvényes a teljes sémán', async () => {
    const sqls = extractSql();
    expect(sqls.length).toBeGreaterThan(500);
    const client = await pool.connect();
    const bad = [];
    try {
      for (const q of sqls) {
        try {
          await client.query('PREPARE _drift_chk AS ' + q.sql);
          await client.query('DEALLOCATE _drift_chk');
        } catch (e) {
          if (/could not determine data type|inconsistent types deduced/.test(e.message)) continue;
          if (ALLOW.has(q.file + '|' + e.message)) continue;
          bad.push(q.file + ':' + q.line + '  ' + e.message);
        }
      }
    } finally {
      client.release();
    }
    expect(bad).toEqual([]);
  });
});
