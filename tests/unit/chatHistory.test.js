// ============================================================
//  Unit-teszt — lib/chatHistory (beszélgetés-adatbázis + emlékek +
//  AI-kivonat) és handlers/chatHistory (ellenőrző nézet).
//  Mock DB / feature-kapcsoló / AI — nincs hálózat.
// ============================================================
let mockRules = [];
const mockDbQuery = jest.fn(async (sql, params) => {
  for (const r of mockRules) if (r.match.test(sql)) return r.fn ? r.fn(sql, params) : { rows: r.rows || [], rowCount: (r.rows || []).length };
  return { rows: [], rowCount: 0 };
});
jest.mock('../../db', () => ({ query: (...a) => mockDbQuery(...a) }));
let mockFeatureOn = true;
jest.mock('../../lib/featureEnabled', () => ({ featureEnabled: async () => mockFeatureOn }));
const mockAudit = jest.fn(async () => {});
jest.mock('../../lib/audit', () => ({ fromReq: (...a) => mockAudit(...a) }));
const mockExtract = jest.fn();
jest.mock('../../lib/geminiJson', () => ({ extractJson: (...a) => mockExtract(...a) }));

const hist = require('../../lib/chatHistory');
const H = require('../../handlers/chatHistory');

const ADMIN = { id: 1, company_id: 7, pozicio: 'Admin', email: 'a@x.ro' };
const MANAGER = { id: 2, company_id: 7, pozicio: 'Manager', email: 'm@x.ro' };
const SOFER = { id: 3, company_id: 7, pozicio: 'Sofer', email: 's@x.ro' };
const req = (u) => ({ session: { user: u ? Object.assign({}, u) : null }, headers: {}, ip: '1.1.1.1' });
function call(fn, u, args) {
  return new Promise((resolve) => { fn(req(u), { json: (p) => resolve(p.result) }, args); });
}
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => { mockRules = []; mockDbQuery.mockClear(); mockAudit.mockClear(); mockExtract.mockReset(); mockFeatureOn = true; });

describe('AI-kivonat: teljes beszélgetés, dokumentum soha', () => {
  test('mellékszál jelölve, dokumentum-válasz jelölőre cserélve, fájlnév kiszűrve', () => {
    const t = hist.aiTranscript([
      { role: 'user', text: 'Peto hol tart?', local: true },
      { role: 'assistant', text: 'Peto Bicske felé tart.', local: true },
      { role: 'user', text: 'mutasd a dokumentumokat, a cmr_42.pdf-et', local: true },
      { role: 'assistant', text: '📎 cmr_42.pdf · szamla.jpg', local: true, noai: true },
      { role: 'assistant', text: 'és a másik: factura.PDF', local: true, noai: true },
      { role: 'user', text: 'Holnap Arad → Győr FTL' },
    ]);
    expect(t[0]).toEqual({ role: 'user', text: 'Peto hol tart?', side: true });
    expect(t[1].side).toBe(true);
    expect(t[2].text).not.toMatch(/cmr_42/);
    expect(t.filter((m) => m.hidden).length).toBe(1);   // egymás utáni rejtettek → egy jelölő
    expect(t[t.length - 1]).toEqual({ role: 'user', text: 'Holnap Arad → Győr FTL' });
    const lines = t.map((m) => hist.transcriptLine(m)).join('\n');
    expect(lines).not.toMatch(/szamla|factura|cmr_42/i);
    expect(lines).toMatch(/SIDE TOPIC[^\n]*Peto Bicske/);
  });

  test('dokumentum-fajták / tool-ok felismerése', () => {
    expect(hist.isDocKind('doc_upload')).toBe(true);
    expect(hist.isDocKind('order_view')).toBe(true);
    expect(hist.isDocKind('debt')).toBe(false);
    expect(hist.isDocTools(['docs.search'])).toBe(true);
    expect(hist.isDocTools(['ecmr.list'])).toBe(true);
    expect(hist.isDocTools(['order.doc_delete'])).toBe(true);
    expect(hist.isDocTools(['order.list', 'fleet.vehicles'])).toBe(false);
  });

  test('kártya → sima szöveg (gombok/HTML nélkül)', () => {
    const s = hist.cardText('<div class="och-info"><table><tr><td>Ügyfél</td><td>Bilka &amp; Co</td></tr></table><script>x()</script><button onclick="a()">⬇️</button></div>');
    expect(s).toMatch(/Ügyfél · Bilka & Co/);
    expect(s).not.toMatch(/<|onclick|x\(\)/);
  });

  test('kör-sorok: info (noai), vázlat-összegzés, hiba', () => {
    const a = hist.turnRows('kérdés', { ok: true, info: true, reply: 'válasz', info_html: '<b>x</b>', kind: 'doc_upload', noai: true });
    expect(a[1]).toMatchObject({ role: 'assistant', text: 'válasz', card: 'x', kind: 'doc_upload', noai: true });
    const b = hist.turnRows('fuvar', { ok: true, reply: 'Rendben', changes: ['Lerakó: Győr'],
      draft: { client: 'Bilka', stops: [{ kind: 'pickup', loc: 'Arad' }, { kind: 'delivery', loc: 'Győr', data: '2026-10-16' }] } });
    expect(b[1].text).toBe('Rendben\nLerakó: Győr');
    expect(b[1].card).toMatch(/Bilka[\s\S]*Arad[\s\S]*Győr, 2026-10-16/);
    expect(hist.turnRows('x', { ok: false, err: 'baj' })[1]).toMatchObject({ text: '⚠️ baj', kind: 'error' });
  });
});

