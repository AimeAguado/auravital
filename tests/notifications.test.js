const { test } = require('node:test');
const assert = require('node:assert/strict');
const { appointmentEmail, sendResendEmail, createNotificationWorker } = require('../backend/lib/notifications');

test('arma correo de confirmación escapando datos reales del turno', () => {
  const email = appointmentEmail(
    { date: '2027-02-18', time: '10:30', treatmentName: '<Consulta>', price: 2000 },
    { name: 'Ana & Juan', email: 'ana@example.test' },
    { name: 'Dra. <Lugo>', specialty: 'Dermatología' },
  );
  assert.match(email.subject, /turno está confirmado/);
  assert.match(email.text, /10:30/);
  assert.match(email.html, /Ana &amp; Juan/);
  assert.match(email.html, /&lt;Consulta&gt;/);
  assert.match(email.html, /&lt;Lugo&gt;/);
});

test('envía correo por la API de Resend con clave de idempotencia', async () => {
  let request;
  const result = await sendResendEmail({ to: 'patient@example.test', subject: 'Turno', html: '<p>Hola</p>', text: 'Hola', idempotencyKey: 'appointment-1' }, {
    apiKey: 'test-key', from: 'Aura Vital <turnos@example.test>',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ id: 'email-1' }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(result.id, 'email-1');
  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.options.headers.Authorization, 'Bearer test-key');
  assert.equal(request.options.headers['Idempotency-Key'], 'appointment-1');
  assert.deepEqual(JSON.parse(request.options.body).to, ['patient@example.test']);
});

test('manda recordatorio dentro de las 24 horas y lo registra para no duplicarlo', async () => {
  const now = Date.now();
  const database = {
    appointments: [{ id: 'appointment-1', patientId: 'patient-1', professionalId: 'professional-1', date: '2027-02-18', time: '10:30', startAt: new Date(now + 20 * 60 * 60 * 1000).toISOString(), status: 'confirmed', confirmationEmailStatus: 'sent', reminderEmailStatus: 'pending' }],
    users: [{ id: 'patient-1', name: 'Ana', email: 'ana@example.test' }],
    professionals: [{ id: 'professional-1', name: 'Dra. Lugo', specialty: 'Dermatología' }],
  };
  const store = {
    read: async () => structuredClone(database),
    update: async mutate => mutate(database),
  };
  const sent = [];
  const worker = createNotificationWorker(store, { send: async payload => { sent.push(payload); } });
  await worker.process(now);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /Recordatorio/);
  assert.equal(database.appointments[0].reminderEmailStatus, 'sent');
  await worker.process(now);
  assert.equal(sent.length, 1);
});

test('no manda recordatorio para un turno que sigue pendiente', async () => {
  const now = Date.now();
  const database = {
    appointments: [{ id: 'pending-appointment', patientId: 'patient-1', professionalId: 'professional-1', startAt: new Date(now + 3 * 60 * 60 * 1000).toISOString(), status: 'pending', confirmationEmailStatus: undefined, reminderEmailStatus: 'pending' }],
    users: [{ id: 'patient-1', email: 'ana@example.test' }],
    professionals: [{ id: 'professional-1', name: 'Dra. Lugo', specialty: 'Dermatología' }],
  };
  const store = { read: async () => structuredClone(database), update: async mutate => mutate(database) };
  let sends = 0;
  await createNotificationWorker(store, { send: async () => { sends++; } }).process(now);
  assert.equal(sends, 0);
  assert.equal(database.appointments[0].reminderEmailStatus, 'pending');
});
