const express = require('express');
const crypto = require('node:crypto');
const { timezone } = require('../lib/config');
const { store } = require('../lib/store');
const { hashPassword, verifyPassword, setSession, clearSession, sessionUserId } = require('../lib/auth');

const app = express();
const ACTIVE_APPOINTMENT_STATES = new Set(['pending', 'confirmed']);
const APPOINTMENT_STATES = new Set(['pending', 'confirmed', 'cancelled', 'completed', 'no_show']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const loginAttempts = new Map();
const id = () => crypto.randomUUID();
const cleanText = (value, max = 300) => typeof value === 'string' ? value.trim().slice(0, max) : '';

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.use(express.json({ limit: '256kb' }));
app.use((req, _res, next) => {
  req.cookies = {};
  for (const entry of (req.headers.cookie || '').split(';')) {
    const index = entry.indexOf('=');
    if (index > 0) req.cookies[entry.slice(0, index).trim()] = decodeURIComponent(entry.slice(index + 1).trim());
  }
  next();
});
app.use('/api', (req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.get('origin');
    if (origin && origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: 'Origen no permitido.' });
  }
  next();
});

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, dni, birthDate, phone, ...safe } = user;
  return safe;
}

function privateUser(user) {
  if (!user) return null;
  return { ...publicUser(user), dni: user.dni || '', birthDate: user.birthDate || '', phone: user.phone || '' };
}

function publicProfessional(professional, user, includePrivate = false) {
  const treatments = Array.isArray(professional.treatments)
    ? professional.treatments
    : [{ id: 'default', name: professional.specialty, durationMinutes: professional.durationMinutes, price: professional.price, active: true }];
  return {
    id: professional.id,
    name: professional.name,
    specialty: professional.specialty,
    description: professional.description,
    photo: professional.photo,
    price: professional.price,
    durationMinutes: professional.durationMinutes,
    treatments: treatments.filter(item => includePrivate || item.active !== false),
    active: professional.active,
    turnerMode: professional.turnerMode,
    blipdocUrl: professional.turnerMode === 'BLIPDOC' ? professional.blipdocUrl : null,
    email: includePrivate ? (user?.email || null) : undefined,
    schedule: includePrivate ? (professional.schedule || []) : undefined,
    dateSchedules: includePrivate ? (professional.dateSchedules || []) : undefined,
    blocks: includePrivate ? (professional.blocks || []) : undefined,
  };
}

function audit(database, actor, action, details = {}) {
  database.audit.push({ id: id(), actorId: actor.id, actorRole: actor.role, action, details, at: new Date().toISOString() });
  if (database.audit.length > 10000) database.audit.splice(0, database.audit.length - 10000);
}