describe('emlékek', () => {
  test('titok / fájlnév / véletlen token nem lehet emlék', () => {
    expect(hist.cleanMemory('Peti = Pető Imre')).toBe('Peti = Pető Imre');
    expect(hist.cleanMemory('az SMTP jelszó: abc')).toBeNull();
    expect(hist.cleanMemory('parola contului este x')).toBeNull();
    expect(hist.cleanMemory('a CMR a cmr_42.pdf fájlban')).toBeNull();
    expect(hist.cleanMemory('azonosító QWxhZGRpbjpvcGVuIHNlc2FtZTEyMzQ1Ng')).toBeNull();
    expect(hist.cleanMemory('ok')).toBeNull();
  });

  test('cégszintű emlék user_id = 0-ra, személyes a felhasználóra', async () => {
    const ins = [];
    mockRules.push({ match: /INSERT INTO chat_memories/, fn: (sql, p) => { ins.push(p); return { rows: [], rowCount: 1 }; } });
    await hist.putMemory(7, 5, 'A Bilka mindig FTL', { scope: 'company' });
    await hist.putMemory(7, 5, 'Rövid válaszokat kér', { scope: 'user', source: 'explicit' });
    expect(ins[0].slice(0, 2)).toEqual([7, 0]);
    expect(ins[1].slice(0, 2)).toEqual([7, 5]);
    expect(ins[1][4]).toBe('explicit');
  });

  test('felejtés: Manager a cégszintűt csak ha ő vette fel; Admin bármelyiket', async () => {
    const del = [];
    mockRules.push({ match: /DELETE FROM chat_memories WHERE company_id=\$1 AND text_norm LIKE/, fn: (sql, p) => { del.push(p); return { rows: [], rowCount: 1 }; } });
    expect(await hist.forget(req(MANAGER), ['peti'])).toBe(1);
    expect(del[0]).toEqual([7, '%peti%', 2, false]);
    await hist.forget(req(ADMIN), ['bilka']);
    expect(del[1][3]).toBe(true);
  });

  test('kontextus: a mondathoz illő emlék elöl, a korábbi beszélgetések összefoglalója; kikapcsolva üres', async () => {
    mockRules.push({ match: /FROM chat_memories/, rows: [
      { id: 1, user_id: 0, text: 'Az iroda nyitvatartása 8-16', hits: 1, updated_at: new Date() },
      { id: 2, user_id: 2, text: 'Peti = Pető Imre sofőr', hits: 1, updated_at: new Date() },
    ] });
    mockRules.push({ match: /FROM chat_conversations/, rows: [
      { id: 9, summary: 'Ebben a beszélgetésben a 0042-t zártuk.', updated_at: new Date() },
      { id: 4, summary: 'Bilka fuvarokat írtunk ki.', updated_at: new Date('2026-10-10') },
    ] });
    const c = await hist.memoryContext(7, 2, 'Peti hol tart?', 9);
    expect(c.indexOf('Peti = Pető Imre')).toBeLessThan(c.indexOf('nyitvatartása'));
    expect(c).toMatch(/\[company\] Az iroda/);
    expect(c).toMatch(/THIS CONVERSATION EARLIER[^\n]*0042/);
    expect(c).toMatch(/2026-10-10: Bilka/);
    mockFeatureOn = false;
    expect(await hist.memoryContext(7, 2, 'x', 9)).toBe('');
  });
});

