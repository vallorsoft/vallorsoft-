// ============================================================
//  PDF munkatér — pdfWorkspaceUpload/List/Get/SaveSigned/Delete
//  + sigAssetsGet/sigAssetsSave (aláírás + pecsét SZEPARÁLT tárolás).
//  ------------------------------------------------------------
//  A signature-stamp-workspace.sql migráció tábláival mock-DB felett.
// ============================================================
jest.mock('../../db', () => require('../helpers/db-mock').pool);

const request = require('supertest');
const express = require('express');
const { pool, rows, reset } = require('../helpers/db-mock');
const { setUser, sessionMiddleware, fixtures } = require('../helpers/session-mock');

const app = express();
app.use(express.json({ limit: '32mb' }));
app.use(sessionMiddleware);
app.use(require('../../routes/execute'));

function call(fn, args) {
  return request(app).post('/api/execute').send({ functionName: fn, arguments: args });
}

const CID = 1;
const ADMIN = { ...fixtures.admin, company_id: CID };
const MANAGER = { ...fixtures.manager, company_id: CID };
const SOFER = { ...fixtures.sofer, company_id: CID };

const PDF_B64 = 'data:application/pdf;base64,JVBERi0xLjQKJcTl8uXrp/Og0MTGCg==';

beforeEach(() => reset());

// ─── sigAssetsGet / sigAssetsSave ─────────────────────────────
describe('sigAssetsGet / sigAssetsSave — szeparált aláírás + pecsét', () => {
  test('sigAssetsGet: nincs sor → null/null', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('sigAssetsGet', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.signature).toBeNull();
    expect(res.body.result.stamp).toBeNull();
  });

  test('sigAssetsGet: külön mezőket ad vissza', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ signature_base64: 'SIG', stamp_base64: 'STAMP', base64_png: 'LEGACY' }]));
    const res = await call('sigAssetsGet', []);
    expect(res.body.result.signature).toBe('SIG');
    expect(res.body.result.stamp).toBe('STAMP');
  });

  test('sigAssetsGet: legacy base64_png fallback pecsétként', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ signature_base64: null, stamp_base64: null, base64_png: 'LEGACY_STAMP' }]));
    const res = await call('sigAssetsGet', []);
    expect(res.body.result.stamp).toBe('LEGACY_STAMP');
    expect(res.body.result.signature).toBeNull();
  });

  test('sigAssetsSave: nem-hitelesített hívás — requireLogin 401', async () => {
    setUser(null);
    const res = await call('sigAssetsSave', [{ signature: 'X' }]);
    expect(res.status).toBe(401);
  });

  test('sigAssetsSave: üres payload → hiba', async () => {
    setUser(ADMIN);
    const res = await call('sigAssetsSave', [{}]);
    expect(res.body.result.ok).toBe(false);
  });

  test('sigAssetsSave: csak aláírás mentése — a stamp mezőket NEM írja', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce({ rowCount: 1 }); // INSERT ON CONFLICT DO NOTHING
    pool.query.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE
    const res = await call('sigAssetsSave', [{ signature: 'data:image/png;base64,AAA' }]);
    expect(res.body.result.ok).toBe(true);
    const updateCall = pool.query.mock.calls[1][0];
    expect(updateCall).toMatch(/signature_base64/);
    expect(updateCall).not.toMatch(/stamp_base64/);
    expect(updateCall).not.toMatch(/base64_png/);
  });

  test('sigAssetsSave: csak pecsét mentése — a legacy base64_png-t is szinkronban tartja', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    const res = await call('sigAssetsSave', [{ stamp: 'data:image/png;base64,BBB' }]);
    expect(res.body.result.ok).toBe(true);
    const updateCall = pool.query.mock.calls[1][0];
    expect(updateCall).toMatch(/stamp_base64/);
    expect(updateCall).toMatch(/base64_png/);
    expect(updateCall).not.toMatch(/signature_base64/);
  });

  test('sigAssetsSave: EGYIDŐBEN menti az aláírást ÉS a pecsétet', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    const res = await call('sigAssetsSave', [{ signature: 'data:image/png;base64,AAA', stamp: 'data:image/png;base64,BBB' }]);
    expect(res.body.result.ok).toBe(true);
    const updateCall = pool.query.mock.calls[1][0];
    expect(updateCall).toMatch(/signature_base64/);
    expect(updateCall).toMatch(/stamp_base64/);
    expect(updateCall).toMatch(/base64_png/);
  });

  test('sigAssetsSave: túl nagy kép → hiba', async () => {
    setUser(ADMIN);
    const huge = 'x'.repeat(2000000);
    const res = await call('sigAssetsSave', [{ signature: huge }]);
    expect(res.body.result.ok).toBe(false);
  });
});

