const { Controller, Patch, Post, Req, Res, UseGuards } = require('@nestjs/common');
const { store } = require('../../lib/store');
const { hashPassword, verifyPassword } = require('../../lib/auth');
const { EMAIL_RE } = require('../common/constants');
const { cleanText, privateUser } = require('../common/serialize');
const { audit } = require('../common/audit');
const { AuthGuard, RolesGuard } = require('../guards/auth.guard');

class AccountController {
  async changePassword(req, res) {
    const currentPassword = typeof req.body.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';
    if (newPassword.length < 10 || newPassword.length > 200) return res.status(400).json({ error: 'La nueva contraseña debe tener entre 10 y 200 caracteres.' });
    if (currentPassword === newPassword) return res.status(400).json({ error: 'La contraseña nueva debe ser distinta de la actual.' });
    const changed = await store.update(async db => {
      const user = db.users.find(item => item.id === req.user.id && item.active !== false);
      if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) { const error = new Error('La contraseña actual no es correcta.'); error.status = 401; throw error; }
      user.passwordHash = await hashPassword(newPassword);
      audit(db, user, 'account.password.changed');
      return true;
    });
    res.status(200).json({ changed });
  }

  async updateCredentials(req, res) {
    const currentPassword = typeof req.body.currentPassword === 'string' ? req.body.currentPassword : '';
    const email = cleanText(req.body.email, 254).toLowerCase();
    const newPassword = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Ingresá un email válido.' });
    if (newPassword && (newPassword.length < 10 || newPassword.length > 200)) return res.status(400).json({ error: 'La nueva contraseña debe tener entre 10 y 200 caracteres.' });
    const updated = await store.update(async db => {
      const user = db.users.find(item => item.id === req.user.id && item.active !== false);
      if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) { const error = new Error('La contraseña actual no es correcta.'); error.status = 401; throw error; }
      if (db.users.some(item => item.id !== user.id && item.email === email)) { const error = new Error('Ese email ya está registrado.'); error.status = 409; throw error; }
      user.email = email;
      if (newPassword) user.passwordHash = await hashPassword(newPassword);
      audit(db, user, 'account.credentials.updated', { emailChanged: email !== req.user.email, passwordChanged: Boolean(newPassword) });
      return user;
    });
    res.json({ user: privateUser(updated) });
  }
}

Controller('api/account')(AccountController);
Post('password')(AccountController.prototype, 'changePassword', Object.getOwnPropertyDescriptor(AccountController.prototype, 'changePassword'));
Req()(AccountController.prototype, 'changePassword', 0);
Res()(AccountController.prototype, 'changePassword', 1);
UseGuards(new AuthGuard())(AccountController.prototype, 'changePassword', Object.getOwnPropertyDescriptor(AccountController.prototype, 'changePassword'));
Patch('credentials')(AccountController.prototype, 'updateCredentials', Object.getOwnPropertyDescriptor(AccountController.prototype, 'updateCredentials'));
Req()(AccountController.prototype, 'updateCredentials', 0);
Res()(AccountController.prototype, 'updateCredentials', 1);
UseGuards(new RolesGuard('ADMIN', 'PROFESSIONAL'))(AccountController.prototype, 'updateCredentials', Object.getOwnPropertyDescriptor(AccountController.prototype, 'updateCredentials'));

module.exports = { AccountController };