describe('tárolás', () => {
  test('saját beszélgetés folytatódik, idegen azonosító helyett új nyílik', async () => {
    mockRules.push({ match: /SELECT id FROM chat_conversations WHERE id=\$1/, fn: (sql, p) => ({ rows: p[0] === 11 && p[2] === 2 ? [{ id: 11 }] : [] }) });
    mockRules.push({ match: /INSERT INTO chat_conversations/, rows: [{ id: 12 }] });
    expect(await hist.ensureConversation(req(MANAGER), 11, 'x')).toBe(11);
    expect(await hist.ensureConversation(req(ADMIN), 11, 'x')).toBe(12);   // más felhasználóé → új
    mockFeatureOn = false;
    expect(await hist.ensureConversation(req(ADMIN), null, 'x')).toBeNull();
  });

  test('wrapRes: a válaszba bekerül a beszélgetés-azonosító, a kör a saját cégre/felhasználóra mentődik', async () => {
    const ins = [];
    mockRules.push({ match: /INSERT INTO chat_messages/, fn: (sql, p) => { ins.push(p); return { rows: [], rowCount: 2 }; } });
    mockRules.push({ match: /UPDATE chat_conversations SET msg_count/, rows: [{ user_msg_count: 3, summarized_count: 0 }] });
    let sent = null;
    const res = hist.wrapRes({ json: (p) => { sent = p; } }, { cid: 7, uid: 2, convId: 12, userText: 'Peto hol tart?' });
    res.json({ result: { ok: true, info: true, reply: 'Bicske felé', info_html: '' } });
    await flush();
    expect(sent.result.conversation_id).toBe(12);
    expect(ins[0].slice(0, 5)).toEqual([12, 7, 2, 'user', 'Peto hol tart?']);
    expect(ins[0].slice(8, 13)).toEqual([12, 7, 2, 'assistant', 'Bicske felé']);
    // Beszélgetés nélkül (kapcsoló KI) a res változatlan.
    const raw = { json: () => {} };
    expect(hist.wrapRes(raw, { convId: null })).toBe(raw);
  });

  test('összefoglaló + emlék-kivonás: dokumentum-rész az AI-hoz nem megy', async () => {
    mockRules.push({ match: /SELECT id, user_msg_count, summarized_count FROM chat_conversations/, rows: [{ id: 12, user_msg_count: 8, summarized_count: 0 }] });
    mockRules.push({ match: /SELECT role, text, noai FROM chat_messages/, rows: [
      { role: 'assistant', text: '📎 szamla_titkos.pdf', noai: true },
      { role: 'user', text: 'Petit hívd Pető Imrének mostantól', noai: false },
    ] });
    const upd = []; const mem = [];
    mockRules.push({ match: /UPDATE chat_conversations SET summary/, fn: (sql, p) => { upd.push(p); return { rows: [], rowCount: 1 }; } });
    mockRules.push({ match: /INSERT INTO chat_memories/, fn: (sql, p) => { mem.push(p); return { rows: [], rowCount: 1 }; } });
    mockExtract.mockResolvedValue({ model: 'm', json: { summary: 'Becenevet egyeztettünk.', memories: [{ text: 'Peti = Pető Imre', scope: 'user' }, { text: 'jelszó: x', scope: 'user' }] } });
    await hist.summarize(7, 2, 12);
    const sentText = mockExtract.mock.calls[0][0].parts[0].text;
    expect(sentText).not.toMatch(/szamla_titkos/);
    expect(sentText).toMatch(/hidden: document-related/);
    expect(upd[0][0]).toBe('Becenevet egyeztettünk.');
    expect(mem.length).toBe(1);
    expect(mem[0][2]).toBe('Peti = Pető Imre');
  });
});

