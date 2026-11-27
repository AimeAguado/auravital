const ACTIVE_APPOINTMENT_STATES = new Set(['pending', 'confirmed']);
const APPOINTMENT_STATES = new Set(['pending', 'confirmed', 'cancelled', 'completed', 'no_show']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = { ACTIVE_APPOINTMENT_STATES, APPOINTMENT_STATES, EMAIL_RE };
