// Utilitaires partagés (le préfixe "_" empêche Vercel d'en faire une route).
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const DEV = () => process.env.QUALITIS_DEV === '1';
const URL_ = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN_ = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const STAGES = ['Demande reçue', 'Échantillons réceptionnés', 'Analyses en cours', 'Rapport en préparation', 'Résultats transmis'];

function missing() {
  if (DEV()) return [];
  const m = [];
  if (!URL_()) m.push('KV_REST_API_URL');
  if (!TOKEN_()) m.push('KV_REST_API_TOKEN');
  if (!process.env.ADMIN_PASSWORD) m.push('ADMIN_PASSWORD');
  if (!process.env.SESSION_SECRET) m.push('SESSION_SECRET');
  return m;
}
function configured() { return missing().length === 0; }

/* ---- Stockage : Redis REST (Upstash via Vercel). Mémoire locale uniquement pour les tests (QUALITIS_DEV=1). ---- */
const mem = global.__qualitisMem || (global.__qualitisMem = { hashes: {}, counters: {}, rl: {} });
async function redis(cmd) {
  const r = await fetch(URL_(), { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN_(), 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || 'redis ' + r.status);
  return j.result;
}
function table(name) {
  const key = 'qualitis:' + name;
  const m = () => (mem.hashes[name] = mem.hashes[name] || new Map());
  return {
    async set(id, obj) { if (DEV()) return void m().set(id, JSON.stringify(obj)); await redis(['HSET', key, id, JSON.stringify(obj)]); },
    async get(id) { if (DEV()) return m().has(id) ? JSON.parse(m().get(id)) : null; const v = await redis(['HGET', key, id]); return v ? JSON.parse(v) : null; },
    async del(id) { if (DEV()) return void m().delete(id); await redis(['HDEL', key, id]); },
    async all() {
      if (DEV()) return [...m().values()].map(JSON.parse);
      const flat = await redis(['HGETALL', key]); const out = [];
      for (let i = 1; i < (flat || []).length; i += 2) out.push(JSON.parse(flat[i]));
      return out;
    }
  };
}
const users = table('users');       // clé = email en minuscules
const requests = table('requests'); // clé = id

async function nextRef() {
  const year = new Date().getFullYear();
  let n;
  if (DEV()) n = mem.counters[year] = (mem.counters[year] || 0) + 1;
  else n = await redis(['INCR', 'qualitis:seq:' + year]);
  return 'QL-' + year + '-' + String(n).padStart(4, '0');
}

/* Limitation de débit (par clé) */
async function rateLimit(key, max, windowSec) {
  if (DEV()) { const now = Date.now(); const e = mem.rl[key]; if (!e || now > e.t) { mem.rl[key] = { n: 1, t: now + windowSec * 1000 }; return true; } return ++e.n <= max; }
  const k = 'qualitis:rl:' + key;
  const n = await redis(['INCR', k]);
  if (n === 1) await redis(['EXPIRE', k, String(windowSec)]);
  return n <= max;
}
const ipOf = (req) => String(req.headers['x-forwarded-for'] || 'local').split(',')[0].trim();

/* ---- Mots de passe (scrypt + sel) ---- */
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = (await scrypt(pw, salt, 64)).toString('hex');
  return salt + ':' + h;
}
async function checkPassword(pw, stored) {
  const [salt, h] = String(stored).split(':');
  const calc = await scrypt(pw, salt, 64);
  const ref = Buffer.from(h, 'hex');
  return ref.length === calc.length && crypto.timingSafeEqual(ref, calc);
}

/* ---- Jetons signés (HMAC) ---- */
const secret = () => process.env.SESSION_SECRET || 'dev-secret';
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', secret()).update(body).digest('base64url');
}
function verify(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  const good = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}
const bearer = (req) => String(req.headers.authorization || '').replace(/^Bearer /, '');
const authAs = (req, role) => { const p = verify(bearer(req)); return p && p.role === role ? p : null; };
function safeEqual(x, y) {
  const a = crypto.createHash('sha256').update(String(x)).digest();
  const b = crypto.createHash('sha256').update(String(y)).digest();
  return crypto.timingSafeEqual(a, b);
}

/* ---- Entrées / sorties ---- */
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > 50000) throw new Error('too large'); }
  return raw ? JSON.parse(raw) : {};
}
function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}
const actionOf = (req) => (req.query && req.query.action) || new URL(req.url, 'http://x').searchParams.get('action');
const param = (req, k) => (req.query && req.query[k]) || new URL(req.url, 'http://x').searchParams.get(k) || '';

// Vue d'une demande destinée au client (sans champs internes)
const clientView = (r) => ({ ref: r.ref, createdAt: r.createdAt, updatedAt: r.updatedAt, stage: r.stage, stages: STAGES, history: r.history, nature: r.data.nature, message: r.data.message, company: r.data.company, name: r.data.name });
const publicUser = (u) => { const { passwordHash, ...rest } = u; return rest; };

module.exports = { STAGES, configured, missing, redis, users, requests, nextRef, rateLimit, ipOf, hashPassword, checkPassword, sign, verify, authAs, safeEqual, clean, readBody, send, actionOf, param, clientView, publicUser };
