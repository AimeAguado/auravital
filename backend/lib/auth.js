const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { sessionSecret } = require('./config');

const scrypt = promisify(crypto.scrypt);
const COOKIE_NAME = 'auravital_session';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const derived = await scrypt(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

function signSession(userId, expiresAt) {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: expiresAt })).toString('base64url');
  const signature = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readSession(token) {
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', sessionSecret).update(payload).digest();
  let supplied;
  try { supplied = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return value.exp > Date.now() ? value : null;
  } catch { return null; }
}

function setSession(res, userId) {
  const expiresAt = Date.now() + SESSION_MAX_AGE;
  res.cookie(COOKIE_NAME, signSession(userId, expiresAt), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  });
}

function clearSession(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', path: '/' });
}

function sessionUserId(req) {
  return readSession(req.cookies?.[COOKIE_NAME])?.sub || null;
}

module.exports = { hashPassword, verifyPassword, setSession, clearSession, sessionUserId };