describe('folytatás + vázlat-állapot', () => {
  test('turnState: csak vázlat-/levél-kör, a kérdések és az előnézet nélkül', () => {
    expect(hist.turnState({ ok: true, info: true, reply: 'x' })).toBeUndefined();
    expect(hist.turnState({ ok: false, err: 'x' })).toBeUndefined();
    const st = hist.turnState({ ok: true, mode: 'email', draft: { body: 'b' }, missing: [], ready: true, questions: [{ text: 'q' }], preview_html: '<p>x</p>', attachments_avail: [{ key: 'cmr' }] });
    expect(st).toEqual({ mode: 'email', draft: { body: 'b' }, missing: [], ready: true, attachments_avail: [{ key: 'cmr' }] });
  });

  test('wrapRes a vázlat-állapotot is menti; a mentés-jegyzet törli', async () => {
    const upd = [];
    mockRules.push({ match: /INSERT INTO chat_messages/, rows: [] });
    mockRules.push({ match: /UPDATE chat_conversations SET msg_count/, fn: (sql, p) => { upd.push({ sql, p }); return { rows: [{ user_msg_count: 1, summarized_count: 0 }] }; } });
    mockRules.push({ match: /SELECT id FROM chat_conversations WHERE id=\$1/, rows: [{ id: 12 }] });
    const res = hist.wrapRes({ json: () => {} }, { cid: 7, uid: 2, convId: 12, userText: 'Arad → Győr' });
    res.json({ result: { ok: true, reply: 'ok', draft: { client: 'Bilka', stops: [] }, missing: ['load_type'], ready: false } });
    await flush();
    expect(upd[0].sql).toMatch(/state = \$5::jsonb/);
    expect(JSON.parse(upd[0].p[4])).toMatchObject({ draft: { client: 'Bilka' }, missing: ['load_type'] });
    // info-válasz nem írja felül a vázlatot
    res.json({ result: { ok: true, info: true, reply: 'Peto Bicske felé' } });
    await flush();
    expect(upd[1].sql).not.toMatch(/state =/);
    // mentés után a vázlat törlődik
    await hist.note(req(MANAGER), 12, '✅ CMD-2026-0042', 'saved', { clearState: true });
    expect(upd[2].sql).toMatch(/state = \$5::jsonb/);
    expect(upd[2].p[4]).toBeNull();
  });

  test('resume: csak a saját beszélgetés; a mellékszál-jelölés a tárolt fajtából', async () => {
    let params = null;
    mockRules.push({ match: /SELECT id, title, state, updated_at FROM chat_conversations WHERE id=\$1/, fn: (sql, p) => { params = p; return { rows: p[2] === 2 ? [{ id: 12, title: 'T', state: { mode: null, draft: { client: 'Bilka' } } }] : [] }; } });
    mockRules.push({ match: /SELECT role, text, card_text, kind, noai FROM chat_messages/, rows: [
      { role: 'assistant', text: 'Rendben', card_text: '🏢 Bilka', kind: 'draft' },
      { role: 'user', text: 'holnap Arad → Győr' },
      { role: 'assistant', text: '📎 dok', card_text: 'cmr.pdf', kind: 'order_view', noai: true },
      { role: 'user', text: 'és a dokumentumai?' },
    ] });  // (DESC sorrendben jön vissza)
    expect(await hist.resume(7, 3, 12)).toBeNull();          // más felhasználó → nincs
    const r = await hist.resume(7, 2, 12);
    expect(params).toEqual([12, 7, 2]);
    expect(r.messages.map((m) => [m.role, m.local, m.noai])).toEqual([
      ['user', true, false], ['assistant', true, true], ['user', false, false], ['assistant', false, false],
    ]);
    expect(r.messages[1].card).toBe('cmr.pdf');
    expect(r.messages[3].card).toBe('');                      // vázlat-kör: a kártya csak az ellenőrző nézetben
    expect(r.state.draft.client).toBe('Bilka');
    mockFeatureOn = false;
    expect(await hist.resume(7, 2, 12)).toBeNull();
  });
});

