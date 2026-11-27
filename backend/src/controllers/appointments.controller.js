const { Controller, Get, Patch, Post, Req, Res, UseGuards } = require('@nestjs/common');
const { timezone } = require('../../lib/config');
const { store } = require('../../lib/store');
const { ACTIVE_APPOINTMENT_STATES, APPOINTMENT_STATES } = require('../common/constants');
const { id, publicUser, publicProfessional } = require('../common/serialize');
const { audit } = require('../common/audit');
const { canViewAppointment, getProfessionalForUser } = require('../common/access');
const { parseDate, listSlots } = require('../common/dates');
const { notifications } = require('../common/notifications');
const { AuthGuard, RolesGuard } = require('../guards/auth.guard');

class AppointmentsController {
  async create(req, res) {
    const { professionalId, date, time, treatmentId } = req.body;
    if (!parseDate(date) || !/^\d{2}:\d{2}$/.test(time || '')) return res.status(400).json({ error: 'Seleccioná una fecha y un horario válidos.' });
    const appointment = await store.update(db => {
      const professional = db.professionals.find(item => item.id === professionalId && item.active && item.turnerMode === 'AURA_VITAL');
      if (!professional) { const error = new Error('El profesional no está disponible para reservas internas.'); error.status = 409; throw error; }
      const treatments = publicProfessional(professional).treatments;
      const treatment = treatmentId ? treatments.find(item => item.id === treatmentId) : treatments[0];
      if (!treatment) { const error = new Error('El tratamiento elegido ya no está disponible. Elegí otro.'); error.status = 409; throw error; }
      const slot = listSlots(db, professional, date, treatment.durationMinutes).find(item => item.time === time);
      if (!slot) { const error = new Error('Ese horario ya no está disponible. Elegí otro.'); error.status = 409; throw error; }
      const created = { id: id(), professionalId, patientId: req.user.id, date, time, startAt: slot.startAt, endAt: slot.endAt, price: Number(treatment.price), treatmentId: treatment.id, treatmentName: treatment.name, durationMinutes: Number(treatment.durationMinutes), status: 'confirmed', source: 'AURA_VITAL', confirmationEmailStatus: 'pending', reminderEmailStatus: 'pending', confirmationEmailEvent: id(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      db.appointments.push(created);
      audit(db, req.user, 'appointment.created', { appointmentId: created.id, professionalId, date, time });
      return created;
    });
    res.status(201).json({ appointment });
    setImmediate(() => notifications.process().catch(error => console.error(`Error en notificaciones de turno: ${error.message}`)));
  }

  async list(req, res) {
    const db = await store.read();
    let items = db.appointments;
    if (req.user.role === 'PATIENT') items = items.filter(item => item.patientId === req.user.id);
    else if (req.user.role === 'PROFESSIONAL') {
      const professional = getProfessionalForUser(db, req.user);
      items = professional ? items.filter(item => item.professionalId === professional.id) : [];
    }
    if (req.query.status && APPOINTMENT_STATES.has(req.query.status)) items = items.filter(item => item.status === req.query.status);
    if (req.query.professionalId && req.user.role === 'ADMIN') items = items.filter(item => item.professionalId === req.query.professionalId);
    if (req.query.patient && req.user.role === 'ADMIN') items = items.filter(item => item.patientId === req.query.patient || db.users.find(user => user.id === item.patientId)?.email.includes(req.query.patient.toLowerCase()) || db.users.find(user => user.id === item.patientId)?.name.toLowerCase().includes(req.query.patient.toLowerCase()));
    if (req.query.from) items = items.filter(item => item.date >= req.query.from);
    if (req.query.to) items = items.filter(item => item.date <= req.query.to);
    const hydrated = items.map(item => ({
      ...item,
      professional: (() => { const professional = db.professionals.find(p => p.id === item.professionalId); return professional ? { id: professional.id, name: professional.name, specialty: professional.specialty } : null; })(),
      patient: req.user.role === 'PATIENT' ? undefined : publicUser(db.users.find(user => user.id === item.patientId)),
    })).sort((a, b) => a.startAt.localeCompare(b.startAt));
    res.json({ appointments: hydrated, timezone });
  }

  async updateStatus(req, res) {
    const status = req.body.status;
    if (!APPOINTMENT_STATES.has(status)) return res.status(400).json({ error: 'Estado de turno inválido.' });
    const appointment = await store.update(db => {
      const item = db.appointments.find(record => record.id === req.params.id);
      if (!item || !canViewAppointment(req.user, item, db)) { const error = new Error('Turno no encontrado.'); error.status = 404; throw error; }
      if (req.user.role === 'PATIENT') {
        if (status !== 'cancelled' || !ACTIVE_APPOINTMENT_STATES.has(item.status)) { const error = new Error('No podés realizar ese cambio en el turno.'); error.status = 403; throw error; }
      } else if (req.user.role === 'PROFESSIONAL' && !['confirmed', 'cancelled', 'completed', 'no_show'].includes(status)) {
        const error = new Error('Estado no permitido para el profesional.'); error.status = 403; throw error;
      }
      const oldStatus = item.status;
      if (ACTIVE_APPOINTMENT_STATES.has(status) && !ACTIVE_APPOINTMENT_STATES.has(oldStatus)) {
        const professional = db.professionals.find(record => record.id === item.professionalId);
        if (professional?.turnerMode === 'AURA_VITAL' && !listSlots(db, professional, item.date).some(slot => slot.time === item.time)) { const error = new Error('No se puede reactivar el turno: el horario ya no está disponible.'); error.status = 409; throw error; }
      }
      item.status = status; item.updatedAt = new Date().toISOString();
      if (status === 'confirmed' && oldStatus !== 'confirmed' && item.source === 'AURA_VITAL') {
        item.confirmationEmailStatus = 'pending'; item.reminderEmailStatus = 'pending'; item.confirmationEmailEvent = id();
      }
      audit(db, req.user, 'appointment.status.changed', { appointmentId: item.id, from: oldStatus, to: status });
      return item;
    });
    res.json({ appointment });
    if (status === 'confirmed') setImmediate(() => notifications.process().catch(error => console.error(`Error en notificaciones de turno: ${error.message}`)));
  }
}

Controller('api/appointments')(AppointmentsController);
Post('')(AppointmentsController.prototype, 'create', Object.getOwnPropertyDescriptor(AppointmentsController.prototype, 'create'));
Req()(AppointmentsController.prototype, 'create', 0);
Res()(AppointmentsController.prototype, 'create', 1);
UseGuards(new RolesGuard('PATIENT'))(AppointmentsController.prototype, 'create', Object.getOwnPropertyDescriptor(AppointmentsController.prototype, 'create'));
Get('')(AppointmentsController.prototype, 'list', Object.getOwnPropertyDescriptor(AppointmentsController.prototype, 'list'));
Req()(AppointmentsController.prototype, 'list', 0);
Res()(AppointmentsController.prototype, 'list', 1);
UseGuards(new AuthGuard())(AppointmentsController.prototype, 'list', Object.getOwnPropertyDescriptor(AppointmentsController.prototype, 'list'));
Patch(':id/status')(AppointmentsController.prototype, 'updateStatus', Object.getOwnPropertyDescriptor(AppointmentsController.prototype, 'updateStatus'));
Req()(AppointmentsController.prototype, 'updateStatus', 0);
Res()(AppointmentsController.prototype, 'updateStatus', 1);
UseGuards(new AuthGuard())(AppointmentsController.prototype, 'updateStatus', Object.getOwnPropertyDescriptor(AppointmentsController.prototype, 'updateStatus'));

module.exports = { AppointmentsController };
