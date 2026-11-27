const { parseDate, nowArgentinaParts, timeMinutes, overlaps } = require('./dates');

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

module.exports = { validSchedule, validDateSchedules };