describe('handlers/chatHistory — ellenőrző nézet', () => {
  test('Sofőr / kijelentkezett tiltva; kikapcsolt funkció → hiba', async () => {
    expect((await call(H.chatHistoryList, SOFER, [{}])).ok).toBe(false);
    expect((await call(H.chatHistoryList, null, [{}])).ok).toBe(false);
    mockFeatureOn = false;
    expect((await call(H.chatHistoryList, ADMIN, [{}])).ok).toBe(false);
  });

  test('Manager csak a sajátját listázza (a kért user_id-t figyelmen kívül hagyja)', async () => {
    let params = null;
    mockRules.push({ match: /FROM chat_conversations c\s+LEFT JOIN users/, fn: (sql, p) => { params = p; return { rows: [] }; } });
    const r = await call(H.chatHistoryList, MANAGER, [{ user_id: 99 }]);
    expect(r.ok).toBe(true);
    expect(r.is_admin).toBe(false);
    expect(params.slice(0, 2)).toEqual([7, 2]);
    expect(r.users).toEqual([]);
  });

  test('Admin szűrhet bármely felhasználóra + szövegre + dátumra; a törölt felhasználó is a mentett nevével', async () => {
    let params = null; let sql = '';
    mockRules.push({ match: /FROM chat_conversations c\s+LEFT JOIN users u ON u\.id = c\.user_id AND u\.company_id = c\.company_id\s+WHERE c\.company_id = \$1\s+AND/, fn: (q, p) => { sql = q; params = p; return { rows: [{ id: 5, user_id: 2, title: 't', msg_count: 4, user_name: 'Mana', user_deleted: true }] }; } });
    mockRules.push({ match: /GROUP BY c\.user_id/, rows: [{ id: 2, nume: 'Mana', deleted: true }] });
    const r = await call(H.chatHistoryList, ADMIN, [{ user_id: 2, q: 'Bilka%', from: '2026-10-01', to: 'rossz' }]);
    expect(params.slice(0, 5)).toEqual([7, 2, '%Bilka %', '2026-10-01', null]);
    expect(sql).toMatch(/AT TIME ZONE 'Europe\/Bucharest'/);
    expect(r.rows[0]).toMatchObject({ id: 5, user_name: 'Mana', own: false, user_deleted: true });
    expect(r.users).toEqual([{ id: 2, nume: 'Mana', deleted: true }]);
  });

  test('más felhasználó beszélgetése: Manager nem nyithatja meg, Admin igen (audit-naplózva)', async () => {
    mockRules.push({ match: /FROM chat_conversations c LEFT JOIN users/, fn: (sql, p) => ({ rows: p[1] === 7 && p[0] === 5 ? [{ id: 5, user_id: 9, title: 't', user_name: 'X' }] : [] }) });
    mockRules.push({ match: /FROM chat_messages/, rows: [{ id: 1, role: 'user', text: 'szia', noai: false }] });
    const m = await call(H.chatHistoryGet, MANAGER, [{ id: 5 }]);
    expect(m.ok).toBe(false);
    const a = await call(H.chatHistoryGet, ADMIN, [{ id: 5 }]);
    expect(a.ok).toBe(true);
    expect(a.messages[0].text).toBe('szia');
    expect(mockAudit).toHaveBeenCalledWith(expect.anything(), 'chat.history_view', 'chat_conversation', '5', { owner: 9 });
  });

  test('törlés csak Admin, cégre szűrve', async () => {
    expect((await call(H.chatHistoryDelete, MANAGER, [{ id: 5 }])).ok).toBe(false);
    let p0 = null;
    mockRules.push({ match: /DELETE FROM chat_conversations WHERE id = \$1 AND company_id = \$2/, fn: (sql, p) => { p0 = p; return { rows: [{ user_id: 9 }], rowCount: 1 }; } });
    expect((await call(H.chatHistoryDelete, ADMIN, [{ id: 5 }])).ok).toBe(true);
    expect(p0).toEqual([5, 7]);
  });
});

describe('felhasználó törlése', () => {
  test('a törölt felhasználó személyes emlékei törlődnek (cégre szűrve), a beszélgetései megmaradnak', async () => {
    const U = require('../../handlers/users');
    const del = [];
    mockRules.push({ match: /SELECT id, pozicio, company_id FROM users WHERE email/, rows: [{ id: 9, pozicio: 'Manager', company_id: 7 }] });
    mockRules.push({ match: /DELETE FROM users/, rows: [{}] });
    mockRules.push({ match: /DELETE FROM chat_/, fn: (sql, p) => { del.push({ sql, p }); return { rows: [], rowCount: 1 }; } });
    const r = await call(U.userDelete, ADMIN, ['mana@x.ro']);
    expect(r.ok).toBe(true);
    expect(del.map((d) => d.sql.trim())).toEqual(['DELETE FROM chat_memories WHERE company_id = $1 AND user_id = $2']);
    expect(del[0].p).toEqual([7, 9]);
  });
});
