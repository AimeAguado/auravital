const { resendApiKey, resendFromEmail } = require('./config');

const DAY_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const CLAIM_STALE_MS = 15 * 60 * 1000;

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const formattedDate = date => new Intl.DateTimeFormat('es-AR', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

function appointmentEmail(appointment, patient, professional, reminder = false) {
  const name = patient.name || `${patient.firstName || ''} ${patient.lastName || ''}`.trim() || 'Hola';
  const date = formattedDate(appointment.date);
  const subject = reminder ? `Recordatorio de tu turno en Aura Vital · ${date}` : `Tu turno está confirmado · Aura Vital`;
  const heading = reminder ? 'Mañana te esperamos en Aura Vital' : 'Tu turno está confirmado';
  const opening = reminder ? 'Te recordamos los datos de tu próximo turno.' : 'Confirmamos tu turno. Te esperamos en Aura Vital.';
  const rows = [
    ['Profesional', professional.name],
    ['Atención', appointment.treatmentName || professional.specialty],
    ['Fecha', date],
    ['Hora', appointment.time],
    ['Dirección', 'Libertad 351, Darregueira, Buenos Aires'],
  ];
  const text = `${name},\n\n${opening}\n\n${rows.map(([label, value]) => `${label}: ${value}`).join('\n')}\n\nAura Vital · Salud & Estética`;
  const htmlRows = rows.map(([label, value]) => `<tr><th align="left" style="padding:10px 12px;color:#657166;font-weight:500;border-bottom:1px solid #e8e9e2">${escapeHtml(label)}</th><td style="padding:10px 12px;color:#2f3e34;border-bottom:1px solid #e8e9e2">${escapeHtml(value)}</td></tr>`).join('');
  const html = `<div style="margin:0;background:#f7f6f0;padding:32px 16px;font-family:Arial,sans-serif;color:#2f3e34"><div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e2e3da;border-radius:16px;overflow:hidden"><div style="padding:28px 32px;background:#e9ebe2"><p style="margin:0 0 8px;color:#60735f;font-size:12px;letter-spacing:2px;text-transform:uppercase">Aura Vital · Darregueira</p><h1 style="margin:0;font-size:27px;font-weight:500">${escapeHtml(heading)}</h1></div><div style="padding:28px 32px"><p style="font-size:16px">${escapeHtml(name)},</p><p style="color:#68756c;line-height:1.6">${escapeHtml(opening)}</p><table role="presentation" style="width:100%;border-collapse:collapse;margin-top:20px">${htmlRows}</table><p style="margin:24px 0 0;color:#68756c;font-size:13px">Si necesitás ayuda, respondé este correo o comunicate con Aura Vital.</p></div></div></div>`;
  return { subject, text, html };
}

async function sendResendEmail({ to, subject, html, text, idempotencyKey }, { apiKey = resendApiKey, from = resendFromEmail, fetchImpl = fetch } = {}) {
  if (!apiKey || !from) throw new Error('Resend no está configurado. Definí RESEND_API_KEY y RESEND_FROM_EMAIL.');
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || `Resend rechazó el correo (HTTP ${response.status}).`);
  return result;
}

function createNotificationWorker(store, options = {}) {
  const send = options.send || sendResendEmail;
  let running = false;

  async function deliver(kind, now = Date.now()) {
    const db = await store.read();
    const appointment = db.appointments.find(item => {
      if (kind === 'confirmation') return item.confirmationEmailStatus === 'pending' && item.status === 'confirmed' && (now - Date.parse(item.confirmationEmailAttemptedAt || 0) >= RETRY_MS);
      const startAt = Date.parse(item.startAt);
      const status = item.reminderEmailStatus;
      const availableToRetry = status === 'pending' && now - Date.parse(item.reminderEmailAttemptedAt || 0) >= RETRY_MS;
      const staleClaim = status === 'sending' && now - Date.parse(item.reminderEmailAttemptedAt || 0) >= CLAIM_STALE_MS;
      return (availableToRetry || staleClaim) && item.status === 'confirmed' && startAt > now && startAt <= now + DAY_MS;
    });
    if (!appointment) return false;

    const claimed = await store.update(database => {
      const item = database.appointments.find(record => record.id === appointment.id);
      if (!item) return null;
      const statusKey = kind === 'confirmation' ? 'confirmationEmailStatus' : 'reminderEmailStatus';
      const attemptKey = kind === 'confirmation' ? 'confirmationEmailAttemptedAt' : 'reminderEmailAttemptedAt';
      const currentStatus = item[statusKey];
      const lastAttempt = Date.parse(item[attemptKey] || 0);
      const eligible = kind === 'confirmation'
        ? currentStatus === 'pending' && item.status === 'confirmed' && now - lastAttempt >= RETRY_MS
        : (currentStatus === 'pending' && now - lastAttempt >= RETRY_MS || currentStatus === 'sending' && now - lastAttempt >= CLAIM_STALE_MS) && item.status === 'confirmed' && Date.parse(item.startAt) > now && Date.parse(item.startAt) <= now + DAY_MS;
      if (!eligible) return null;
      item[statusKey] = 'sending';
      item[attemptKey] = new Date(now).toISOString();
      const patient = database.users.find(user => user.id === item.patientId);
      const professional = database.professionals.find(record => record.id === item.professionalId);
      if (!patient?.email || !professional) { item[statusKey] = 'pending'; item[`${kind}EmailError`] = 'No se encontró el correo del paciente o el profesional.'; return null; }
      return { appointment: item, patient, professional };
    });
    if (!claimed) return true;

    const content = appointmentEmail(claimed.appointment, claimed.patient, claimed.professional, kind === 'reminder');
    const statusKey = kind === 'confirmation' ? 'confirmationEmailStatus' : 'reminderEmailStatus';
    try {
      const eventId = kind === 'confirmation' ? claimed.appointment.confirmationEmailEvent || claimed.appointment.id : claimed.appointment.id;
      await send({ to: claimed.patient.email, ...content, idempotencyKey: `auravital-${kind}-${eventId}` }, options.resendOptions);
      await store.update(database => {
        const item = database.appointments.find(record => record.id === claimed.appointment.id);
        if (item) { item[statusKey] = 'sent'; item[`${kind}EmailSentAt`] = new Date().toISOString(); delete item[`${kind}EmailError`]; }
      });
    } catch (error) {
      await store.update(database => {
        const item = database.appointments.find(record => record.id === claimed.appointment.id);
        if (item) { item[statusKey] = 'pending'; item[`${kind}EmailError`] = String(error.message || error).slice(0, 300); }
      });
      options.logger?.error?.(`No se pudo enviar el correo ${kind} para el turno ${claimed.appointment.id}: ${error.message}`);
    }
    return true;
  }

  async function process(now = Date.now()) {
    if (running) return;
    running = true;
    try {
      for (let count = 0; count < 50; count++) {
        const sentConfirmation = await deliver('confirmation', now);
        if (sentConfirmation) continue;
        const sentReminder = await deliver('reminder', now);
        if (!sentReminder) break;
      }
    } finally { running = false; }
  }

  function start(intervalMs = 60_000) {
    const timer = setInterval(() => process().catch(error => options.logger?.error?.(`Error en cola de correos: ${error.message}`)), intervalMs);
    timer.unref?.();
    process().catch(error => options.logger?.error?.(`Error en cola de correos: ${error.message}`));
    return timer;
  }
  return { process, start };
}

module.exports = { appointmentEmail, sendResendEmail, createNotificationWorker };
