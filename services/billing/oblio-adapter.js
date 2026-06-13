// services/billing/oblio-adapter.js
// Oblio (https://www.oblio.eu/api). OAuth2 client_credentials: email + secret -> access_token.
// Mezők: email, secret, company_vat_code.
const { jsonT } = require('./http');

const BASE = 'https://www.oblio.eu/api';

class OblioAdapter {
  constructor(creds) { this.c = creds || {}; }

  async _token() {
    const body = new URLSearchParams({ client_id: this.c.email || '', client_secret: this.c.secret || '', grant_type: 'client_credentials' });
    const r = await jsonT(BASE + '/authorize/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: body.toString(),
    });
    if (!r.ok || !r.data || !r.data.access_token) {
      const msg = (r.data && (r.data.error_description || r.data.message)) || ('autentificare eșuată (' + r.status + ')');
      const e = new Error(msg); e.status = r.status; throw e;
    }
    return r.data.access_token;
  }

  async testConnection() {
    if (!this.c.email || !this.c.secret || !this.c.company_vat_code) {
      return { ok: false, message: 'Lipsește email / secret / CUI.' };
    }
    try {
      await this._token();
      return { ok: true, message: 'Conexiune Oblio reușită.' };
    } catch (e) {
      if (e.status === 429) return { ok: false, message: 'Limita API Oblio atinsă — încearcă mai târziu.' };
      return { ok: false, message: 'Eroare Oblio: ' + e.message };
    }
  }

  async createInvoice(d) {
    try {
      const token = await this._token();
      const body = {
        cif: this.c.company_vat_code,
        client: {
          cif: d.client && d.client.vat_code, name: d.client && d.client.name,
          address: d.client && d.client.address, email: d.client && d.client.email,
        },
        issueDate: d.issue_date, dueDate: d.due_date, currency: d.currency || 'RON', mentions: d.notes || '',
        products: (d.items || []).map((it) => ({
          name: it.name, measuringUnit: it.unit || 'buc', quantity: it.quantity,
          price: it.price_net, vatPercentage: it.vat_percent, vatIncluded: false, currency: d.currency || 'RON',
        })),
      };
      const r = await jsonT(BASE + '/docs/invoice', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body),
      });
      if (r.status === 429) return { ok: false, message: 'Limita API Oblio atinsă.' };
      if (!r.ok || (r.data && r.data.status && r.data.status >= 400)) {
        return { ok: false, message: (r.data && (r.data.statusMessage || r.data.message)) || ('Eroare Oblio (' + r.status + ')') };
      }
      const dt = (r.data && r.data.data) || r.data || {};
      return { ok: true, serie: dt.seriesName || null, numar: dt.number || null, invoice_number: (dt.seriesName || '') + (dt.number || ''), pdf_url: dt.link || null, raw: r.data };
    } catch (e) { return { ok: false, message: 'Eroare Oblio: ' + e.message }; }
  }

  async getInvoice(invoice_number) {
    return { ok: false, message: 'Interogarea facturii Oblio necesită parametrii serie+număr.' };
  }
}

module.exports = OblioAdapter;
