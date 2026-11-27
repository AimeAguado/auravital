function getProfessionalForUser(db, user) {
  return db.professionals.find(professional => professional.userId === user.id) || null;
}

function canViewAppointment(user, appointment, db) {
  if (user.role === 'ADMIN') return true;
  if (user.role === 'PATIENT') return appointment.patientId === user.id;
  const professional = getProfessionalForUser(db, user);
  return professional && appointment.professionalId === professional.id;
}

module.exports = { getProfessionalForUser, canViewAppointment };
