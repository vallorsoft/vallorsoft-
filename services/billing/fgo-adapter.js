// services/billing/fgo-adapter.js
// FGO adapter az univerzális billing-keretrendszerhez.
// A meglévő services/fgo.js-re épül. Mezők (a UI szerint): api_key, environment.
// Megj.: a teljes FGO kiállításhoz CodUnic + PrivateKey is kell — ha a credentials
// tartalmazza ezeket, a kiállítás él; egyébként presence-check szintű.
const fgo = require('../fgo');

class FgoAdapter {
  constructor(creds) { this.c = creds || {}; }

  // a belső fgo.js creds-modellje
  _fgoCreds() {
    return {
      CodUnic: this.c.CodUnic || this.c.cod_unic || null,
      PrivateKey: this.c.PrivateKey || this.c.api_key || null,
      PlatformaUrl: this.c.PlatformaUrl || this.c.platforma_url || '',
      environment: this.c.environment === 'production' ? 'production' : 'test',
    };
  }

  async testConnection() {
    if (!this.c.api_key) return { ok: false, message: 'Hiányzó API kulcs.' };
    return { ok: true, message: 'FGO adatok rögzítve (a tényleges ellenőrzés az első kiállításnál történik).' };
  }

  async createInvoice(d) {
    const creds = this._fgoCreds();
    if (!creds.CodUnic || !creds.PrivateKey) {
      return { ok: false, message: 'Az FGO számlakiállításhoz CodUnic és PrivateKey is szükséges.' };
    }
    try {
      const invoice = {
        currency: d.currency || 'RON',
        issueDate: d.issue_date, dueDate: d.due_date, notes: d.notes,
        client: {
          name: d.client && d.client.name, cui: d.client && d.client.vat_code,
          address: d.client && d.client.address, email: d.client && d.client.email, type: 'PJ', country: 'RO',
        },
        lines: (d.items || []).map((it) => ({
          name: it.name, description: it.description || undefined, unit: it.unit || 'BUC', qty: it.quantity, unitPrice: it.price_net, vatRate: it.vat_percent,
        })),
      };
      const r = await fgo.emit(creds, invoice);
      if (!r.ok) return { ok: false, message: r.message };
      return { ok: true, invoice_number: (r.serie || '') + (r.numar || ''), pdf_url: r.pdf_link || null, raw: r.raw };
    } catch (e) { return { ok: false, message: 'FGO hiba: ' + e.message }; }
  }

  async getInvoice(invoice_number) {
    const creds = this._fgoCreds();
    try {
      const r = await fgo.getStatus(creds, { numar: invoice_number });
      if (!r.ok) return { ok: false, message: r.message };
      return { ok: true, invoice: r };
    } catch (e) { return { ok: false, message: e.message }; }
  }
}

module.exports = FgoAdapter;
