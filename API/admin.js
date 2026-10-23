// Administration : connexion, liste des demandes et des comptes, avancement, suppression.
const L = require('./_lib');

module.exports = async (req, res) => {
  if (!L.configured()) return L.send(res, 503, { error: 'not_configured', missing: L.missing() });
  try {
    const action = L.actionOf(req);

    if (action === 'login' && req.method === 'POST') {
      if (!(await L.rateLimit('admin:' + L.ipOf(req), 5, 900))) return L.send(res, 429, { error: 'too_many' });
      const { password } = await L.readBody(req);
      if (!password || !L.safeEqual(password, process.env.ADMIN_PASSWORD)) return L.send(res, 401, { error: 'bad_password' });
      return L.send(res, 200, { token: L.sign({ role: 'admin', exp: Date.now() + 8 * 3600e3 }) });
    }

    if (!L.authAs(req, 'admin')) return L.send(res, 401, { error: 'unauthorized' });

    if (action === 'list' && req.method === 'GET') {
      const requests = (await L.requests.all()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const users = (await L.users.all()).map(L.publicUser).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return L.send(res, 200, { requests, users, stages: L.STAGES });
    }
    if (action === 'stage' && req.method === 'POST') {
      const { id, stage, note } = await L.readBody(req);
      const s = Number(stage);
      if (!Number.isInteger(s) || s < 0 || s >= L.STAGES.length) return L.send(res, 400, { error: 'stage' });
      const r = await L.requests.get(id);
      if (!r) return L.send(res, 404, { error: 'not_found' });
      const now = new Date().toISOString();
      const n = L.clean(note, 500);
      if (s !== r.stage || n) { r.history.push({ stage: s, at: now, note: n }); }
      r.stage = s; r.updatedAt = now;
      await L.requests.set(id, r);
      return L.send(res, 200, { ok: true, request: r });
    }
    if (action === 'delete-request' && req.method === 'POST') {
      const { id } = await L.readBody(req);
      await L.requests.del(String(id));
      return L.send(res, 200, { ok: true });
    }
    if (action === 'delete-user' && req.method === 'POST') {
      const { email } = await L.readBody(req);
      await L.users.del(String(email).toLowerCase());
      return L.send(res, 200, { ok: true });
    }
    return L.send(res, 400, { error: 'action' });
  } catch (e) {
    return L.send(res, 500, { error: 'server' });
  }
};
