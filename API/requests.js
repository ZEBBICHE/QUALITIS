// Demandes d'analyse : dépôt (public ou connecté), suivi client, suivi par référence + email.
const crypto = require('crypto');
const L = require('./_lib');

module.exports = async (req, res) => {
  if (!L.configured()) return L.send(res, 503, { error: 'not_configured', missing: L.missing() });
  try {
    const action = L.actionOf(req);

    if (req.method === 'POST' && !action) {
      if (!(await L.rateLimit('req:' + L.ipOf(req), 20, 3600))) return L.send(res, 429, { error: 'too_many' });
      const body = await L.readBody(req);
      if (body.website) return L.send(res, 200, { ok: true }); // piège anti-robot
      const d = body.data || {};
      const data = {
        name: L.clean(d.name, 200), company: L.clean(d.company, 200), phone: L.clean(d.phone, 40),
        email: L.clean(d.email, 200).toLowerCase(), message: L.clean(d.message, 3000),
        nature: (Array.isArray(d.nature) ? d.nature : []).slice(0, 10).map((x) => L.clean(x, 40)).filter(Boolean)
      };
      for (const k of ['name', 'phone', 'email', 'message']) if (!data[k]) return L.send(res, 400, { error: 'missing', field: k });
      if (!data.nature.length) return L.send(res, 400, { error: 'missing', field: 'nature' });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) return L.send(res, 400, { error: 'missing', field: 'email' });
      const p = L.authAs(req, 'client');
      const now = new Date().toISOString();
      const id = Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
      const ref = await L.nextRef();
      const item = { id, ref, type: 'analysis', userEmail: p ? p.sub : null, createdAt: now, updatedAt: now, stage: 0, history: [{ stage: 0, at: now, note: '' }], data };
      await L.requests.set(id, item);
      return L.send(res, 200, { ok: true, ref });
    }

    if (action === 'mine' && req.method === 'GET') {
      const p = L.authAs(req, 'client');
      if (!p) return L.send(res, 401, { error: 'unauthorized' });
      const items = (await L.requests.all()).filter((r) => r.userEmail === p.sub || (r.data.email === p.sub))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(L.clientView);
      return L.send(res, 200, { items });
    }

    if (action === 'track' && req.method === 'GET') {
      if (!(await L.rateLimit('track:' + L.ipOf(req), 30, 900))) return L.send(res, 429, { error: 'too_many' });
      const ref = L.param(req, 'ref').trim().toUpperCase(), email = L.param(req, 'email').trim().toLowerCase();
      const r = ref && email && (await L.requests.all()).find((x) => x.ref === ref && x.data.email === email);
      if (!r) return L.send(res, 404, { error: 'not_found' });
      return L.send(res, 200, { item: L.clientView(r) });
    }
    return L.send(res, 400, { error: 'action' });
  } catch (e) {
    return L.send(res, 500, { error: 'server' });
  }
};