// ─── pdfWorkspace ─────────────────────────────────────────────
describe('pdfWorkspaceUpload — feltöltés + validáció', () => {
  test('Sofer szerep tiltva', async () => {
    setUser(SOFER);
    const res = await call('pdfWorkspaceUpload', [{ file_name: 'a.pdf', base64: PDF_B64 }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/interzis/i);
  });

  test('Admin: sikeres upload', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    const res = await call('pdfWorkspaceUpload', [{ file_name: 'test.pdf', base64: PDF_B64 }]);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.id).toMatch(/^WSP-/);
    expect(res.body.result.file_name).toBe('test.pdf');
  });

  test('Manager: sikeres upload', async () => {
    setUser(MANAGER);
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    const res = await call('pdfWorkspaceUpload', [{ file_name: 'm.pdf', base64: PDF_B64 }]);
    expect(res.body.result.ok).toBe(true);
  });

  test('Nem-PDF elutasít', async () => {
    setUser(ADMIN);
    const res = await call('pdfWorkspaceUpload', [{ file_name: 'k.png', base64: 'data:image/png;base64,AAA' }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/PDF/);
  });

  test('Túl nagy fájl elutasít (16 MB base64)', async () => {
    setUser(ADMIN);
    // Épp a 15 MB szerver-korlát fölé — a JSON body-parser 20 MB-je nem áll az útjába.
    const huge = 'data:application/pdf;base64,' + 'A'.repeat(16 * 1024 * 1024);
    const res = await call('pdfWorkspaceUpload', [{ file_name: 'big.pdf', base64: huge }]);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/max 15 MB/i);
  });

  test('Nyers base64 → data URL-lé normalizálva', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    const rawB64 = 'JVBERi0xLjQK';
    const res = await call('pdfWorkspaceUpload', [{ file_name: 'r.pdf', base64: rawB64 }]);
    // Az eredmény akkor ok, ha most már data:application/pdf-nek látja
    expect(res.body.result.ok).toBe(true);
    // A tárolt érték a query args[4]-ben van (original_base64)
    const insertArgs = pool.query.mock.calls[0][1];
    expect(insertArgs[4]).toMatch(/^data:application\/pdf;/);
  });
});

describe('pdfWorkspaceList — csak SAJÁT user + 24h ablak', () => {
  test('Admin listája — csak a user_email + company_id sorai', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([
      { id: 'WSP-A', file_name: 'a.pdf', file_size: 100, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), has_signed: false }
    ]));
    const res = await call('pdfWorkspaceList', []);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.docs.length).toBe(1);
    const q = pool.query.mock.calls[0];
    expect(q[0]).toMatch(/user_email = \$1 AND company_id = \$2/);
    expect(q[0]).toMatch(/INTERVAL '24 hours'/);
    expect(q[1]).toEqual([ADMIN.email, CID]);
  });

  test('Sofer szerep tiltva', async () => {
    setUser(SOFER);
    const res = await call('pdfWorkspaceList', []);
    expect(res.body.result.ok).toBe(false);
  });
});

describe('pdfWorkspaceGet — csak saját dokumentum', () => {
  test('Sofer tiltva', async () => {
    setUser(SOFER);
    const res = await call('pdfWorkspaceGet', ['WSP-A', 'original']);
    expect(res.body.result.ok).toBe(false);
  });

  test('Idegen (nem saját email/company) — nem található', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('pdfWorkspaceGet', ['WSP-A', 'original']);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.err).toMatch(/gasit/i);
  });

  test('Eredeti letöltés', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ file_name: 'a.pdf', original_base64: PDF_B64, signed_base64: null }]));
    const res = await call('pdfWorkspaceGet', ['WSP-A', 'original']);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.result.base64).toBe(PDF_B64);
    expect(res.body.result.fileName).toBe('a.pdf');
  });

  test('Aláírt letöltés — ha még nincs → hiba', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ file_name: 'a.pdf', original_base64: PDF_B64, signed_base64: null }]));
    const res = await call('pdfWorkspaceGet', ['WSP-A', 'signed']);
    expect(res.body.result.ok).toBe(false);
  });
});

describe('pdfWorkspaceSaveSigned — csak saját dokumentum', () => {
  test('Sofer tiltva', async () => {
    setUser(SOFER);
    const res = await call('pdfWorkspaceSaveSigned', ['WSP-A', PDF_B64]);
    expect(res.body.result.ok).toBe(false);
  });

  test('Idegen dokumentum → nem található', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('pdfWorkspaceSaveSigned', ['WSP-X', PDF_B64]);
    expect(res.body.result.ok).toBe(false);
  });

  test('Sikeres mentés — cross-tenant WHERE user_email + company_id', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ id: 'WSP-A' }]));
    const res = await call('pdfWorkspaceSaveSigned', ['WSP-A', PDF_B64]);
    expect(res.body.result.ok).toBe(true);
    const q = pool.query.mock.calls[0];
    expect(q[0]).toMatch(/UPDATE pdf_workspace_docs/);
    expect(q[0]).toMatch(/WHERE id = \$2 AND user_email = \$3 AND company_id = \$4/);
    expect(q[1][2]).toBe(ADMIN.email);
    expect(q[1][3]).toBe(CID);
  });
});

describe('pdfWorkspaceDelete — csak saját dokumentum', () => {
  test('Sofer tiltva', async () => {
    setUser(SOFER);
    const res = await call('pdfWorkspaceDelete', ['WSP-A']);
    expect(res.body.result.ok).toBe(false);
  });

  test('Sikeres törlés — user_email + company_id szűréssel', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([{ id: 'WSP-A' }]));
    const res = await call('pdfWorkspaceDelete', ['WSP-A']);
    expect(res.body.result.ok).toBe(true);
    const q = pool.query.mock.calls[0];
    expect(q[0]).toMatch(/DELETE FROM pdf_workspace_docs/);
    expect(q[0]).toMatch(/WHERE id = \$1 AND user_email = \$2 AND company_id = \$3/);
  });

  test('Nem létező sor → hiba', async () => {
    setUser(ADMIN);
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await call('pdfWorkspaceDelete', ['WSP-A']);
    expect(res.body.result.ok).toBe(false);
  });
});
