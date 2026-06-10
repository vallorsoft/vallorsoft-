// services/billing/ifactura-adapter.js
// iFactura (https://api.ifactura.ro). Mezők: api_key, company_id.
// A nyilvános API-séma korlátozottan dokumentált — a kiállítás payloadja a
// szolgáltatói dokumentáció alapján finomítandó (lásd a megjelölt helyeket).
const { jsonT } = require('./http');

const BASE = 'https://api.ifactura.ro';

class IFacturaAdapter {
  constructor(creds) { this.c = creds || {}; }

  _headers() {
    return { Authorization: 'Bearer ' + (this.c.api_key || ''), 'Content-Type': 'application/json', Accept: 'application/json' };
  }

  async testConnection() {
    if (!this.c.api_key || !this.c.company_id) return { ok: false, message: 'Hiányzó API kulcs / cég azonosító.' };
    try {
      // Könnyű, hitelesített próbahívás; ha a végpont nem így viselkedik, a creds akkor is rögzül.
      const r = await jsonT(BASE + '/v1/companies/' + encodeURIComponent(this.c.company_id), { method: 'GET', headers: this._headers() }, 10000);
      if (r.status === 401 || r.status === 403) return { ok: false, message: 'Érvénytelen API kulcs.' };
      if (r.status === 429) return { ok: false, message: 'iFactura API limit elérve.' };
      return { ok: true, message: 'iFactura adatok rögzítve.' };
    } catch (e) {
      // BÉTA: a publikus API-séma nem megerősített — a hibát nem rejtjük el,
      // de jelezzük, hogy az adatok rögzíthetők (unverified flaggel).
      return { ok: true, unverified: true, message: '⚠️ iFactura (BÉTA): a kapcsolat NEM ellenőrizhető (' + e.message + ') — az adatok rögzítve, de éles számlázás előtt kötelező a tesztelés.' };
    }
  }

  async createInvoice(d) {
    try {
      const body = {
        company_id: this.c.company_id,
        client: { name: d.client && d.client.name, vat_code: d.client && d.client.vat_code, address: d.client && d.client.address, email: d.client && d.client.email },
        issue_date: d.issue_date, due_date: d.due_date, currency: d.currency || 'RON', notes: d.notes || '',
        items: (d.items || []).map((it) => ({ name: it.name, unit: it.unit || 'buc', quantity: it.quantity, price_net: it.price_net, vat_percent: it.vat_percent })),
      };
      const r = await jsonT(BASE + '/v1/invoices', { method: 'POST', headers: this._headers(), body: JSON.stringify(body) });
      if (r.status === 429) return { ok: false, message: 'iFactura API limit elérve.' };
      if (!r.ok) return { ok: false, message: (r.data && (r.data.message || r.data.error)) || ('iFactura hiba (' + r.status + ')') };
      return { ok: true, invoice_number: r.data.number || r.data.invoice_number || null, pdf_url: r.data.pdf_url || r.data.url || null, raw: r.data };
    } catch (e) { return { ok: false, message: 'iFactura hiba: ' + e.message }; }
  }

  async getInvoice(invoice_number) {
    try {
      const r = await jsonT(BASE + '/v1/invoices/' + encodeURIComponent(invoice_number), { method: 'GET', headers: this._headers() });
      if (!r.ok) return { ok: false, message: 'Nem található (' + r.status + ').' };
      return { ok: true, invoice: r.data };
    } catch (e) { return { ok: false, message: e.message }; }
  }
}

module.exports = IFacturaAdapter;
