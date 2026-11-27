const crypto = require('node:crypto');
const { Controller, Get, Post, Req, Res } = require('@nestjs/common');
const { store } = require('../../lib/store');
const { hashPassword, verifyPassword, setSession, clearSession } = require('../../lib/auth');
const { sendResendEmail } = require('../../lib/notifications');
const { EMAIL_RE } = require('../common/constants');
const { id, cleanText, privateUser } = require('../common/serialize');
const { audit } = require('../common/audit');
const { parseDate, nowArgentinaParts } = require('../common/dates');

const loginAttempts = new Map();

class AuthController {
  async register(req, res) {
    const firstName = cleanText(req.body.firstName, 80);
    const lastName = cleanText(req.body.lastName, 80);
    const email = cleanText(req.body.email, 254).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const dni = cleanText(req.body.dni, 12);
    const birthDate = cleanText(req.body.birthDate, 10);
    const phone = cleanText(req.body.phone, 24);
    if (!firstName || !lastName || !EMAIL_RE.test(email) || password.length < 10 || password.length > 200) return res.status(400).json({ error: 'Completá nombre, apellido, email y una contraseña de al menos 10 caracteres.' });
    if (dni && !/^\d{7,8}$/.test(dni)) return res.status(400).json({ error: 'El DNI debe tener 7 u 8 números.' });
    if (birthDate && (!parseDate(birthDate) || birthDate >= nowArgentinaParts().date)) return res.status(400).json({ error: 'Ingresá una fecha de nacimiento válida.' });
    if (phone && !/^[+\d() .-]{8,24}$/.test(phone)) return res.status(400).json({ error: 'Ingresá un teléfono válido con código de área.' });
    const user = await store.update(async db => {
      if (db.users.some(item => item.email === email)) { const error = new Error('Ya existe una cuenta con ese email.'); error.status = 409; throw error; }
      if (dni && db.users.some(item => item.dni === dni)) { const error = new Error('Ya existe una cuenta con ese DNI. Iniciá sesión o escribinos para recibir ayuda.'); error.status = 409; throw error; }
      const created = { id: id(), firstName, lastName, name: `${firstName} ${lastName}`, email, ...(dni ? { dni } : {}), ...(birthDate ? { birthDate } : {}), ...(phone ? { phone } : {}), role: 'PATIENT', active: true, createdAt: new Date().toISOString(), passwordHash: await hashPassword(password) };
      db.users.push(created);
      audit(db, created, 'patient.registered');
      return created;
    });
    setSession(res, user.id);
    res.status(201).json({ user: privateUser(user) });
  }

  async login(req, res) {
    const email = cleanText(req.body.email, 254).toLowerCase();
    const address = req.ip || 'local'; const attempt = loginAttempts.get(address) || { count: 0, until: 0 };
    if (attempt.until > Date.now() && attempt.count >= 10) return res.status(429).json({ error: 'Demasiados intentos. Esperá unos minutos e intentá nuevamente.' });
    const db = await store.read();
    const user = db.users.find(item => item.email === email && item.active !== false);
    if (!user || !(await verifyPassword(req.body.password, user.passwordHash))) {
      if (attempt.until < Date.now()) { attempt.count = 0; attempt.until = Date.now() + 15 * 60 * 1000; }
      attempt.count++; loginAttempts.set(address, attempt);
      return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
    }
    loginAttempts.delete(address);
    setSession(res, user.id);
    res.status(200).json({ user: privateUser(user) });
  }

  async forgotPassword(req, res) {
    const email = cleanText(req.body.email, 254).toLowerCase();
    const user = (await store.read()).users.find(item => item.email === email && item.active !== false);
    if (user) {
      const token = crypto.randomBytes(32).toString('base64url');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await store.update(db => {
        const current = db.users.find(item => item.id === user.id && item.active !== false);
        if (current) { current.passwordResetTokenHash = tokenHash; current.passwordResetExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); }
      });
      const origin = req.get('origin') || `${req.protocol}://${req.get('host')}`;
      const link = `${origin}/?reset=${encodeURIComponent(token)}`;
      const text = `Recibimos una solicitud para cambiar la contraseña de tu cuenta Aura Vital. Abrí este enlace dentro de los próximos 30 minutos: ${link}\n\nSi no solicitaste el cambio, ignorá este correo.`;
      const html = `<div style="font-family:Arial,sans-serif;color:#2f3e34;line-height:1.6"><h2>Restablecé tu contraseña</h2><p>El enlace es válido durante 30 minutos y se puede usar una sola vez.</p><p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#526c59;color:white;text-decoration:none;border-radius:8px">Crear nueva contraseña</a></p><p>Si no solicitaste el cambio, ignorá este correo.</p></div>`;
      try { await sendResendEmail({ to: user.email, subject: 'Restablecé tu contraseña · Aura Vital', html, text }); }
      catch (error) { console.error(`No se pudo enviar el correo de recuperación: ${String(error.message).slice(0, 200)}`); }
    }
    res.status(200).json({ message: 'Si existe una cuenta con ese email, enviaremos un enlace para recuperar la contraseña.' });
  }

  async resetPassword(req, res) {
    const token = typeof req.body.token === 'string' ? req.body.token : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (password.length < 10 || password.length > 200) return res.status(400).json({ error: 'La nueva contraseña debe tener entre 10 y 200 caracteres.' });
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const changed = await store.update(async db => {
      const user = db.users.find(item => item.passwordResetTokenHash === tokenHash && Date.parse(item.passwordResetExpiresAt) > Date.now() && item.active !== false);
      if (!user) return false;
      user.passwordHash = await hashPassword(password);
      delete user.passwordResetTokenHash; delete user.passwordResetExpiresAt;
      audit(db, user, 'account.password.reset');
      return true;
    });
    if (!changed) return res.status(400).json({ error: 'El enlace venció o ya fue utilizado. Solicitá uno nuevo.' });
    res.status(200).json({ changed: true });
  }

  logout(_req, res) {
    clearSession(res);
    res.status(204).end();
  }

  me(req, res) {
    res.json({ user: privateUser(req.user) });
  }
}

Controller('api/auth')(AuthController);
Post('register')(AuthController.prototype, 'register', Object.getOwnPropertyDescriptor(AuthController.prototype, 'register'));
Req()(AuthController.prototype, 'register', 0);
Res()(AuthController.prototype, 'register', 1);
Post('login')(AuthController.prototype, 'login', Object.getOwnPropertyDescriptor(AuthController.prototype, 'login'));
Req()(AuthController.prototype, 'login', 0);
Res()(AuthController.prototype, 'login', 1);
Post('forgot-password')(AuthController.prototype, 'forgotPassword', Object.getOwnPropertyDescriptor(AuthController.prototype, 'forgotPassword'));
Req()(AuthController.prototype, 'forgotPassword', 0);
Res()(AuthController.prototype, 'forgotPassword', 1);
Post('reset-password')(AuthController.prototype, 'resetPassword', Object.getOwnPropertyDescriptor(AuthController.prototype, 'resetPassword'));
Req()(AuthController.prototype, 'resetPassword', 0);
Res()(AuthController.prototype, 'resetPassword', 1);
Post('logout')(AuthController.prototype, 'logout', Object.getOwnPropertyDescriptor(AuthController.prototype, 'logout'));
Req()(AuthController.prototype, 'logout', 0);
Res()(AuthController.prototype, 'logout', 1);
Get('me')(AuthController.prototype, 'me', Object.getOwnPropertyDescriptor(AuthController.prototype, 'me'));
Req()(AuthController.prototype, 'me', 0);
Res()(AuthController.prototype, 'me', 1);

module.exports = { AuthController };
