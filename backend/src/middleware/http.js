const { store } = require('../../lib/store');
const { sessionUserId } = require('../../lib/auth');

function securityHeaders(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
  next();
}

function parseCookies(req, _res, next) {
  req.cookies = {};
  for (const entry of (req.headers.cookie || '').split(';')) {
    const index = entry.indexOf('=');
    if (index > 0) req.cookies[entry.slice(0, index).trim()] = decodeURIComponent(entry.slice(index + 1).trim());
  }
  next();
}

function enforceSameOrigin(req, res, next) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.get('origin');
    if (origin && origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: 'Origen no permitido.' });
  }
  next();
}

async function loadUser(req, _res, next) {
  try {
    const userId = sessionUserId(req);
    if (!userId) { req.user = null; return next(); }
    const db = await store.read();
    req.user = db.users.find(user => user.id === userId && user.active !== false) || null;
    next();
  } catch (error) { next(error); }
}

function apiErrorHandler(error, _req, res, _next) {
  const status = Number(error?.status) || Number(error?.statusCode) || 500;
  if (status >= 500) console.error(`${error?.name || 'Error'}: ${String(error?.message || '').replace(/mongodb(?:\+srv)?:\/\/[^@/]+@/gi, 'mongodb://***@').slice(0, 300)}`);
  res.status(status).json({ error: status >= 500 ? 'Ocurrió un error interno. Intentá nuevamente.' : String(error?.message ?? '') });
}

module.exports = { securityHeaders, parseCookies, enforceSameOrigin, loadUser, apiErrorHandler };
