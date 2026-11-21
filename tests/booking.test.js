const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { JsonStore } = require('../backend/lib/store');
const { hashPassword } = require('../backend/lib/auth');

let server; let baseUrl; let temporaryDirectory; let dataFile; let professionalId;
const password = 'TestPassword!2026';

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { const response = await fetch(`${baseUrl}/api/health`); if (response.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('El servidor de pruebas no inició a tiempo.');
}
async function request(route, { cookie, ...options } = {}) {
  const response = await fetch(`${baseUrl}${route}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(options.headers || {}) } });
  const payload = response.status === 204 ? null : await response.json();
  const setCookie = response.headers.get('set-cookie');
  return { status: response.status, payload, cookie: setCookie?.split(';')[0] };
}

before(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'auravital-test-'));
  dataFile = path.join(temporaryDirectory, 'database.json');
  const port = 18000 + Math.floor(Math.random() * 20000);
  baseUrl = `http://127.0.0.1:${port}`;
  const store = new JsonStore(dataFile);
  const today = new Date();
  const date = new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const adminHash = await hashPassword(password); const professionalHash = await hashPassword(password);
  await store.update(db => {
    db.users.push({ id: 'test-admin', name: 'Test Admin', firstName: 'Test', lastName: 'Admin', email: 'admin@test.invalid', role: 'ADMIN', active: true, passwordHash: adminHash });
    db.users.push({ id: 'test-professional-user', name: 'Dra. Test Profesional', firstName: 'Test', lastName: 'Profesional', email: 'pro@test.invalid', role: 'PROFESSIONAL', active: true, passwordHash: professionalHash });
    professionalId = 'test-professional';
    db.professionals.push({ id: professionalId, userId: 'test-professional-user', name: 'Dra. Test Profesional', specialty: 'Dermatología', description: 'Perfil de pruebas.', price: 12000, durationMinutes: 30, treatments: [{ id: 'test-treatment-short', name: 'Consulta breve', price: 12000, durationMinutes: 30, active: true }, { id: 'test-treatment-long', name: 'Tratamiento extendido', price: 12000, durationMinutes: 45, active: true }], active: true, turnerMode: 'AURA_VITAL', schedule: [{ weekday, start: '10:00', end: '11:00', enabled: true }], blocks: [] });
    db.settings.minBookingHours = 0;
  });
  server = spawn(process.execPath, ['backend/main.js'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: String(port), DATA_STORE: 'json', DATA_FILE: dataFile, SESSION_SECRET: 'integration-tests-only-secret' }, stdio: 'ignore' });
  await waitForServer();
});

after(async () => {
  if (server && !server.killed) server.kill();
  if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true });
});

test('publica los perfiles y protege las rutas administrativas', async () => {
  const publicResult = await request('/api/professionals');
  assert.equal(publicResult.status, 200);
  assert.equal(publicResult.payload.professionals[0].id, professionalId);
  assert.equal('email' in publicResult.payload.professionals[0], false);
  assert.equal('blocks' in publicResult.payload.professionals[0], false);
  assert.equal((await request('/api/admin/professionals')).status, 401);
});

test('registra pacientes y valida credenciales', async () => {
  const registered = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ firstName: 'Paciente', lastName: 'Uno', dni: '12345678', birthDate: '1990-04-12', phone: '+54 9 2923 57-3116', email: 'patient1@test.invalid', password }) });
  assert.equal(registered.status, 201);
  assert.equal(registered.payload.user.role, 'PATIENT');
  assert.ok(registered.cookie);
  assert.equal('passwordHash' in registered.payload.user, false);
  assert.equal(registered.payload.user.dni, '12345678');
  assert.equal(registered.payload.user.birthDate, '1990-04-12');
  assert.equal(registered.payload.user.phone, '+54 9 2923 57-3116');
  const ownProfile = await request('/api/auth/me', { cookie: registered.cookie });
  assert.equal(ownProfile.payload.user.dni, '12345678');
  const savedDatabase = await new JsonStore(dataFile).read();
  const savedPatient = savedDatabase.users.find(user => user.email === 'patient1@test.invalid');
  assert.equal(savedPatient.dni, '12345678');
  assert.equal(savedPatient.birthDate, '1990-04-12');
  assert.equal(savedPatient.phone, '+54 9 2923 57-3116');
  const duplicate = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ firstName: 'Paciente', lastName: 'Duplicado', email: 'patient1@test.invalid', password }) });
  assert.equal(duplicate.status, 409);
  const duplicateDni = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ firstName: 'Otra', lastName: 'Persona', dni: '12345678', email: 'another-patient@test.invalid', password }) });
  assert.equal(duplicateDni.status, 409);
  const invalidDni = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ firstName: 'DNI', lastName: 'Inválido', dni: '12abc678', email: 'invalid-dni@test.invalid', password }) });
  assert.equal(invalidDni.status, 400);
  const invalidLogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'patient1@test.invalid', password: 'not-correct' }) });
  assert.equal(invalidLogin.status, 401);
});

