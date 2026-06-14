// services/billing/facturis-adapter.js
// Facturis Online (https://api.facturis-online.ro). Mezők: username, api_key, company_cui.
// A nyilvános API-séma korlátozottan dokumentált — a kiállítás payloadja a
// szolgáltatói dokumentáció alapján finomítandó (lásd a megjelölt helyeket).
const { jsonT } = require('./http');

const BASE = 'https://api.facturis-online.ro';

class FacturisAdapter {
  constructor(creds) { this.c = creds || {}; }

  _headers() {
    return {
      'X-Api-Key': this.c.api_key || '',
      'X-Username': this.c.username || '',
      'Content-Type': 'application/json', Accept: 'application/json',
    };
  }

  async testConnection() {
    if (!this.c.username || !this.c.api_key || !this.c.company_cui) {
      return { ok: false, message: 'Lipsește numele de utilizator / cheia API / CUI.' };
    }
    try {
      const r = await jsonT(BASE + '/v1/ping', { method: 'GET', headers: this._headers() }, 10000);
      if (r.status === 401 || r.status === 403) return { ok: false, message: 'Date de autentificare invalide.' };
      if (r.status === 429) return { ok: false, message: 'Limita API Facturis atinsă.' };
      return { ok: true, message: 'Date Facturis salvate.' };
    } catch (e) {
      // BÉTA: a publikus API-séma nem megerősített — lásd ifactura-adapter.
      return { ok: true, unverified: true, message: '⚠️ Facturis (BETA): conexiunea NU poate fi verificată (' + e.message + ') — datele sunt salvate, dar înainte de facturarea reală testarea este obligatorie.' };
    }
  }

  async createInvoice(d) {
    try {
      const body = {
        company_cui: this.c.company_cui,
        client: { name: d.client && d.client.name, cui: d.client && d.client.vat_code, address: d.client && d.client.address, email: d.client && d.client.email },
        issue_date: d.issue_date, due_date: d.due_date, currency: d.currency || 'RON', notes: d.notes || '',
        items: (d.items || []).map((it) => ({ name: it.name, unit: it.unit || 'buc', quantity: it.quantity, price_net: it.price_net, vat_percent: it.vat_percent })),
      };
      const r = await jsonT(BASE + '/v1/invoices', { method: 'POST', headers: this._headers(), body: JSON.stringify(body) });
      if (r.status === 429) return { ok: false, message: 'Limita API Facturis atinsă.' };
      if (!r.ok) return { ok: false, message: (r.data && (r.data.message || r.data.error)) || ('Eroare Facturis (' + r.status + ')') };
      return { ok: true, serie: r.data.series || null, numar: r.data.number || r.data.invoice_number || null, invoice_number: r.data.number || r.data.invoice_number || null, pdf_url: r.data.pdf_url || r.data.url || null, raw: r.data };
    } catch (e) { return { ok: false, message: 'Eroare Facturis: ' + e.message }; }
  }

  async getInvoice(serie, numar) {
    const inv_number = encodeURIComponent((serie || '') + (numar || serie || ''));
    try {
      const r = await jsonT(BASE + '/v1/invoices/' + inv_number, { method: 'GET', headers: this._headers() });
      if (!r.ok) return { ok: false, message: 'Nu a fost găsit (' + r.status + ').' };
      return { ok: true, invoice: r.data, raw: r.data };
    } catch (e) { return { ok: false, message: e.message }; }
  }
}

module.exports = FacturisAdapter;
