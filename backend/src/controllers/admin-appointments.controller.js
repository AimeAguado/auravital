const { Controller, Patch, Post, Req, Res, UseGuards } = require('@nestjs/common');
const { store } = require('../../lib/store');
const { ACTIVE_APPOINTMENT_STATES, APPOINTMENT_STATES } = require('../common/constants');
const { id, cleanText } = require('../common/serialize');
const { audit } = require('../common/audit');
const { parseDate, toArgentinaInstant, listSlots } = require('../common/dates');
const { notifications } = require('../common/notifications');
const { RolesGuard } = require('../guards/auth.guard');

class AdminAppointmentsController {
  async create(req, res) {
    const professionalId = cleanText(req.body.professionalId, 80); const patientEmail = cleanText(req.body.patientEmail, 254).toLowerCase();
    const date = req.body.date; const time = req.body.time; const price = Number(req.body.price);
    if (!parseDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time || '') || !Number.isFinite(price) || price < 0) return res.status(400).json({ error: 'Revisá la fecha, hora e importe del turno.' });
    const appointment = await store.update(db => {
      const professional = db.professionals.find(item => item.id === professionalId);
      const patient = db.users.find(user => user.email === patientEmail && user.role === 'PATIENT' && user.active !== false);
      if (!professional) { const error = new Error('Profesional no encontrado.'); error.status = 404; throw error; }
      if (!patient) { const error = new Error('No existe un paciente activo con ese email.'); error.status = 404; throw error; }
      let slot;
      let source = 'AURA_VITAL';
      if (professional.turnerMode === 'BLIPDOC') source = 'BLIPDOC';
      else {
        slot = listSlots(db, professional, date).find(item => item.time === time);
        if (!slot) { const error = new Error('Ese horario no está habilitado o ya está ocupado.'); error.status = 409; throw error; }
      }
      const startAt = slot?.startAt || toArgentinaInstant(date, time).toISOString();
      const duration = professional.durationMinutes || 30;
      const endAt = slot?.endAt || new Date(new Date(startAt).getTime() + duration * 60000).toISOString();
      const created = { id: id(), professionalId, patientId: patient.id, date, time, startAt, endAt, price, status: 'confirmed', source, ...(source === 'AURA_VITAL' ? { confirmationEmailStatus: 'pending', reminderEmailStatus: 'pending', confirmationEmailEvent: id() } : {}), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: req.user.id };
      db.appointments.push(created); audit(db, req.user, 'admin.appointment.created', { appointmentId: created.id, professionalId, patientId: patient.id, source }); return created;
    });
    res.status(201).json({ appointment });
    setImmediate(() => notifications.process().catch(error => console.error(`Error en notificaciones de turno: ${error.message}`)));
  }

  async update(req, res) {
    const appointment = await store.update(db => {
      const item = db.appointments.find(record => record.id === req.params.id);
      if (!item) { const error = new Error('Turno no encontrado.'); error.status = 404; throw error; }
      const old = { professionalId: item.professionalId, patientId: item.patientId, date: item.date, time: item.time };
      const professionalId = req.body.professionalId || item.professionalId;
      const professional = db.professionals.find(record => record.id === professionalId);
      if (!professional) { const error = new Error('Profesional de destino no encontrado.'); error.status = 404; throw error; }
      if ((item.source === 'BLIPDOC') !== (professional.turnerMode === 'BLIPDOC')) { const error = new Error('Reasigná el turno a un profesional con la misma modalidad de turnero.'); error.status = 409; throw error; }
      const date = req.body.date || item.date; const time = req.body.time || item.time;
      if (!parseDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) { const error = new Error('Fecha u hora inválida.'); error.status = 400; throw error; }
      if (professional.turnerMode === 'AURA_VITAL' && (ACTIVE_APPOINTMENT_STATES.has(item.status) || ACTIVE_APPOINTMENT_STATES.has(req.body.status))) {
        const otherAppointments = db.appointments.filter(record => record.id !== item.id);
        const originalAppointments = db.appointments; db.appointments = otherAppointments;
        const slot = listSlots(db, professional, date).find(record => record.time === time);
        db.appointments = originalAppointments;
        if (!slot) { const error = new Error('El horario destino no está disponible.'); error.status = 409; throw error; }
        item.startAt = slot.startAt; item.endAt = slot.endAt;
      } else {
        item.startAt = toArgentinaInstant(date, time).toISOString();
        item.endAt = new Date(new Date(item.startAt).getTime() + (professional.durationMinutes || 30) * 60000).toISOString();
      }
      item.professionalId = professionalId; item.date = date; item.time = time;
      if (req.body.patientId) {
        if (!db.users.some(user => user.id === req.body.patientId && user.role === 'PATIENT')) { const error = new Error('Paciente de destino no encontrado.'); error.status = 404; throw error; }
        item.patientId = req.body.patientId;
      }
      if (req.body.price !== undefined && Number.isFinite(Number(req.body.price)) && Number(req.body.price) >= 0) item.price = Number(req.body.price);
      if (req.body.status && APPOINTMENT_STATES.has(req.body.status)) {
        const wasConfirmed = item.status === 'confirmed';
        item.status = req.body.status;
        if (!wasConfirmed && item.status === 'confirmed' && item.source === 'AURA_VITAL') {
          item.confirmationEmailStatus = 'pending'; item.reminderEmailStatus = 'pending'; item.confirmationEmailEvent = id();
        }
      }
      item.updatedAt = new Date().toISOString(); audit(db, req.user, 'admin.appointment.updated', { appointmentId: item.id, from: old, to: { professionalId: item.professionalId, patientId: item.patientId, date: item.date, time: item.time } }); return item;
    });
    res.json({ appointment });
    if (req.body.status === 'confirmed') setImmediate(() => notifications.process().catch(error => console.error(`Error en notificaciones de turno: ${error.message}`)));
  }
}

Controller('api/admin/appointments')(AdminAppointmentsController);
Post('')(AdminAppointmentsController.prototype, 'create', Object.getOwnPropertyDescriptor(AdminAppointmentsController.prototype, 'create'));
Req()(AdminAppointmentsController.prototype, 'create', 0);
Res()(AdminAppointmentsController.prototype, 'create', 1);
UseGuards(new RolesGuard('ADMIN'))(AdminAppointmentsController.prototype, 'create', Object.getOwnPropertyDescriptor(AdminAppointmentsController.prototype, 'create'));
Patch(':id')(AdminAppointmentsController.prototype, 'update', Object.getOwnPropertyDescriptor(AdminAppointmentsController.prototype, 'update'));
Req()(AdminAppointmentsController.prototype, 'update', 0);
Res()(AdminAppointmentsController.prototype, 'update', 1);
UseGuards(new RolesGuard('ADMIN'))(AdminAppointmentsController.prototype, 'update', Object.getOwnPropertyDescriptor(AdminAppointmentsController.prototype, 'update'));

module.exports = { AdminAppointmentsController };
