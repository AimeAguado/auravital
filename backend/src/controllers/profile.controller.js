const { Controller, Patch, Req, Res, UseGuards } = require('@nestjs/common');
const { store } = require('../../lib/store');
const { cleanText, publicUser } = require('../common/serialize');
const { audit } = require('../common/audit');
const { RolesGuard } = require('../guards/auth.guard');

class ProfileController {
  async update(req, res) {
    const firstName = cleanText(req.body.firstName, 80);
    const lastName = cleanText(req.body.lastName, 80);
    if (!firstName || !lastName) return res.status(400).json({ error: 'Nombre y apellido son obligatorios.' });
    const user = await store.update(db => {
      const record = db.users.find(item => item.id === req.user.id);
      record.firstName = firstName; record.lastName = lastName; record.name = `${firstName} ${lastName}`;
      audit(db, req.user, 'patient.profile.updated');
      return record;
    });
    res.json({ user: publicUser(user) });
  }
}

Controller('api/profile')(ProfileController);
Patch('')(ProfileController.prototype, 'update', Object.getOwnPropertyDescriptor(ProfileController.prototype, 'update'));
Req()(ProfileController.prototype, 'update', 0);
Res()(ProfileController.prototype, 'update', 1);
UseGuards(new RolesGuard('PATIENT'))(ProfileController.prototype, 'update', Object.getOwnPropertyDescriptor(ProfileController.prototype, 'update'));

module.exports = { ProfileController };
