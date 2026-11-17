const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { JsonStore } = require('../lib/store');
const { hashPassword } = require('../lib/auth');

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
    db.professionals.push({ id: professionalId, userId: 'test-professional-user', name: 'Dra. Test Profesional', specialty: 'Dermatología', description: 'Perfil de pruebas.', price: 12000, durationMinutes: 30, active: true, turnerMode: 'AURA_VITAL', schedule: [{ weekday, start: '10:00', end: '11:00', enabled: true }], blocks: [] });
    db.settings.minBookingHours = 0;
  });
  server = spawn(process.execPath, ['server.js'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: String(port), DATA_STORE: 'json', DATA_FILE: dataFile, SESSION_SECRET: 'integration-tests-only-secret' }, stdio: 'ignore' });
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
  const registered = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ firstName: 'Paciente', lastName: 'Uno', email: 'patient1@test.invalid', password }) });
  assert.equal(registered.status, 201);
  assert.equal(registered.payload.user.role, 'PATIENT');
  assert.ok(registered.cookie);
  assert.equal('passwordHash' in registered.payload.user, false);
  const duplicate = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ firstName: 'Paciente', lastName: 'Duplicado', email: 'patient1@test.invalid', password }) });
  assert.equal(duplicate.status, 409);
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
  const register1 = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ firstName: 'Paciente', lastName: 'Uno', email: 'booking1@test.invalid', password }) });
  const register2 = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ firstName: 'Paciente', lastName: 'Dos', email: 'booking2@test.invalid', password }) });
  const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const result = await Promise.all([
    request('/api/appointments', { method: 'POST', cookie: register1.cookie, body: JSON.stringify({ professionalId, date, time: '10:00' }) }),
    request('/api/appointments', { method: 'POST', cookie: register2.cookie, body: JSON.stringify({ professionalId, date, time: '10:00' }) }),
  ]);
  assert.deepEqual(result.map(item => item.status).sort(), [201, 409]);
  const winner = result.find(item => item.status === 201);
  const loser = result.find(item => item.status === 409);
  assert.ok(winner.payload.appointment.id);
  assert.equal(loser.payload.error, 'Ese horario ya no está disponible. Elegí otro.');
  const mine = await request('/api/appointments', { cookie: winner === result[0] ? register1.cookie : register2.cookie });
  const other = await request('/api/appointments', { cookie: winner === result[0] ? register2.cookie : register1.cookie });
  assert.equal(mine.payload.appointments.length, 1);
  assert.equal(other.payload.appointments.length, 0);
});

test('profesionales ven únicamente sus turnos y pueden gestionar su agenda', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'pro@test.invalid', password }) });
  assert.equal(login.status, 200);
  const profile = await request('/api/professional/me', { cookie: login.cookie });
  assert.equal(profile.status, 200);
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
  assert.equal((await request(`/api/professionals/${publicProfile.id}/availability`)).status, 409);
});
