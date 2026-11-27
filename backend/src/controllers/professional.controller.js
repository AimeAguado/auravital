const { Controller, Delete, Get, Patch, Post, Req, Res, UseGuards } = require('@nestjs/common');
const { store } = require('../../lib/store');
const { ACTIVE_APPOINTMENT_STATES } = require('../common/constants');
const { id, cleanText, publicProfessional } = require('../common/serialize');
const { audit } = require('../common/audit');
const { getProfessionalForUser } = require('../common/access');
const { parseDate, weekdayFor, toArgentinaInstant, timeMinutes, overlaps } = require('../common/dates');
const { validSchedule, validDateSchedules } = require('../common/validation');
const { RolesGuard } = require('../guards/auth.guard');

class ProfessionalController {
  async me(req, res) {
    const db = await store.read(); const professional = getProfessionalForUser(db, req.user);
    if (!professional) return res.status(404).json({ error: 'No se encontró el perfil profesional.' });
    res.json({ professional: publicProfessional(professional, req.user, true) });
  }

  async updateSettings(req, res) {
    const { price, durationMinutes, treatments } = req.body;
    const numericPrice = Number(price); const numericDuration = Number(durationMinutes);
    if (!Number.isFinite(numericPrice) || numericPrice < 0 || numericPrice > 100000000 || !Number.isInteger(numericDuration) || numericDuration < 10 || numericDuration > 240) return res.status(400).json({ error: 'Ingresá un valor válido y una duración entre 10 y 240 minutos.' });
    if (!Array.isArray(treatments) || treatments.length > 30 || treatments.some(item => !cleanText(item.name, 160) || !Number.isFinite(Number(item.price)) || Number(item.price) < 0 || Number(item.price) > 100000000 || !Number.isInteger(Number(item.durationMinutes)) || Number(item.durationMinutes) < 10 || Number(item.durationMinutes) > 240)) return res.status(400).json({ error: 'Revisá los tratamientos: cada uno necesita nombre, valor válido y duración entre 10 y 240 minutos.' });
    const professional = await store.update(db => {
      const own = getProfessionalForUser(db, req.user);
      if (!own || !own.active) { const error = new Error('Perfil profesional no encontrado o inactivo.'); error.status = 404; throw error; }
      own.treatments = treatments.map(item => ({ id: cleanText(item.id, 80) || id(), name: cleanText(item.name, 160), durationMinutes: Number(item.durationMinutes), price: Number(item.price), active: item.active !== false }));
      own.price = numericPrice; own.durationMinutes = numericDuration;
      audit(db, req.user, 'professional.treatments.updated', { professionalId: own.id, treatmentCount: own.treatments.length });
      return publicProfessional(own, req.user, true);
    });
    res.json({ professional });
  }

  async updateSchedule(req, res) {
    const schedule = req.body.schedule;
    if (!validSchedule(schedule)) return res.status(400).json({ error: 'Revisá los días y horarios de atención; no deben superponerse.' });
    const professional = await store.update(db => {
      const own = getProfessionalForUser(db, req.user);
      if (!own || own.turnerMode !== 'AURA_VITAL') { const error = new Error('El turnero interno no está habilitado para este perfil.'); error.status = 409; throw error; }
      own.schedule = schedule.map(item => ({ weekday: Number(item.weekday), start: item.start, end: item.end, enabled: item.enabled !== false }));
      audit(db, req.user, 'professional.schedule.updated', { professionalId: own.id });
      return own;
    });
    res.json({ professional: publicProfessional(professional, req.user, true) });
  }

  async updateDateSchedule(req, res) {
    const dateSchedules = req.body.dateSchedules;
    if (!validDateSchedules(dateSchedules)) return res.status(400).json({ error: 'Revisá las fechas y franjas: no deben superponerse y solo se puede programar hasta un año por adelantado.' });
    const professional = await store.update(db => {
      const own = getProfessionalForUser(db, req.user);
      if (!own || !own.active || own.turnerMode !== 'AURA_VITAL') { const error = new Error('La agenda por fecha solo está habilitada para el turnero Aura Vital.'); error.status = 409; throw error; }
      const normalized = dateSchedules.map(day => ({ date: day.date, intervals: day.intervals.map(interval => ({ start: interval.start, end: interval.end, enabled: interval.enabled !== false })) }));
      for (const appointment of db.appointments.filter(item => item.professionalId === own.id && ACTIVE_APPOINTMENT_STATES.has(item.status))) {
        const weekday = weekdayFor(appointment.date);
        const day = normalized.find(item => item.date === appointment.date);
        const ranges = day ? day.intervals : (own.schedule || []).filter(item => Number(item.weekday) === weekday);
        const start = timeMinutes(appointment.time); const end = start + Number(appointment.durationMinutes || own.durationMinutes || 30);
        if (!ranges.some(range => range.enabled !== false && timeMinutes(range.start) <= start && timeMinutes(range.end) >= end)) { const error = new Error(`La fecha ${appointment.date} tiene un turno reservado. Conservá su franja o reprogramá el turno antes de guardar.`); error.status = 409; throw error; }
      }
      own.dateSchedules = normalized;
      audit(db, req.user, 'professional.date-schedule.updated', { professionalId: own.id, days: normalized.length });
      return publicProfessional(own, req.user, true);
    });
    res.json({ professional });
  }