async function loadUser(req, _res, next) {
  const userId = sessionUserId(req);
  if (!userId) { req.user = null; return next(); }
  const db = await store.read();
  req.user = db.users.find(user => user.id === userId && user.active !== false) || null;
  next();
}
app.use('/api', loadUser);

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Iniciá sesión para continuar.' });
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Iniciá sesión para continuar.' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'No tenés permisos para realizar esta acción.' });
    next();
  };
}
function getProfessionalForUser(db, user) {
  return db.professionals.find(professional => professional.userId === user.id) || null;
}
function parseDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  const value = new Date(`${date}T12:00:00Z`);
  return value.toISOString().slice(0, 10) === date ? value : null;
}
function weekdayFor(date) { return parseDate(date)?.getUTCDay(); }
function toArgentinaInstant(date, time) { return new Date(`${date}T${time}:00-03:00`); }
function dateInArgentina(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function nowArgentinaParts() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const result = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { date: `${result.year}-${result.month}-${result.day}`, time: `${result.hour}:${result.minute}` };
}
function timeMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || '');
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
}
function overlaps(startA, endA, startB, endB) { return startA < endB && startB < endA; }
function validSchedule(schedule) {
  if (!Array.isArray(schedule) || schedule.length > 35) return false;
  const grouped = new Map();
  for (const item of schedule) {
    const weekday = Number(item.weekday); const start = timeMinutes(item.start); const end = timeMinutes(item.end);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
    const entries = grouped.get(weekday) || [];
    if (entries.some(entry => overlaps(start, end, entry.start, entry.end))) return false;
    entries.push({ start, end }); grouped.set(weekday, entries);
  }
  return true;
}
function validDateSchedules(dateSchedules) {
  if (!Array.isArray(dateSchedules) || dateSchedules.length > 366) return false;
  const dates = new Set(); const today = nowArgentinaParts().date;
  for (const day of dateSchedules) {
    if (!parseDate(day.date) || day.date < today || day.date > new Date(Date.now() + 366 * 86400000).toISOString().slice(0, 10) || dates.has(day.date) || !Array.isArray(day.intervals) || day.intervals.length > 10) return false;
    dates.add(day.date);
    const ranges = [];
    for (const interval of day.intervals) {
      const start = timeMinutes(interval.start); const end = timeMinutes(interval.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
      if (ranges.some(range => overlaps(start, end, range.start, range.end))) return false;
      ranges.push({ start, end });
    }
  }
  return true;
}

function listSlots(db, professional, date, durationOverride) {
  const weekday = weekdayFor(date);
  if (weekday === undefined) return [];
  const dateSchedule = (professional.dateSchedules || []).find(item => item.date === date);
  const scheduleForDate = dateSchedule ? dateSchedule.intervals : professional.schedule.filter(item => Number(item.weekday) === weekday);
  const daySchedules = scheduleForDate.filter(item => item.enabled !== false);
  const slots = [];
  const duration = Number(durationOverride ?? professional.durationMinutes);
  if (!Number.isInteger(duration) || duration < 10 || duration > 240) return slots;
  for (const schedule of daySchedules) {
    let start = timeMinutes(schedule.start);
    const end = timeMinutes(schedule.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    while (start + duration <= end) {
      const startTime = `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
      const finish = start + duration;
      const endTime = `${String(Math.floor(finish / 60)).padStart(2, '0')}:${String(finish % 60).padStart(2, '0')}`;
      const startAt = toArgentinaInstant(date, startTime);
      const endAt = toArgentinaInstant(date, endTime);
      const blocked = professional.blocks.some(block => block.startAt < endAt.toISOString() && block.endAt > startAt.toISOString());
      const occupied = db.appointments.some(appointment => appointment.professionalId === professional.id && ACTIVE_APPOINTMENT_STATES.has(appointment.status) && appointment.startAt < endAt.toISOString() && appointment.endAt > startAt.toISOString());
      const earliest = new Date(Date.now() + Number(db.settings.minBookingHours || 0) * 3600000);
      const latest = new Date(Date.now() + Number(db.settings.maxBookingDays || 90) * 86400000);
      if (!blocked && !occupied && startAt >= earliest && startAt <= latest) slots.push({ date, time: startTime, startAt: startAt.toISOString(), endAt: endAt.toISOString() });
      start += duration;
    }
  }
  return slots.sort((a, b) => a.time.localeCompare(b.time));
}

app.post('/api/auth/register', async (req, res, next) => {
  try {
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
  } catch (error) { next(error); }
});
app.post('/api/auth/login', async (req, res, next) => {
  try {
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
    res.json({ user: privateUser(user) });
  } catch (error) { next(error); }
});
app.post('/api/auth/logout', (_req, res) => { clearSession(res); res.status(204).end(); });
app.get('/api/auth/me', (req, res) => res.json({ user: privateUser(req.user) }));
app.patch('/api/profile', requireRole('PATIENT'), async (req, res, next) => {
  try {
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
  } catch (error) { next(error); }
});
app.post('/api/account/password', requireAuth, async (req, res, next) => {
  try {
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
    res.json({ changed });
  } catch (error) { next(error); }
});

app.get('/api/professionals', async (_req, res) => {
  const db = await store.read();
  res.json({ professionals: db.professionals.filter(item => item.active).map(item => publicProfessional(item)) });
});
app.get('/api/professionals/:id/availability', async (req, res) => {
  const db = await store.read();
  const professional = db.professionals.find(item => item.id === req.params.id && item.active);
  if (!professional) return res.status(404).json({ error: 'Profesional no encontrado.' });
  if (professional.turnerMode !== 'AURA_VITAL') return res.status(409).json({ error: 'Este profesional gestiona turnos desde un turnero externo.', externalUrl: professional.blipdocUrl });
  const treatments = publicProfessional(professional).treatments;
  const treatment = req.query.treatmentId ? treatments.find(item => item.id === req.query.treatmentId) : null;
  if (req.query.treatmentId && !treatment) return res.status(400).json({ error: 'El tratamiento elegido ya no está disponible. Elegí otro.' });
  const from = parseDate(req.query.from) ? req.query.from : nowArgentinaParts().date;
  const fromDate = parseDate(from);
  const to = parseDate(req.query.to) ? req.query.to : new Date(fromDate.getTime() + 14 * 86400000).toISOString().slice(0, 10);
  if (to < from || to > new Date(fromDate.getTime() + 90 * 86400000).toISOString().slice(0, 10)) return res.status(400).json({ error: 'El rango solicitado debe ser de hasta 90 días.' });
  const slots = [];
  for (let day = fromDate; day <= parseDate(to); day = new Date(day.getTime() + 86400000)) slots.push(...listSlots(db, professional, day.toISOString().slice(0, 10), treatment?.durationMinutes));
  res.json({ professional: publicProfessional(professional), treatment, slots, timezone });
});

app.post('/api/appointments', requireRole('PATIENT'), async (req, res, next) => {
  try {
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
      const created = { id: id(), professionalId, patientId: req.user.id, date, time, startAt: slot.startAt, endAt: slot.endAt, price: Number(treatment.price), treatmentId: treatment.id, treatmentName: treatment.name, durationMinutes: Number(treatment.durationMinutes), status: 'pending', source: 'AURA_VITAL', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      db.appointments.push(created);
      audit(db, req.user, 'appointment.created', { appointmentId: created.id, professionalId, date, time });
      return created;
    });
    res.status(201).json({ appointment });
  } catch (error) { next(error); }
});

function canViewAppointment(user, appointment, db) {
  if (user.role === 'ADMIN') return true;
  if (user.role === 'PATIENT') return appointment.patientId === user.id;
  const professional = getProfessionalForUser(db, user);
  return professional && appointment.professionalId === professional.id;
}
app.get('/api/appointments', requireAuth, async (req, res) => {
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
    professional: (() => { const professional = db.professionals.find(p => p.id === item.professionalId); const user = professional && db.users.find(u => u.id === professional.userId); return professional ? { id: professional.id, name: professional.name, specialty: professional.specialty } : null; })(),
    patient: req.user.role === 'PATIENT' ? undefined : publicUser(db.users.find(user => user.id === item.patientId)),
  })).sort((a, b) => a.startAt.localeCompare(b.startAt));
  res.json({ appointments: hydrated, timezone });
});
app.post('/api/admin/appointments', requireRole('ADMIN'), async (req, res, next) => {
  try {
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
      const created = { id: id(), professionalId, patientId: patient.id, date, time, startAt, endAt, price, status: 'confirmed', source, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: req.user.id };
      db.appointments.push(created); audit(db, req.user, 'admin.appointment.created', { appointmentId: created.id, professionalId, patientId: patient.id, source }); return created;
    });
    res.status(201).json({ appointment });
  } catch (error) { next(error); }
});
app.patch('/api/admin/appointments/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
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
      if (req.body.status && APPOINTMENT_STATES.has(req.body.status)) item.status = req.body.status;
      item.updatedAt = new Date().toISOString(); audit(db, req.user, 'admin.appointment.updated', { appointmentId: item.id, from: old, to: { professionalId: item.professionalId, patientId: item.patientId, date: item.date, time: item.time } }); return item;
    });
    res.json({ appointment });
  } catch (error) { next(error); }
});
app.patch('/api/appointments/:id/status', requireAuth, async (req, res, next) => {
  try {
    const status = req.body.status;
    if (!APPOINTMENT_STATES.has(status)) return res.status(400).json({ error: 'Estado de turno inválido.' });
    const appointment = await store.update(db => {
      const item = db.appointments.find(record => record.id === req.params.id);
      if (!item || !canViewAppointment(req.user, item, db)) { const error = new Error('Turno no encontrado.'); error.status = 404; throw error; }
      if (req.user.role === 'PATIENT') {
        if (status !== 'cancelled' || !ACTIVE_APPOINTMENT_STATES.has(item.status)) { const error = new Error('No podés realizar ese cambio en el turno.'); error.status = 403; throw error; }
        const cancelHours = Number(db.settings.cancellationHours || 0);
        if (new Date(item.startAt).getTime() - Date.now() < cancelHours * 3600000) { const error = new Error(`Los turnos deben cancelarse con al menos ${cancelHours} horas de anticipación.`); error.status = 409; throw error; }
      } else if (req.user.role === 'PROFESSIONAL' && !['confirmed', 'cancelled', 'completed', 'no_show'].includes(status)) {
        const error = new Error('Estado no permitido para el profesional.'); error.status = 403; throw error;
      }
      const oldStatus = item.status;
      if (ACTIVE_APPOINTMENT_STATES.has(status) && !ACTIVE_APPOINTMENT_STATES.has(oldStatus)) {
        const professional = db.professionals.find(record => record.id === item.professionalId);
        if (professional?.turnerMode === 'AURA_VITAL' && !listSlots(db, professional, item.date).some(slot => slot.time === item.time)) { const error = new Error('No se puede reactivar el turno: el horario ya no está disponible.'); error.status = 409; throw error; }
      }
      item.status = status; item.updatedAt = new Date().toISOString();
      audit(db, req.user, 'appointment.status.changed', { appointmentId: item.id, from: oldStatus, to: status });
      return item;
    });
    res.json({ appointment });
  } catch (error) { next(error); }
});

app.get('/api/professional/me', requireRole('PROFESSIONAL'), async (req, res) => {
  const db = await store.read(); const professional = getProfessionalForUser(db, req.user);
  if (!professional) return res.status(404).json({ error: 'No se encontró el perfil profesional.' });
  res.json({ professional: publicProfessional(professional, req.user, true) });
});
app.patch('/api/professional/me/settings', requireRole('PROFESSIONAL'), async (req, res, next) => {
  try {
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
  } catch (error) { next(error); }
});
app.patch('/api/professional/me/schedule', requireRole('PROFESSIONAL'), async (req, res, next) => {
  try {
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
  } catch (error) { next(error); }
});
app.patch('/api/professional/me/date-schedule', requireRole('PROFESSIONAL'), async (req, res, next) => {
  try {
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
  } catch (error) { next(error); }
});
app.post('/api/professional/me/blocks', requireRole('PROFESSIONAL'), async (req, res, next) => {
  try {
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
  } catch (error) { next(error); }
});
app.delete('/api/professional/me/blocks/:id', requireRole('PROFESSIONAL'), async (req, res, next) => {
  try {
    await store.update(db => {
      const professional = getProfessionalForUser(db, req.user);
      if (!professional) { const error = new Error('Perfil profesional no encontrado.'); error.status = 404; throw error; }
      professional.blocks = professional.blocks.filter(block => block.id !== req.params.id);
      audit(db, req.user, 'professional.availability.unblocked', { professionalId: professional.id, blockId: req.params.id });
    });
    res.status(204).end();
  } catch (error) { next(error); }
});

app.get('/api/admin/professionals', requireRole('ADMIN'), async (_req, res) => {
  const db = await store.read();
  res.json({ professionals: db.professionals.map(professional => publicProfessional(professional, db.users.find(user => user.id === professional.userId), true)) });
});
app.post('/api/admin/professionals', requireRole('ADMIN'), async (req, res, next) => {
  try {
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
  } catch (error) { next(error); }
});
app.patch('/api/admin/professionals/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
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
  } catch (error) { next(error); }
});
app.patch('/api/admin/professionals/:id/schedule', requireRole('ADMIN'), async (req, res, next) => {
  try {
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
  } catch (error) { next(error); }
});
app.post('/api/admin/professionals/:id/blocks', requireRole('ADMIN'), async (req, res, next) => {
  try {
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
  } catch (error) { next(error); }
});
app.delete('/api/admin/professionals/:id/blocks/:blockId', requireRole('ADMIN'), async (req, res, next) => {
  try {
    await store.update(db => {
      const professional = db.professionals.find(item => item.id === req.params.id);
      if (!professional) { const error = new Error('Profesional no encontrado.'); error.status = 404; throw error; }
      professional.blocks = professional.blocks.filter(block => block.id !== req.params.blockId);
      audit(db, req.user, 'admin.availability.unblocked', { professionalId: professional.id, blockId: req.params.blockId });
    });
    res.status(204).end();
  } catch (error) { next(error); }
});
app.get('/api/admin/audit', requireRole('ADMIN'), async (_req, res) => {
  const db = await store.read(); res.json({ audit: db.audit.slice(-500).reverse() });
});
app.get('/api/admin/stats', requireRole('ADMIN'), async (req, res) => {
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
});
app.get('/api/admin/settings', requireRole('ADMIN'), async (_req, res) => { const db = await store.read(); res.json({ settings: db.settings }); });
app.patch('/api/admin/settings', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const cancellationHours = Number(req.body.cancellationHours); const minBookingHours = Number(req.body.minBookingHours); const maxBookingDays = Number(req.body.maxBookingDays);
    if (![cancellationHours, minBookingHours, maxBookingDays].every(Number.isFinite) || cancellationHours < 0 || cancellationHours > 720 || minBookingHours < 0 || minBookingHours > 720 || maxBookingDays < 1 || maxBookingDays > 365) return res.status(400).json({ error: 'Revisá las reglas de anticipación.' });
    const settings = await store.update(db => { db.settings = { cancellationHours, minBookingHours, maxBookingDays }; audit(db, req.user, 'admin.settings.updated'); return db.settings; });
    res.json({ settings });
  } catch (error) { next(error); }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta de API no encontrada.' }));
app.use((error, _req, res, _next) => {
  const status = Number(error.status) || 500;
  if (status >= 500) console.error(`${error.name || 'Error'}: ${String(error.message || '').replace(/mongodb(?:\+srv)?:\/\/[^@/]+@/gi, 'mongodb://***@').slice(0, 300)}`);
  res.status(status).json({ error: status >= 500 ? 'Ocurrió un error interno. Intentá nuevamente.' : error.message });
});

module.exports = app;