test('cambia la contraseña solo después de verificar la actual', async () => {
  const registered = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ firstName: 'Seguridad', lastName: 'Cuenta', email: 'password@test.invalid', password }) });
  const wrong = await request('/api/account/password', { method: 'POST', cookie: registered.cookie, body: JSON.stringify({ currentPassword: 'wrong-password', newPassword: 'AnotherSecure!2026' }) });
  assert.equal(wrong.status, 401);
  const changed = await request('/api/account/password', { method: 'POST', cookie: registered.cookie, body: JSON.stringify({ currentPassword: password, newPassword: 'AnotherSecure!2026' }) });
  assert.equal(changed.status, 200);
  const oldLogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'password@test.invalid', password }) });
  const newLogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'password@test.invalid', password: 'AnotherSecure!2026' }) });
  assert.equal(oldLogin.status, 401);
  assert.equal(newLogin.status, 200);
});

test('serializa reservas concurrentes y aísla los turnos de cada paciente', async () => {
  const register1 = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ firstName: 'Paciente', lastName: 'Uno', dni: '87654321', birthDate: '1991-05-10', phone: '+54 9 2923 57-3000', email: 'booking1@test.invalid', password }) });
  const register2 = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ firstName: 'Paciente', lastName: 'Dos', email: 'booking2@test.invalid', password }) });
  const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const extendedAvailability = await request(`/api/professionals/${professionalId}/availability?from=${date}&to=${date}&treatmentId=test-treatment-long`);
  assert.deepEqual(extendedAvailability.payload.slots.map(slot => slot.time), ['10:00']);
  const result = await Promise.all([
    request('/api/appointments', { method: 'POST', cookie: register1.cookie, body: JSON.stringify({ professionalId, treatmentId: 'test-treatment-long', date, time: '10:00' }) }),
    request('/api/appointments', { method: 'POST', cookie: register2.cookie, body: JSON.stringify({ professionalId, treatmentId: 'test-treatment-long', date, time: '10:00' }) }),
  ]);
  assert.deepEqual(result.map(item => item.status).sort(), [201, 409]);
  const winner = result.find(item => item.status === 201);
  const loser = result.find(item => item.status === 409);
  assert.ok(winner.payload.appointment.id);
  assert.equal(winner.payload.appointment.treatmentName, 'Tratamiento extendido');
  assert.equal(winner.payload.appointment.durationMinutes, 45);
  assert.equal(loser.payload.error, 'Ese horario ya no está disponible. Elegí otro.');
  const mine = await request('/api/appointments', { cookie: winner === result[0] ? register1.cookie : register2.cookie });
  const other = await request('/api/appointments', { cookie: winner === result[0] ? register2.cookie : register1.cookie });
  assert.equal(mine.payload.appointments.length, 1);
  assert.equal(other.payload.appointments.length, 0);
  const admin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@test.invalid', password }) });
  const adminAppointments = await request('/api/appointments', { cookie: admin.cookie });
  const patientData = adminAppointments.payload.appointments.find(item => item.patient?.email === 'booking1@test.invalid')?.patient;
  assert.ok(patientData);
  assert.equal('dni' in patientData, false);
  assert.equal('birthDate' in patientData, false);
  assert.equal('phone' in patientData, false);
});

