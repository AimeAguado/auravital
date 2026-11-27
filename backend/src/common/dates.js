const { timezone } = require('../../lib/config');
const { ACTIVE_APPOINTMENT_STATES } = require('./constants');

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

module.exports = { parseDate, weekdayFor, toArgentinaInstant, dateInArgentina, nowArgentinaParts, timeMinutes, overlaps, listSlots };
