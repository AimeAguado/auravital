const crypto = require('node:crypto');

const id = () => crypto.randomUUID();
const cleanText = (value, max = 300) => typeof value === 'string' ? value.trim().slice(0, max) : '';

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

module.exports = { id, cleanText, publicUser, privateUser, publicProfessional };
