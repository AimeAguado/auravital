const { Controller, Get, Patch, Req, Res, UseGuards } = require('@nestjs/common');
const { timezone } = require('../../lib/config');
const { store } = require('../../lib/store');
const { APPOINTMENT_STATES } = require('../common/constants');
const { audit } = require('../common/audit');
const { RolesGuard } = require('../guards/auth.guard');

class AdminController {
  async auditLog(_req, res) {
    const db = await store.read(); res.json({ audit: db.audit.slice(-500).reverse() });
  }

  async stats(req, res) {
    const db = await store.read();
    let records = db.appointments.filter(item => item.source !== 'BLIPDOC');
    let externalRecords = db.appointments.filter(item => item.source === 'BLIPDOC');
    if (req.query.from) records = records.filter(item => item.date >= req.query.from);
    if (req.query.from) externalRecords = externalRecords.filter(item => item.date >= req.query.from);
    if (req.query.to) records = records.filter(item => item.date <= req.query.to);
    if (req.query.to) externalRecords = externalRecords.filter(item => item.date <= req.query.to);
    if (req.query.professionalId) records = records.filter(item => item.professionalId === req.query.professionalId);
    if (req.query.professionalId) externalRecords = externalRecords.filter(item => item.professionalId === req.query.professionalId);
    if (req.query.status && APPOINTMENT_STATES.has(req.query.status)) records = records.filter(item => item.status === req.query.status);
    if (req.query.status && APPOINTMENT_STATES.has(req.query.status)) externalRecords = externalRecords.filter(item => item.status === req.query.status);
    const byProfessional = db.professionals.map(professional => {
      const items = records.filter(item => item.professionalId === professional.id);
      return { professionalId: professional.id, name: professional.name, turnerMode: professional.turnerMode, externalAppointments: externalRecords.filter(item => item.professionalId === professional.id).length, total: items.length, completed: items.filter(item => item.status === 'completed').length, cancelled: items.filter(item => item.status === 'cancelled').length, pending: items.filter(item => ['pending', 'confirmed'].includes(item.status)).length, revenue: items.filter(item => item.status === 'completed').reduce((sum, item) => sum + Number(item.price || 0), 0) };
    });
    const byPeriod = {};
    for (const item of records) { const month = item.date.slice(0, 7); byPeriod[month] ||= { period: month, appointments: 0, revenue: 0 }; byPeriod[month].appointments++; if (item.status === 'completed') byPeriod[month].revenue += Number(item.price || 0); }
    res.json({ total: records.length, completed: records.filter(item => item.status === 'completed').length, cancelled: records.filter(item => item.status === 'cancelled').length, pending: records.filter(item => ['pending', 'confirmed'].includes(item.status)).length, revenue: records.filter(item => item.status === 'completed').reduce((sum, item) => sum + Number(item.price || 0), 0), externalAppointments: externalRecords.length, byProfessional, byPeriod: Object.values(byPeriod).sort((a, b) => a.period.localeCompare(b.period)), timezone });
  }

  async getSettings(_req, res) {
    const db = await store.read(); res.json({ settings: db.settings });
  }

  async updateSettings(req, res) {
    const cancellationHours = Number(req.body.cancellationHours); const minBookingHours = Number(req.body.minBookingHours); const maxBookingDays = Number(req.body.maxBookingDays);
    if (![cancellationHours, minBookingHours, maxBookingDays].every(Number.isFinite) || cancellationHours < 0 || cancellationHours > 720 || minBookingHours < 0 || minBookingHours > 720 || maxBookingDays < 1 || maxBookingDays > 365) return res.status(400).json({ error: 'Revisá las reglas de anticipación.' });
    const settings = await store.update(db => { db.settings = { cancellationHours, minBookingHours, maxBookingDays }; audit(db, req.user, 'admin.settings.updated'); return db.settings; });
    res.json({ settings });
  }
}

Controller('api/admin')(AdminController);
Get('audit')(AdminController.prototype, 'auditLog', Object.getOwnPropertyDescriptor(AdminController.prototype, 'auditLog'));
Req()(AdminController.prototype, 'auditLog', 0);
Res()(AdminController.prototype, 'auditLog', 1);
UseGuards(new RolesGuard('ADMIN'))(AdminController.prototype, 'auditLog', Object.getOwnPropertyDescriptor(AdminController.prototype, 'auditLog'));
Get('stats')(AdminController.prototype, 'stats', Object.getOwnPropertyDescriptor(AdminController.prototype, 'stats'));
Req()(AdminController.prototype, 'stats', 0);
Res()(AdminController.prototype, 'stats', 1);
UseGuards(new RolesGuard('ADMIN'))(AdminController.prototype, 'stats', Object.getOwnPropertyDescriptor(AdminController.prototype, 'stats'));
Get('settings')(AdminController.prototype, 'getSettings', Object.getOwnPropertyDescriptor(AdminController.prototype, 'getSettings'));
Req()(AdminController.prototype, 'getSettings', 0);
Res()(AdminController.prototype, 'getSettings', 1);
UseGuards(new RolesGuard('ADMIN'))(AdminController.prototype, 'getSettings', Object.getOwnPropertyDescriptor(AdminController.prototype, 'getSettings'));
Patch('settings')(AdminController.prototype, 'updateSettings', Object.getOwnPropertyDescriptor(AdminController.prototype, 'updateSettings'));
Req()(AdminController.prototype, 'updateSettings', 0);
Res()(AdminController.prototype, 'updateSettings', 1);
UseGuards(new RolesGuard('ADMIN'))(AdminController.prototype, 'updateSettings', Object.getOwnPropertyDescriptor(AdminController.prototype, 'updateSettings'));

module.exports = { AdminController };