test('profesionales ven únicamente sus turnos y pueden gestionar su agenda', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'pro@test.invalid', password }) });
  assert.equal(login.status, 200);
  const profile = await request('/api/professional/me', { cookie: login.cookie });
  assert.equal(profile.status, 200);
  const savedTreatments = await request('/api/professional/me/settings', { method: 'PATCH', cookie: login.cookie, body: JSON.stringify({ price: 25000, durationMinutes: 45, treatments: [{ id: 'test-treatment', name: 'Consulta dermatológica', durationMinutes: 45, price: 25000, active: true }] }) });
  assert.equal(savedTreatments.status, 200);
  assert.equal(savedTreatments.payload.professional.treatments[0].name, 'Consulta dermatológica');
  assert.equal(savedTreatments.payload.professional.price, 25000);
  const publicProfile = (await request('/api/professionals')).payload.professionals.find(item => item.id === professionalId);
  assert.equal(publicProfile.treatments[0].price, 25000);
  const pactDate = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const dateSchedule = await request('/api/professional/me/date-schedule', { method: 'PATCH', cookie: login.cookie, body: JSON.stringify({ dateSchedules: [{ date: pactDate, intervals: [{ start: '13:00', end: '14:00', enabled: true }] }] }) });
  assert.equal(dateSchedule.status, 200);
  const pactAvailability = await request(`/api/professionals/${professionalId}/availability?from=${pactDate}&to=${pactDate}&treatmentId=test-treatment`);
  assert.deepEqual(pactAvailability.payload.slots.map(slot => slot.time), ['13:00']);
  const appointments = await request('/api/appointments', { cookie: login.cookie });
  assert.equal(appointments.status, 200);
  assert.ok(appointments.payload.appointments.every(item => item.professionalId === professionalId));
  const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const blocked = await request('/api/professional/me/blocks', { method: 'POST', cookie: login.cookie, body: JSON.stringify({ date, start: '10:00', end: '10:30' }) });
  assert.equal(blocked.status, 409);
  const completed = await request(`/api/appointments/${appointments.payload.appointments[0].id}/status`, { method: 'PATCH', cookie: login.cookie, body: JSON.stringify({ status: 'completed' }) });
  assert.equal(completed.status, 200);
  assert.equal((await request('/api/admin/stats', { cookie: login.cookie })).status, 403);
});

test('administradores pueden acceder a estadísticas; el turnero BlipDoc queda separado', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@test.invalid', password }) });
  const stats = await request('/api/admin/stats', { cookie: login.cookie });
  assert.equal(stats.status, 200);
  assert.equal(stats.payload.completed, 1);
  assert.equal(stats.payload.revenue, 12000);
});

test('el administrador crea un perfil BlipDoc y el público recibe su enlace externo', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@test.invalid', password }) });
  const created = await request('/api/admin/professionals', { method: 'POST', cookie: login.cookie, body: JSON.stringify({ name: 'Dra. Blip Test', specialty: 'Dermoestética', email: 'blip@test.invalid', password, price: 15000, durationMinutes: 30, turnerMode: 'BLIPDOC', blipdocUrl: 'https://example.invalid/agenda' }) });
  assert.equal(created.status, 201);
  assert.equal(created.payload.professional.turnerMode, 'BLIPDOC');
  const publicProfiles = await request('/api/professionals');
  const publicProfile = publicProfiles.payload.professionals.find(item => item.id === created.payload.professional.id);
  assert.equal(publicProfile.blipdocUrl, 'https://example.invalid/agenda');
  assert.equal(publicProfile.price, 0, 'El administrador no fija el valor de los tratamientos.');
  await request(`/api/admin/professionals/${publicProfile.id}`, { method: 'PATCH', cookie: login.cookie, body: JSON.stringify({ price: 45000, durationMinutes: 60 }) });
  const unchangedProfile = (await request('/api/professionals')).payload.professionals.find(item => item.id === publicProfile.id);
  assert.equal(unchangedProfile.price, 0);
  assert.equal((await request(`/api/professionals/${publicProfile.id}/availability`)).status, 409);
});