  async createBlock(req, res) {
    const date = req.body.date; const allDay = req.body.allDay === true;
    const start = allDay ? '00:00' : req.body.start; const end = allDay ? '23:59' : req.body.end;
    if (!parseDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end || '') || end <= start) return res.status(400).json({ error: 'Fecha o franja horaria inválida.' });
    const block = await store.update(db => {
      const professional = getProfessionalForUser(db, req.user);
      if (!professional || professional.turnerMode !== 'AURA_VITAL') { const error = new Error('El turnero interno no está habilitado.'); error.status = 409; throw error; }
      const startAt = toArgentinaInstant(date, start).toISOString(); const endAt = toArgentinaInstant(date, end).toISOString();
      if (db.appointments.some(item => item.professionalId === professional.id && ACTIVE_APPOINTMENT_STATES.has(item.status) && overlaps(item.startAt, item.endAt, startAt, endAt))) { const error = new Error('La franja contiene turnos reservados. Resolvé esos turnos antes de bloquearla.'); error.status = 409; throw error; }
      const created = { id: id(), date, start, end, startAt, endAt, allDay, createdAt: new Date().toISOString() };
      professional.blocks.push(created); audit(db, req.user, 'professional.availability.blocked', { professionalId: professional.id, blockId: created.id });
      return created;
    });
    res.status(201).json({ block });
  }

  async deleteBlock(req, res) {
    await store.update(db => {
      const professional = getProfessionalForUser(db, req.user);
      if (!professional) { const error = new Error('Perfil profesional no encontrado.'); error.status = 404; throw error; }
      professional.blocks = professional.blocks.filter(block => block.id !== req.params.id);
      audit(db, req.user, 'professional.availability.unblocked', { professionalId: professional.id, blockId: req.params.id });
    });
    res.status(204).end();
  }
}

Controller('api/professional/me')(ProfessionalController);
Get('')(ProfessionalController.prototype, 'me', Object.getOwnPropertyDescriptor(ProfessionalController.prototype, 'me'));
Req()(ProfessionalController.prototype, 'me', 0);
Res()(ProfessionalController.prototype, 'me', 1);
UseGuards(new RolesGuard('PROFESSIONAL'))(ProfessionalController.prototype, 'me', Object.getOwnPropertyDescriptor(ProfessionalController.prototype, 'me'));
Patch('settings')(ProfessionalController.prototype, 'updateSettings', Object.getOwnPropertyDescriptor(ProfessionalController.prototype, 'updateSettings'));
Req()(ProfessionalController.prototype, 'updateSettings', 0);
Res()(ProfessionalController.prototype, 'updateSettings', 1);
UseGuards(new RolesGuard('PROFESSIONAL'))(ProfessionalController.prototype, 'updateSettings', Object.getOwnPropertyDescriptor(ProfessionalController.prototype, 'updateSettings'));
Patch('schedule')(ProfessionalController.prototype, 'updateSchedule', Object.getOwnPropertyDescriptor(ProfessionalController.prototype, 'updateSchedule'));
Req()(ProfessionalController.prototype, 'updateSchedule', 0);
Res()(ProfessionalController.prototype, 'updateSchedule', 1);
UseGuards(new RolesGuard('PROFESSIONAL'))(ProfessionalController.prototype, 'updateSchedule', Object.getOwnPropertyDescriptor(ProfessionalController.prototype, 'updateSchedule'));
Patch('date-schedule')(ProfessionalController.prototype, 'updateDateSchedule', Object.getOwnPropertyDescriptor(ProfessionalController.prototype, 'updateDateSchedule'));
Req()(ProfessionalController.prototype, 'updateDateSchedule', 0);
Res()(ProfessionalController.prototype, 'updateDateSchedule', 1);
UseGuards(new RolesGuard('PROFESSIONAL'))(ProfessionalController.prototype, 'updateDateSchedule', Object.getOwnPropertyDescriptor(ProfessionalController.prototype, 'updateDateSchedule'));
Post('blocks')(ProfessionalController.prototype, 'createBlock', Object.getOwnPropertyDescriptor(ProfessionalController.prototype, 'createBlock'));
Req()(ProfessionalController.prototype, 'createBlock', 0);
Res()(ProfessionalController.prototype, 'createBlock', 1);
UseGuards(new RolesGuard('PROFESSIONAL'))(ProfessionalController.prototype, 'createBlock', Object.getOwnPropertyDescriptor(ProfessionalController.prototype, 'createBlock'));
Delete('blocks/:id')(ProfessionalController.prototype, 'deleteBlock', Object.getOwnPropertyDescriptor(ProfessionalController.prototype, 'deleteBlock'));
Req()(ProfessionalController.prototype, 'deleteBlock', 0);
Res()(ProfessionalController.prototype, 'deleteBlock', 1);
UseGuards(new RolesGuard('PROFESSIONAL'))(ProfessionalController.prototype, 'deleteBlock', Object.getOwnPropertyDescriptor(ProfessionalController.prototype, 'deleteBlock'));

module.exports = { ProfessionalController };
