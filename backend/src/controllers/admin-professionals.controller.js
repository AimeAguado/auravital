const fs = require('node:fs/promises');
const path = require('node:path');
const { Controller, Delete, Get, Patch, Post, Req, Res, UseGuards } = require('@nestjs/common');
const { store } = require('../../lib/store');
const { hashPassword } = require('../../lib/auth');
const { EMAIL_RE, ACTIVE_APPOINTMENT_STATES } = require('../common/constants');
const { id, cleanText, publicUser, publicProfessional } = require('../common/serialize');
const { audit } = require('../common/audit');
const { parseDate, toArgentinaInstant, overlaps } = require('../common/dates');
const { validSchedule } = require('../common/validation');
const { IMAGE_TYPES, imageExtension } = require('../common/images');
const { uploadsRoot, uploadsDirectory } = require('../common/uploads');
const { RolesGuard } = require('../guards/auth.guard');

class AdminProfessionalsController {
  async list(_req, res) {
    const db = await store.read();
    res.json({ professionals: db.professionals.map(professional => publicProfessional(professional, db.users.find(user => user.id === professional.userId), true)) });
  }

  async create(req, res) {
    const name = cleanText(req.body.name, 160); const specialty = cleanText(req.body.specialty, 120);
    const email = cleanText(req.body.email, 254).toLowerCase(); const password = typeof req.body.password === 'string' ? req.body.password : '';
    const price = 0; const durationMinutes = 30;
    const turnerMode = req.body.turnerMode;
    if (!name || !specialty || !EMAIL_RE.test(email) || password.length < 10 || !Number.isFinite(price) || price < 0 || !Number.isInteger(durationMinutes) || durationMinutes < 10 || durationMinutes > 240 || !['AURA_VITAL', 'BLIPDOC'].includes(turnerMode) || (req.body.schedule && !validSchedule(req.body.schedule))) return res.status(400).json({ error: 'Completá los datos del profesional, email, contraseña, precio, duración y modalidad.' });
    const record = await store.update(async db => {
      if (db.users.some(user => user.email === email)) { const error = new Error('Ya existe una cuenta con ese email.'); error.status = 409; throw error; }
      if (turnerMode === 'BLIPDOC' && !/^https:\/\//i.test(req.body.blipdocUrl || '')) { const error = new Error('Ingresá un enlace HTTPS válido para el turnero BlipDoc.'); error.status = 400; throw error; }
      const user = { id: id(), firstName: name.split(' ')[0], lastName: name.split(' ').slice(1).join(' '), name, email, role: 'PROFESSIONAL', active: true, passwordHash: await hashPassword(password), createdAt: new Date().toISOString() };
      const professional = { id: id(), userId: user.id, name, specialty, description: cleanText(req.body.description, 3000), photo: cleanText(req.body.photo, 1000), price, durationMinutes, active: req.body.active !== false, turnerMode, blipdocUrl: turnerMode === 'BLIPDOC' ? req.body.blipdocUrl : null, schedule: Array.isArray(req.body.schedule) ? req.body.schedule : [], blocks: [], createdAt: new Date().toISOString() };
      db.users.push(user); db.professionals.push(professional); audit(db, req.user, 'admin.professional.created', { professionalId: professional.id });
      return { professional: publicProfessional(professional, user, true), user: publicUser(user) };
    });
    res.status(201).json(record);
  }

  async update(req, res) {
    const result = await store.update(async db => {
      const professional = db.professionals.find(item => item.id === req.params.id);
      if (!professional) { const error = new Error('Profesional no encontrado.'); error.status = 404; throw error; }
      const nextMode = req.body.turnerMode ?? professional.turnerMode;
      if (!['AURA_VITAL', 'BLIPDOC'].includes(nextMode)) { const error = new Error('Modalidad de turnero inválida.'); error.status = 400; throw error; }
      if (nextMode === 'BLIPDOC') {
        const url = req.body.blipdocUrl ?? professional.blipdocUrl;
        if (url !== null && url !== '' && !/^https:\/\//i.test(url)) { const error = new Error('El enlace de BlipDoc debe usar HTTPS.'); error.status = 400; throw error; }
        professional.blipdocUrl = url || null;
      } else professional.blipdocUrl = null;
      const user = db.users.find(item => item.id === professional.userId);
      for (const key of ['name', 'specialty', 'description', 'photo']) if (req.body[key] !== undefined) professional[key] = cleanText(req.body[key], key === 'description' ? 3000 : 1000);
      if (user && req.body.email !== undefined) {
        const email = cleanText(req.body.email, 254).toLowerCase();
        if (!EMAIL_RE.test(email) || db.users.some(item => item.id !== user.id && item.email === email)) { const error = new Error('El email no es válido o ya está registrado.'); error.status = 409; throw error; }
        user.email = email;
      }
      if (user && req.body.password) {
        if (req.body.password.length < 10 || req.body.password.length > 200) { const error = new Error('La contraseña debe tener al menos 10 caracteres.'); error.status = 400; throw error; }
        user.passwordHash = await hashPassword(req.body.password);
      }
      if (user && req.body.name !== undefined) { const [firstName, ...lastName] = professional.name.split(/\s+/); user.name = professional.name; user.firstName = firstName; user.lastName = lastName.join(' '); }
      if (req.body.active !== undefined) professional.active = Boolean(req.body.active);
      professional.turnerMode = nextMode;
      if (user) user.active = professional.active;
      audit(db, req.user, 'admin.professional.updated', { professionalId: professional.id });
      return publicProfessional(professional, user, true);
    });
    res.json({ professional: result });
  }

  async uploadPhoto(req, res) {
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const extension = imageExtension(buffer, req.get('content-type'));
    if (!extension) return res.status(400).json({ error: 'Enviá una imagen JPG, PNG, WebP o GIF válida de hasta 6 MB.' });
    const existing = (await store.read()).professionals.find(item => item.id === req.params.id);
    if (!existing) return res.status(404).json({ error: 'Profesional no encontrado.' });
    const filename = `${id()}.${extension}`;
    await fs.mkdir(uploadsDirectory, { recursive: true });
    await fs.writeFile(path.join(uploadsDirectory, filename), buffer, { mode: 0o644 });
    const photoUrl = `/uploads/profesionales/${filename}`;
    const updated = await store.update(db => {
      const professional = db.professionals.find(item => item.id === req.params.id);
      if (!professional) { const error = new Error('Profesional no encontrado.'); error.status = 404; throw error; }
      const previous = professional.photo;
      professional.photo = photoUrl;
      audit(db, req.user, 'admin.professional.photo.updated', { professionalId: professional.id });
      if (previous && previous.startsWith('/uploads/')) fs.unlink(path.join(uploadsRoot, previous.slice('/uploads/'.length))).catch(() => {});
      return publicProfessional(professional, db.users.find(user => user.id === professional.userId), true);
    });
    res.status(200).json({ professional: updated });
  }

  async updateSchedule(req, res) {
    const schedule = req.body.schedule;
    if (!validSchedule(schedule)) return res.status(400).json({ error: 'Revisá los días y horarios de atención; no deben superponerse.' });
    const professional = await store.update(db => {
      const own = db.professionals.find(item => item.id === req.params.id);
      if (!own || own.turnerMode !== 'AURA_VITAL') { const error = new Error('Profesional interno no encontrado.'); error.status = 404; throw error; }
      own.schedule = schedule.map(item => ({ weekday: Number(item.weekday), start: item.start, end: item.end, enabled: item.enabled !== false }));
      audit(db, req.user, 'admin.professional.schedule.updated', { professionalId: own.id });
      return own;
    });
    res.json({ professional: publicProfessional(professional, undefined, true) });
  }

  async createBlock(req, res) {
    const date = req.body.date; const allDay = req.body.allDay === true;
    const start = allDay ? '00:00' : req.body.start; const end = allDay ? '23:59' : req.body.end;
    if (!parseDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end || '') || end <= start) return res.status(400).json({ error: 'Fecha o franja horaria inválida.' });
    const block = await store.update(db => {
      const professional = db.professionals.find(item => item.id === req.params.id && item.active && item.turnerMode === 'AURA_VITAL');
      if (!professional) { const error = new Error('Profesional interno no encontrado.'); error.status = 404; throw error; }
      const startAt = toArgentinaInstant(date, start).toISOString(); const endAt = toArgentinaInstant(date, end).toISOString();
      if (db.appointments.some(item => item.professionalId === professional.id && ACTIVE_APPOINTMENT_STATES.has(item.status) && overlaps(item.startAt, item.endAt, startAt, endAt))) { const error = new Error('La franja contiene turnos reservados. Resolvé esos turnos antes de bloquearla.'); error.status = 409; throw error; }
      const created = { id: id(), date, start, end, startAt, endAt, allDay, createdAt: new Date().toISOString() };
      professional.blocks.push(created); audit(db, req.user, 'admin.availability.blocked', { professionalId: professional.id, blockId: created.id }); return created;
    });
    res.status(201).json({ block });
  }

  async deleteBlock(req, res) {
    await store.update(db => {
      const professional = db.professionals.find(item => item.id === req.params.id);
      if (!professional) { const error = new Error('Profesional no encontrado.'); error.status = 404; throw error; }
      professional.blocks = professional.blocks.filter(block => block.id !== req.params.blockId);
      audit(db, req.user, 'admin.availability.unblocked', { professionalId: professional.id, blockId: req.params.blockId });
    });
    res.status(204).end();
  }
}

Controller('api/admin/professionals')(AdminProfessionalsController);
Get('')(AdminProfessionalsController.prototype, 'list', Object.getOwnPropertyDescriptor(AdminProfessionalsController.prototype, 'list'));
Req()(AdminProfessionalsController.prototype, 'list', 0);
Res()(AdminProfessionalsController.prototype, 'list', 1);
UseGuards(new RolesGuard('ADMIN'))(AdminProfessionalsController.prototype, 'list', Object.getOwnPropertyDescriptor(AdminProfessionalsController.prototype, 'list'));
Post('')(AdminProfessionalsController.prototype, 'create', Object.getOwnPropertyDescriptor(AdminProfessionalsController.prototype, 'create'));
Req()(AdminProfessionalsController.prototype, 'create', 0);
Res()(AdminProfessionalsController.prototype, 'create', 1);
UseGuards(new RolesGuard('ADMIN'))(AdminProfessionalsController.prototype, 'create', Object.getOwnPropertyDescriptor(AdminProfessionalsController.prototype, 'create'));
Patch(':id')(AdminProfessionalsController.prototype, 'update', Object.getOwnPropertyDescriptor(AdminProfessionalsController.prototype, 'update'));
Req()(AdminProfessionalsController.prototype, 'update', 0);
Res()(AdminProfessionalsController.prototype, 'update', 1);
UseGuards(new RolesGuard('ADMIN'))(AdminProfessionalsController.prototype, 'update', Object.getOwnPropertyDescriptor(AdminProfessionalsController.prototype, 'update'));
Post(':id/photo')(AdminProfessionalsController.prototype, 'uploadPhoto', Object.getOwnPropertyDescriptor(AdminProfessionalsController.prototype, 'uploadPhoto'));
Req()(AdminProfessionalsController.prototype, 'uploadPhoto', 0);
Res()(AdminProfessionalsController.prototype, 'uploadPhoto', 1);
UseGuards(new RolesGuard('ADMIN'))(AdminProfessionalsController.prototype, 'uploadPhoto', Object.getOwnPropertyDescriptor(AdminProfessionalsController.prototype, 'uploadPhoto'));
Patch(':id/schedule')(AdminProfessionalsController.prototype, 'updateSchedule', Object.getOwnPropertyDescriptor(AdminProfessionalsController.prototype, 'updateSchedule'));
Req()(AdminProfessionalsController.prototype, 'updateSchedule', 0);
Res()(AdminProfessionalsController.prototype, 'updateSchedule', 1);
UseGuards(new RolesGuard('ADMIN'))(AdminProfessionalsController.prototype, 'updateSchedule', Object.getOwnPropertyDescriptor(AdminProfessionalsController.prototype, 'updateSchedule'));
Post(':id/blocks')(AdminProfessionalsController.prototype, 'createBlock', Object.getOwnPropertyDescriptor(AdminProfessionalsController.prototype, 'createBlock'));
Req()(AdminProfessionalsController.prototype, 'createBlock', 0);
Res()(AdminProfessionalsController.prototype, 'createBlock', 1);
UseGuards(new RolesGuard('ADMIN'))(AdminProfessionalsController.prototype, 'createBlock', Object.getOwnPropertyDescriptor(AdminProfessionalsController.prototype, 'createBlock'));
Delete(':id/blocks/:blockId')(AdminProfessionalsController.prototype, 'deleteBlock', Object.getOwnPropertyDescriptor(AdminProfessionalsController.prototype, 'deleteBlock'));
Req()(AdminProfessionalsController.prototype, 'deleteBlock', 0);
Res()(AdminProfessionalsController.prototype, 'deleteBlock', 1);
UseGuards(new RolesGuard('ADMIN'))(AdminProfessionalsController.prototype, 'deleteBlock', Object.getOwnPropertyDescriptor(AdminProfessionalsController.prototype, 'deleteBlock'));

module.exports = { AdminProfessionalsController };
