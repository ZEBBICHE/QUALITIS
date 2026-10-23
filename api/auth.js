// Comptes clients : création, connexion, profil.
const L = require('./_lib');

const FIELDS = ['company_name', 'sector', 'rc', 'nif', 'nis', 'art_imposition', 'address', 'wilaya', 'contact_name', 'phone', 'email'];
const REQUIRED = ['company_name', 'rc', 'nif', 'address', 'wilaya', 'contact_name', 'phone', 'email'];
const isEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const session = (u) => L.sign({ role: 'client', sub: u.email, exp: Date.now() + 7 * 24 * 3600e3 });

module.exports = async (req, res) => {
  if (!L.configured()) return L.send(res, 503, { error: 'not_configured', missing: L.missing() });
  try {
    const action = L.actionOf(req);
    const ip = L.ipOf(req);

    if (action === 'register' && req.method === 'POST') {
      if (!(await L.rateLimit('reg:' + ip, 10, 3600))) return L.send(res, 429, { error: 'too_many' });
      const body = await L.readBody(req);
      const data = {};
      FIELDS.forEach((k) => { data[k] = L.clean(body.data && body.data[k], 200); });
      data.email = data.email.toLowerCase();
      for (const k of REQUIRED) if (!data[k]) return L.send(res, 400, { error: 'missing', field: k });
      if (!isEmail(data.email)) return L.send(res, 400, { error: 'missing', field: 'email' });
      const pw = String(body.password || '');
      if (pw.length < 8 || pw.length > 200) return L.send(res, 400, { error: 'weak_password' });
      if (await L.users.get(data.email)) return L.send(res, 409, { error: 'exists' });
      const user = Object.assign({ createdAt: new Date().toISOString(), passwordHash: await L.hashPassword(pw) }, data);
      await L.users.set(data.email, user);
      return L.send(res, 200, { token: session(user), user: L.publicUser(user) });
    }

    if (action === 'login' && req.method === 'POST') {
      const body = await L.readBody(req);
      const email = L.clean(body.email, 200).toLowerCase();
      if (!(await L.rateLimit('login:' + ip, 10, 900)) || !(await L.rateLimit('loginu:' + email, 10, 900))) return L.send(res, 429, { error: 'too_many' });
      const user = email && (await L.users.get(email));
      // Même réponse que le compte existe ou non (pas de fuite d'information)
      if (!user || !(await L.checkPassword(String(body.password || ''), user.passwordHash))) return L.send(res, 401, { error: 'bad_credentials' });
      return L.send(res, 200, { token: session(user), user: L.publicUser(user) });
    }

    if (action === 'me' && req.method === 'GET') {
      const p = L.authAs(req, 'client');
      const user = p && (await L.users.get(p.sub));
      if (!user) return L.send(res, 401, { error: 'unauthorized' });
      return L.send(res, 200, { user: L.publicUser(user) });
    }
    return L.send(res, 400, { error: 'action' });
  } catch (e) {
    return L.send(res, 500, { error: 'server' });
  }
};
