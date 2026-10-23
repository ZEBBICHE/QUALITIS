// Diagnostic : ouvrez https://votre-site.vercel.app/api/health pour vérifier la configuration (aucun secret affiché).
const L = require('./_lib');
module.exports = async (req, res) => {
  const missing = L.missing();
  let redisOk = false, redisError = null;
  if (process.env.QUALITIS_DEV === '1') redisOk = true;
  else if (!missing.includes('KV_REST_API_URL') && !missing.includes('KV_REST_API_TOKEN')) {
    try { redisOk = (await L.redis(['PING'])) === 'PONG'; } catch (e) { redisError = String(e.message || e).slice(0, 120); }
  }
  L.send(res, 200, { api: true, ready: missing.length === 0 && redisOk, missingEnv: missing, redisReachable: redisOk, redisError });
};
