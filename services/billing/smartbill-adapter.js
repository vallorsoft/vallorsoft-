// services/billing/smartbill-adapter.js
// SmartBill (https://ws.smartbill.ro/SBORO/api). Auth: HTTP Basic (username:token).
// Mezők: username, token, company_vat_code.
const { jsonT } = require('./http');

const BASE = 'https://ws.smartbill.ro/SBORO/api';

class SmartBillAdapter {
  constructor(creds) { this.c = creds || {}; }

  _auth() {
    const b = Buffer.from((this.c.username || '') + ':' + (this.c.token || '')).toString('base64');
    return { Authorization: 'Basic ' + b, 'Content-Type': 'application/json', Accept: 'application/json' };
  }

  async testConnection() {
    if (!this.c.username || !this.c.token || !this.c.company_vat_code) {
      return { ok: false, message: 'Lipsește numele de utilizator / token / CUI.' };
    }
    try {
      // Sorozatok lekérése = könnyű, hitelesített hívás.
      const url = BASE + '/series?cif=' + encodeURIComponent(this.c.company_vat_code) + '&type=f';
      const r = await jsonT(url, { method: 'GET', headers: this._auth() });
      if (r.status === 401 || r.status === 403) return { ok: false, message: 'Nume de utilizator sau token greșit.' };
      if (r.status === 429) return { ok: false, message: 'Limita API SmartBill atinsă — încearcă mai târziu.' };
      if (!r.ok) return { ok: false, message: (r.data && (r.data.errorText || r.data.message)) || ('Eroare SmartBill (' + r.status + ')') };
      return { ok: true, message: 'Conexiune SmartBill reușită.' };
    } catch (e) { return { ok: false, message: 'SmartBill indisponibil: ' + e.message }; }
  }

  async createInvoice(d) {
    try {
      const body = {
        companyVatCode: this.c.company_vat_code,
        client: {
          name: d.client && d.client.name, vatCode: d.client && d.client.vat_code,
          address: d.client && d.client.address, email: d.client && d.client.email,
          isTaxPayer: !!(d.client && d.client.vat_code), country: 'Romania',
        },
        issueDate: d.issue_date, dueDate: d.due_date,
        currency: d.currency || 'RON', mentions: d.notes || '',
        products: (d.items || []).map((it) => ({
          name: it.name, measuringUnitName: it.unit || 'buc', quantity: it.quantity,
          price: it.price_net, isTaxIncluded: false, taxPercentage: it.vat_percent, currency: d.currency || 'RON',
        })),
      };
      const r = await jsonT(BASE + '/invoice', { method: 'POST', headers: this._auth(), body: JSON.stringify(body) });
      if (r.status === 429) return { ok: false, message: 'Limita API SmartBill atinsă.' };
      if (!r.ok) return { ok: false, message: (r.data && (r.data.errorText || r.data.message)) || ('Eroare SmartBill (' + r.status + ')') };
      return { ok: true, serie: r.data.series || null, numar: r.data.number || null, invoice_number: (r.data.series || '') + (r.data.number || ''), pdf_url: r.data.url || null, raw: r.data };
    } catch (e) { return { ok: false, message: 'Eroare SmartBill: ' + e.message }; }
  }

  async getInvoice(invoice_number) {
    return { ok: false, message: 'Interogarea facturii SmartBill necesită parametrii serie+număr — completează-i în interfață.' };
  }
}

module.exports = SmartBillAdapter;
