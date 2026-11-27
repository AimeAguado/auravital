const { Controller, Get, Req, Res } = require('@nestjs/common');
const { timezone } = require('../../lib/config');
const { store } = require('../../lib/store');
const { publicProfessional } = require('../common/serialize');
const { parseDate, nowArgentinaParts, listSlots } = require('../common/dates');

class ProfessionalsController {
  async list(_req, res) {
    const db = await store.read();
    res.json({ professionals: db.professionals.filter(item => item.active).map(item => publicProfessional(item)) });
  }

  async availability(req, res) {
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
  }
}

Controller('api/professionals')(ProfessionalsController);
Get('')(ProfessionalsController.prototype, 'list', Object.getOwnPropertyDescriptor(ProfessionalsController.prototype, 'list'));
Req()(ProfessionalsController.prototype, 'list', 0);
Res()(ProfessionalsController.prototype, 'list', 1);
Get(':id/availability')(ProfessionalsController.prototype, 'availability', Object.getOwnPropertyDescriptor(ProfessionalsController.prototype, 'availability'));
Req()(ProfessionalsController.prototype, 'availability', 0);
Res()(ProfessionalsController.prototype, 'availability', 1);

module.exports = { ProfessionalsController };
