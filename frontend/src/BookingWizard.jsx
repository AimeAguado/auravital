import React, { useEffect, useMemo, useRef, useState } from 'react';

const WHATSAPP = 'https://wa.me/5492923573116?text=Hola%2C%20necesito%20ayuda%20para%20reservar%20un%20turno%20en%20Aura%20Vital.';
const specialtyOptions = [
  { id: 'dermatologia', title: 'Dermatología clínica', description: 'Atención de una médica especialista en clínica médica y dermatología clínica.', icon: '◉' },
  { id: 'dermoestetica', title: 'Dermoestética', description: 'Medicina estética y micropigmentación especializada.', icon: '✧' },
  { id: 'ginecologia', title: 'Ginecología', description: 'Tocoginecología y ginecología regenerativa, funcional y estética.', icon: '♡' },
  { id: 'cirugia-plastica', title: 'Cirugía plástica, estética y reparadora', description: 'Especialista universitario en cirugía plástica, estética y reparadora.', icon: '✧' },
  { id: 'medicina-china', title: 'Medicina tradicional china', description: 'Acupuntura, reflexología, armonización energética, ventosas y auriculoterapia.', icon: '☯' },
  { id: 'kinesiologia', title: 'Kinesiología y Fisiatría', description: 'Especializada en dermatofuncional y vascular.', icon: '◌' },
];
const catalog = [
  { key: 'daniela-lugo', name: 'Dra. Daniela Lugo', specialty: 'Médica especialista en clínica médica · Dermatología clínica · Medicina estética', description: 'Médica especialista en clínica médica, especialista en dermatología clínica y medicina estética.', photo: '/profesionales/daniela-lugo.jpeg', mode: 'BLIPDOC', url: 'https://blipdoc.com/portal/dermatologalugodaniela/turnos/6903' },
  { key: 'trinidad-gonzales', name: 'Trinidad Gonzales', specialty: 'Perfilado de cejas · Micropigmentación de cejas, ojos y labios', description: 'Perfilado de cejas y micropigmentación de cejas, ojos y labios.', photo: '/profesionales/trinidad-gonzales.jpeg', mode: 'AURA_VITAL' },
  { key: 'fernanda-crosato', name: 'Fernanda Crosato', specialty: 'Especialista en tocoginecología · Ginecología regenerativa, funcional y estética', description: 'Atención especializada en tocoginecología y ginecología regenerativa, funcional y estética.', photo: '/profesionales/fernanda-crosato.jpeg', mode: 'BLIPDOC', url: 'https://blipdoc.com/portal/dermatologalugodaniela/turnos/11176' },
  { key: 'jeronimo-serrano', name: 'Jerónimo Serrano', specialty: 'Especialista universitario en cirugía plástica, estética y reparadora', description: 'Especialista universitario en cirugía plástica, estética y reparadora.', photo: '/profesionales/jeronimo-serrano.jpeg', mode: 'BLIPDOC', url: 'https://blipdoc.com/portal/dermatologalugodaniela/turnos/11212' },
  { key: 'diana-lafitte', name: 'Diana Lafitte', specialty: 'Medicina tradicional china', description: 'Acupuntura, reflexología, armonización energética, ventosas y auriculoterapia.', photo: '/profesionales/diana-lafitte.jpeg', mode: 'AURA_VITAL' },
  { key: 'martina-durand', name: 'Martina Durand', specialty: 'Kinesiología y Fisiatría · Especializada en dermatofuncional y vascular', description: 'Atención de kinesiología y fisiatría, con especialización dermatofuncional y vascular.', photo: '/profesionales/martina-durand.jpeg', mode: 'BLIPDOC', url: 'https://blipdoc.com/portal/dermatologalugodaniela/turnos/11298' },
];
const externalSteps = ['Especialidad', 'Profesional', 'Agenda externa', 'Tus datos', 'Confirmación'];
const internalSteps = ['Especialidad', 'Profesional', 'Tratamiento', 'Fecha y hora', 'Tus datos', 'Confirmación'];
const cleanName = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/^(dra?\.?|lic\.?|dr\.?|prof\.?)/, '').replace(/[^a-z0-9 ]/g, ' ').trim().replace(/\s+/g, ' ');
const matchesName = (a, b) => {
  const left = cleanName(a).split(' '); const right = cleanName(b).split(' ');
  return left[0] === right[0] && left.at(-1)?.slice(0, 5) === right.at(-1)?.slice(0, 5);
};
const todayArgentina = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const dateString = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const dateLabel = date => new Intl.DateTimeFormat('es-AR', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
const monthLabel = date => new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(date);
const shiftMonth = (date, amount) => new Date(date.getFullYear(), date.getMonth() + amount, 1);
const matchesCategory = (person, category) => {
  const text = cleanName(person.specialty);
  if (category === 'dermatologia') return text.includes('dermatolog') || text.includes('clinica medica');
  if (category === 'dermoestetica') return text.includes('dermoest') || text.includes('micropigment') || text.includes('medicina estetica');
  if (category === 'ginecologia') return text.includes('ginecolo') || text.includes('tocogine');
  if (category === 'piso-pelvico') return text.includes('pelv');
  if (category === 'cirugia-plastica') return text.includes('cirugia plastica');
  if (category === 'medicina-china') return text.includes('medicina tradicional china');
  if (category === 'kinesiologia') return text.includes('kinesiologia') || text.includes('fisiatria');
  return false;
};
const icsTimestamp = date => new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function BookingWizard({ initialDetail = {} }) {
  const initialDetailApplied = useRef(false);
  const [open, setOpen] = useState(true);
  const [step, setStep] = useState(1);
  const [professionals, setProfessionals] = useState([]);
  const [professionalsError, setProfessionalsError] = useState('');
  const [selectedSpecialty, setSelectedSpecialty] = useState(null);
  const [selectedProfessional, setSelectedProfessional] = useState(null);
  const [selectedTreatment, setSelectedTreatment] = useState(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [slots, setSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [nextAvailable, setNextAvailable] = useState({});
  const [loadingNextAvailable, setLoadingNextAvailable] = useState(false);
  const [stepError, setStepError] = useState('');
  const [patientMode, setPatientMode] = useState('new');
  const [patient, setPatient] = useState(null);
  const [patientForm, setPatientForm] = useState({ firstName: '', lastName: '', dni: '', birthDate: '', phone: '', email: '', password: '' });
  const [savingPatient, setSavingPatient] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [appointment, setAppointment] = useState(null);
  const [externalOpened, setExternalOpened] = useState(false);
  const [externalConfirmed, setExternalConfirmed] = useState(false);

  useEffect(() => {
    fetch('/api/professionals').then(response => response.json()).then(data => setProfessionals(data.professionals || [])).catch(() => setProfessionalsError('No pudimos conectar con las agendas. Los turnos BlipDoc siguen disponibles; para las agendas Aura Vital, escribinos por WhatsApp.'));
    fetch('/api/auth/me', { credentials: 'same-origin' }).then(response => response.json()).then(data => { if (data.user) setPatient(data.user); }).catch(() => {});
    const onOpen = event => {
      const detail = event.detail || {};
      setOpen(true);
      setStepError('');
      setExternalOpened(false);
      setExternalConfirmed(false);
      setSelectedTreatment(null);
      if (detail.professionalId) {
        const live = professionals.find(item => item.id === detail.professionalId);
        const base = catalog.find(item => live && matchesName(item.name, live.name));
        if (base && live) {
          setSelectedSpecialty(specialtyOptions.find(item => matchesCategory(base, item.id)) || null);
          setSelectedProfessional({ ...base, live });
          setStep(3);
        }
      } else if (detail.service) {
        const category = specialtyOptions.find(item => cleanName(item.title).includes(cleanName(detail.service)) || cleanName(detail.service).includes(cleanName(item.title)));
        if (category) { setSelectedSpecialty(category); setStep(2); }
      }
    };
    const onClosed = () => setOpen(false);
    const onAuthenticated = event => {
      setPatient(event.detail);
      setPatientMode('existing');
      setStep(selectedProfessional?.mode === 'BLIPDOC' ? 5 : 6);
    };
    const onUserUpdated = event => setPatient(event.detail);
    document.addEventListener('auravital:open-booking', onOpen);
    document.addEventListener('auravital:booking-closed', onClosed);
    document.addEventListener('auravital:booking-authenticated', onAuthenticated);
    document.addEventListener('auravital:booking-user-updated', onUserUpdated);
    if (!initialDetailApplied.current) {
      if (initialDetail.professionalId && professionals.some(item => item.id === initialDetail.professionalId)) { onOpen({ detail: initialDetail }); initialDetailApplied.current = true; }
      else if (initialDetail.service) { onOpen({ detail: initialDetail }); initialDetailApplied.current = true; }
      else if (!initialDetail.professionalId) { onOpen({ detail: initialDetail }); initialDetailApplied.current = true; }
    }
    return () => {
      document.removeEventListener('auravital:open-booking', onOpen);
      document.removeEventListener('auravital:booking-closed', onClosed);
      document.removeEventListener('auravital:booking-authenticated', onAuthenticated);
      document.removeEventListener('auravital:booking-user-updated', onUserUpdated);
    };
  }, [professionals, initialDetail]);

  const matchingPeople = useMemo(() => selectedSpecialty ? catalog.filter(person => matchesCategory(person, selectedSpecialty.id)).map(person => ({ ...person, live: professionals.find(item => matchesName(person.name, item.name)) || null })) : [], [selectedSpecialty, professionals]);
  const monthDays = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const leading = (first.getDay() + 6) % 7;
    return [...Array(leading).fill(null), ...Array.from({ length: last.getDate() }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))];
  }, [month]);
  const selectedProfessionalIsExternal = selectedProfessional?.mode === 'BLIPDOC';
  useEffect(() => {
    if (!open || step !== 2 || !matchingPeople.length) return;
    let active = true;
    setNextAvailable({});
    setLoadingNextAvailable(true);
    const from = todayArgentina();
    const end = new Date(`${from}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 14);
    const to = end.toISOString().slice(0, 10);
    Promise.all(matchingPeople.filter(person => person.mode === 'AURA_VITAL' && person.live?.id).map(async person => {
      try {
        const response = await fetch(`/api/professionals/${encodeURIComponent(person.live.id)}/availability?from=${from}&to=${to}`, { credentials: 'same-origin' });
        const data = await response.json();
        const firstSlot = response.ok ? (data.slots || []).sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))[0] : null;
        return firstSlot ? [person.key, firstSlot] : null;
      } catch { return null; }
    })).then(results => { if (active) setNextAvailable(Object.fromEntries(results.filter(Boolean))); }).finally(() => { if (active) setLoadingNextAvailable(false); });
    return () => { active = false; };
  }, [open, step, matchingPeople]);

  useEffect(() => {
    if (!open || step !== 4 || !selectedProfessional?.live?.id || selectedProfessionalIsExternal || !selectedTreatment) return;
    const from = dateString(month);
    const rawTo = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const maxTo = new Date(`${from}T12:00:00Z`); maxTo.setUTCDate(maxTo.getUTCDate() + 90);
    const to = dateString(new Date(Math.min(rawTo.getTime(), maxTo.getTime())));
    let active = true;
    setLoadingSlots(true); setStepError(''); setSlots([]);
    const treatmentQuery = new URLSearchParams({ from, to, treatmentId: selectedTreatment.id });
    fetch(`/api/professionals/${encodeURIComponent(selectedProfessional.live.id)}/availability?${treatmentQuery}`, { credentials: 'same-origin' })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'No pudimos consultar los horarios.'); return data; })
      .then(data => { if (active) setSlots(data.slots || []); })
      .catch(error => { if (active) setStepError(error.message); })
      .finally(() => { if (active) setLoadingSlots(false); });
    return () => { active = false; };
  }, [open, step, selectedProfessional, selectedProfessionalIsExternal, selectedTreatment, month]);

  if (!open) return null;

  const changeStep = next => { setStepError(''); setStep(next); };
  const chooseSpecialty = specialty => { setSelectedSpecialty(specialty); setSelectedProfessional(null); setSelectedTreatment(null); setSelectedDate(''); setSelectedTime(''); setStepError(''); };
  const chooseProfessional = person => {
    setSelectedProfessional(person);
    setSelectedTreatment(null);
    setExternalOpened(false); setExternalConfirmed(false);
    setSelectedDate(''); setSelectedTime(''); setSlots([]); setStepError('');
    setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    changeStep(3);
  };
  const chooseTreatment = treatment => { setSelectedTreatment(treatment); setSelectedDate(''); setSelectedTime(''); setSlots([]); setStepError(''); changeStep(4); };
  const goBack = () => { if (step > 1 && !appointment) changeStep(step - 1); };

  const submitPatient = async event => {
    event.preventDefault(); setStepError(''); setSavingPatient(true);
    const form = patientForm;
    try {
      const response = await fetch('/api/auth/register', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No pudimos crear tu cuenta. Revisá los datos e intentá nuevamente.');
      const registeredPatient = { ...data.user, ...form };
      setPatient(registeredPatient); setPatientMode('new');
      setPatientForm(current => ({ ...current, password: '' }));
      document.dispatchEvent(new CustomEvent('auravital:booking-user-updated', { detail: data.user }));
      changeStep(6);
    } catch (error) { setStepError(error.message); }
    finally { setSavingPatient(false); }
  };

  const openLogin = () => {
    setStepError(''); setPatientMode('existing');
    document.dispatchEvent(new CustomEvent('auravital:request-booking-auth'));
  };

  const confirmBooking = async () => {
    if (!patient || !selectedProfessional?.live?.id || !selectedDate || !selectedTime) return;
    setSubmitting(true); setStepError('');
    try {
      const response = await fetch('/api/appointments', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ professionalId: selectedProfessional.live.id, treatmentId: selectedTreatment?.id, date: selectedDate, time: selectedTime }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Ese horario ya no está disponible. Elegí otro horario.');
      setAppointment(data.appointment); changeStep(6);
    } catch (error) { setStepError(error.message); setAppointment(null); changeStep(4); }
    finally { setSubmitting(false); }
  };

  const addToCalendar = () => {
    if (!appointment) return;
    const start = new Date(`${appointment.date}T${appointment.time}:00-03:00`);
    const duration = Number(selectedTreatment?.durationMinutes || selectedProfessional?.live?.durationMinutes || 30);
    const end = new Date(start.getTime() + duration * 60000);
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Aura Vital//Turnos//ES', 'BEGIN:VEVENT', `UID:${appointment.id}@auravital`, `DTSTAMP:${icsTimestamp(new Date())}`, `DTSTART:${icsTimestamp(start)}`, `DTEND:${icsTimestamp(end)}`, `SUMMARY:Turno en Aura Vital - ${selectedProfessional.name}`, 'LOCATION:Libertad 351\, Darregueira\, Buenos Aires', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const link = document.createElement('a'); link.href = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`; link.download = `turno-aura-vital-${appointment.id}.ics`; link.click();
  };

  const calendarDaysWithSlots = new Set(slots.map(slot => slot.date));
  const selectedDaySlots = slots.filter(slot => slot.date === selectedDate);
  const morningSlots = selectedDaySlots.filter(slot => Number(slot.time.slice(0, 2)) < 12);
  const afternoonSlots = selectedDaySlots.filter(slot => Number(slot.time.slice(0, 2)) >= 12);
  const directBlipdocUrl = selectedProfessional?.url || selectedProfessional?.live?.blipdocUrl;
  const flowSteps = selectedProfessional && !selectedProfessionalIsExternal ? internalSteps : externalSteps;
  const activeStep = appointment ? flowSteps.length : Math.min(step, flowSteps.length);

  return <div className="booking-modal-layout">
    <aside className="booking-sidebar">
      <img className="booking-brand-logo" src="/aura-vital-logo.jpeg" alt="Aura Vital" />
      <span className="eyebrow">Aura Vital · Darregueira</span>
      <h2>Te acompañamos en cada paso.</h2>
      <p>Un proceso simple y claro para encontrar tu próxima consulta.</p>
      <div className="booking-sidebar-address"><span aria-hidden="true">⌖</span><span>Libertad 351<br />Darregueira, Buenos Aires</span></div>
      <a className="booking-help" href={WHATSAPP} target="_blank" rel="noopener noreferrer"><span aria-hidden="true">◉</span><span>¿Necesitás ayuda para reservar?<strong>Escribinos por WhatsApp</strong></span></a>
    </aside>
    <section className="booking-flow" aria-labelledby="booking-title">
      <div className="booking-sticky-header">
        <div className="booking-flow-heading">
          <span className="eyebrow">Reservas · Aura Vital</span>
          <h2 id="booking-title">Reservá tu turno</h2>
          <p>Estamos para acompañarte. Elegí la atención que necesitás.</p>
        </div>
      <ol className="booking-progress" aria-label="Pasos para reservar">
          {flowSteps.map((label, index) => <li key={label} className={index + 1 === activeStep ? 'active' : index + 1 < activeStep ? 'complete' : ''} aria-current={index + 1 === activeStep ? 'step' : undefined}><span>{index + 1 < activeStep ? '✓' : index + 1}</span><small>{label}</small></li>)}
        </ol>
      </div>
      {stepError && <p className="booking-alert" role="alert">{stepError}</p>}

      {step === 1 && <div className="booking-step">
        <h3>Elegí la especialidad que necesitás</h3>
        <p className="booking-step-hint">Elegí una opción para continuar.</p>
        <div className="booking-specialties">{specialtyOptions.map(specialty => { const selected = selectedSpecialty?.id === specialty.id; return <button type="button" key={specialty.id} className={`booking-specialty-card${selected ? ' selected' : ''}`} aria-pressed={selected} onClick={() => chooseSpecialty(specialty)}><span className="booking-specialty-icon" aria-hidden="true">{specialty.icon}</span><span className="booking-specialty-copy"><strong>{specialty.title}</strong><small>{specialty.description}</small>{selected && <span className="booking-selected-label">✓ Seleccionada</span>}</span><span className="booking-selection" aria-hidden="true">{selected ? '✓' : '›'}</span></button>; })}</div>
        <div className="booking-actions booking-specialty-footer"><span className="booking-current-selection">{selectedSpecialty ? <>Seleccionaste: <strong>{selectedSpecialty.title}</strong></> : 'Elegí una especialidad para continuar'}</span><button className="button booking-next" type="button" disabled={!selectedSpecialty} onClick={() => changeStep(2)}>Continuar</button></div>
      </div>}

      {step === 2 && <div className="booking-step">
        <h3>Elegí un profesional</h3>
        <p className="booking-step-hint">Especialidad: <strong>{selectedSpecialty?.title}</strong></p>
        {professionalsError && <p className="booking-alert" role="status">{professionalsError}</p>}
        <div className="booking-professionals">{matchingPeople.map(person => {
          const isExternal = person.mode === 'BLIPDOC';
          const hasLiveSchedule = Boolean(person.live?.id) && person.live?.turnerMode !== 'BLIPDOC';
          const selected = selectedProfessional?.key === person.key;
          return <button type="button" key={person.key} className={`booking-professional-card${selected ? ' selected' : ''}`} aria-pressed={selected} onClick={() => setSelectedProfessional(person)}>
            <img src={person.photo} alt="" />
            <span className="booking-professional-info"><strong>{person.name}</strong><small>{person.specialty}</small><small>{isExternal ? 'Reserva externa por BlipDoc' : hasLiveSchedule ? 'Agenda Aura Vital disponible' : 'Agenda en preparación'}</small>{nextAvailable[person.key] && <small>Próximo turno: {dateLabel(nextAvailable[person.key].date)} · {nextAvailable[person.key].time}</small>}{selected && <span className="booking-selected-label">✓ Seleccionado</span>}</span>
            <span className="booking-selection" aria-hidden="true">{selected ? '✓' : '›'}</span>
          </button>;
        })}</div>
        {!matchingPeople.length && <div className="booking-empty"><p>No encontramos profesionales asociados a esta especialidad en el turnero todavía.</p><a href={WHATSAPP} target="_blank" rel="noopener noreferrer">Consultá con recepción por WhatsApp</a></div>}
        <div className="booking-actions"><button className="button secondary booking-back" type="button" onClick={goBack}>Volver</button>{selectedProfessional && <button className="button booking-next" type="button" onClick={() => changeStep(3)}>Continuar</button>}</div>
      </div>}

      {step === 3 && !selectedProfessionalIsExternal && <div className="booking-step booking-treatment-step">
        <h3>Elegí el tratamiento</h3>
        <p className="booking-step-hint">Servicios de <strong>{selectedProfessional?.name}</strong>. Al elegir uno, vas a ver los días y horarios disponibles.</p>
        <div className="booking-treatment-options">{(selectedProfessional?.live?.treatments || []).filter(item => item.active !== false).map(treatment => <button type="button" key={treatment.id} className="booking-treatment-option" onClick={() => chooseTreatment(treatment)}><span className="booking-treatment-option-copy"><strong>{treatment.name}</strong><small>{treatment.durationMinutes} min</small></span><span className="booking-treatment-price">{Number(treatment.price) > 0 ? `$ ${Number(treatment.price).toLocaleString('es-AR')}` : 'Consultar valor'}<span aria-hidden="true">›</span></span></button>)}</div>
        {!(selectedProfessional?.live?.treatments || []).some(item => item.active !== false) && <div className="booking-empty"><p>Este profesional todavía no publicó tratamientos. Escribinos para consultar.</p><a href={WHATSAPP} target="_blank" rel="noopener noreferrer">Consultar por WhatsApp</a></div>}
        <div className="booking-actions"><button className="button secondary booking-back" type="button" onClick={goBack}>Volver</button></div>
      </div>}

      {step === 3 && selectedProfessionalIsExternal && <div className="booking-step">
        <h3>Tu reserva continúa en BlipDoc</h3>
        <p className="booking-step-hint">Elegiste a <strong>{selectedProfessional.name}</strong>. BlipDoc administra su agenda; no crearemos una segunda reserva en Aura Vital.</p>
        <div className="booking-external-card"><span className="booking-external-icon" aria-hidden="true">↗</span><div><strong>Reserva segura en BlipDoc</strong><p>Al continuar, se abrirá la agenda externa para elegir día y horario.</p></div></div>
        {!directBlipdocUrl && <p className="booking-alert">El enlace de agenda todavía no está configurado. Escribinos por WhatsApp y te ayudamos.</p>}
        <div className="booking-actions"><button className="button secondary booking-back" type="button" onClick={goBack}>Volver</button>{directBlipdocUrl && (externalOpened ? <button className="button booking-next booking-external-link" type="button" onClick={() => { setExternalConfirmed(true); changeStep(5); }}>Ya confirmé mi turno</button> : <a className="button booking-next booking-external-link" href={directBlipdocUrl} target="_blank" rel="noopener noreferrer" onClick={() => setExternalOpened(true)}>Continuar a BlipDoc ↗</a>)}</div>
      </div>}

      {step === 4 && !selectedProfessionalIsExternal && <div className="booking-step">
        <h3>Elegí el día y el horario</h3>
        <p className="booking-step-hint">Profesional: <strong>{selectedProfessional?.name}</strong></p>
        <div className="booking-date-time-layout">
          <div className="booking-date-panel">
            <div className="booking-calendar-heading"><button type="button" aria-label="Mes anterior" onClick={() => { setSelectedDate(''); setSelectedTime(''); setMonth(value => shiftMonth(value, -1)); }} disabled={month <= new Date(new Date().getFullYear(), new Date().getMonth(), 1)}>‹</button><strong>{monthLabel(month)}</strong><button type="button" aria-label="Mes siguiente" onClick={() => { setSelectedDate(''); setSelectedTime(''); setMonth(value => shiftMonth(value, 1)); }} disabled={month >= new Date(new Date().getFullYear(), new Date().getMonth() + 2, 1)}>›</button></div>
            <div className="booking-calendar" role="group" aria-label={`Días disponibles de ${monthLabel(month)}`}>{['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'].map(day => <span className="booking-calendar-weekday" key={day}>{day.slice(0, 3)}</span>)}{monthDays.map((day, index) => {
              if (!day) return <span className="booking-calendar-empty" key={`empty-${index}`} />;
              const value = dateString(day); const available = calendarDaysWithSlots.has(value) && value >= todayArgentina();
              return <button type="button" key={value} disabled={!available} aria-label={`${dateLabel(value)}${available ? ', disponible' : ', sin horarios disponibles'}`} aria-pressed={selectedDate === value} className={`${available ? 'available' : 'unavailable'}${selectedDate === value ? ' selected' : ''}`} onClick={() => { setSelectedDate(value); setSelectedTime(''); }}>{day.getDate()}</button>;
            })}</div>
            <div className="booking-calendar-legend"><span><i className="available" />Disponible</span><span><i className="selected" />Elegido</span><span><i className="unavailable" />Sin turnos</span></div>
            {loadingSlots && <p className="booking-loading" role="status">Buscando días y horarios disponibles…</p>}
            {!selectedProfessional?.live?.id && <p className="booking-loading">La agenda online todavía no está conectada. Consultá disponibilidad por WhatsApp.</p>}
            {selectedProfessional?.live?.id && !loadingSlots && !stepError && !slots.length && <p className="booking-loading">No hay horarios disponibles en este mes. Probá el mes siguiente.</p>}
          </div>
          <div className="booking-time-panel">{!selectedProfessional?.live?.id ? <div className="booking-time-placeholder"><span className="booking-times-eyebrow">Horarios disponibles</span><p>La agenda online de <strong>{selectedProfessional?.name}</strong> todavía no está conectada.</p><a href={WHATSAPP} target="_blank" rel="noopener noreferrer">Consultar por WhatsApp</a></div> : selectedDate ? <div className="booking-times"><span className="booking-times-eyebrow">Horarios disponibles</span><p className="booking-times-date">{dateLabel(selectedDate)}</p>{selectedDaySlots.length ? <div className="booking-time-groups">{[["Mañana", morningSlots], ["Tarde", afternoonSlots]].filter(([, periodSlots]) => periodSlots.length).map(([label, periodSlots]) => <section className="booking-time-group" key={label}><h4>{label}</h4><div>{periodSlots.map(slot => <button type="button" key={slot.time} aria-pressed={selectedTime === slot.time} className={selectedTime === slot.time ? 'selected' : ''} onClick={() => setSelectedTime(slot.time)}>{slot.time}</button>)}</div></section>)}</div> : <p className="booking-loading">No hay horarios disponibles para este día.</p>}</div> : <p className="booking-time-placeholder">Seleccioná un día para ver sus horarios disponibles.</p>}</div>
        </div>
        <div className="booking-actions"><button className="button secondary booking-back" type="button" onClick={goBack}>Volver</button>{selectedProfessional?.live?.id && <button className="button booking-next" type="button" disabled={!selectedDate || !selectedTime} onClick={() => changeStep(5)}>Continuar</button>}</div>
      </div>}

      {step === 5 && <div className="booking-step">
        <h3>¿Ya tenés una cuenta?</h3>
        {patient ? <div className="booking-signed-in"><p>Sesión iniciada como <strong>{patient.name || `${patient.firstName || ''} ${patient.lastName || ''}`.trim()}</strong> ({patient.email}).</p><button type="button" className="button booking-next" onClick={() => changeStep(6)}>Continuar</button></div> : <>
          <div className="booking-patient-options"><button type="button" className={patientMode === 'existing' ? 'selected' : ''} onClick={() => setPatientMode('existing')}>Ya tengo una cuenta</button><button type="button" className={patientMode === 'new' ? 'selected' : ''} onClick={() => setPatientMode('new')}>Soy paciente nuevo</button></div>
          {patientMode === 'existing' ? <div className="booking-login-prompt"><p>Iniciá sesión en tu cuenta para confirmar la reserva.</p><button type="button" className="button booking-next" onClick={openLogin}>Iniciar sesión</button><p>¿No podés ingresar? <a href={WHATSAPP} target="_blank" rel="noopener noreferrer">Pedí ayuda a recepción</a></p></div> : <form className="booking-patient-form" onSubmit={submitPatient}>
            <div className="booking-form-field"><label htmlFor="booking-first-name">Nombre</label><input id="booking-first-name" name="firstName" autoComplete="given-name" value={patientForm.firstName} onChange={event => setPatientForm(current => ({ ...current, firstName: event.target.value }))} required /></div>
            <div className="booking-form-field"><label htmlFor="booking-last-name">Apellido</label><input id="booking-last-name" name="lastName" autoComplete="family-name" value={patientForm.lastName} onChange={event => setPatientForm(current => ({ ...current, lastName: event.target.value }))} required /></div>
            <div className="booking-form-field"><label htmlFor="booking-dni">DNI</label><input id="booking-dni" name="dni" inputMode="numeric" pattern="[0-9]{7,8}" title="Ingresá los 7 u 8 números de tu DNI" value={patientForm.dni} onChange={event => setPatientForm(current => ({ ...current, dni: event.target.value }))} required /></div>
            <div className="booking-form-field"><label htmlFor="booking-birth-date">Fecha de nacimiento</label><input id="booking-birth-date" name="birthDate" type="date" max={todayArgentina()} value={patientForm.birthDate} onChange={event => setPatientForm(current => ({ ...current, birthDate: event.target.value }))} required /></div>
            <div className="booking-form-field"><label htmlFor="booking-phone">Teléfono</label><input id="booking-phone" name="phone" type="tel" autoComplete="tel" pattern="[+0-9() .-]{8,24}" title="Ingresá un teléfono válido, con código de área" value={patientForm.phone} onChange={event => setPatientForm(current => ({ ...current, phone: event.target.value }))} required /></div>
            <div className="booking-form-field"><label htmlFor="booking-email">Correo electrónico</label><input id="booking-email" name="email" type="email" autoComplete="email" value={patientForm.email} onChange={event => setPatientForm(current => ({ ...current, email: event.target.value }))} required /></div>
            <div className="booking-form-field booking-form-wide"><label htmlFor="booking-password">Contraseña (al menos 10 caracteres)</label><input id="booking-password" name="password" type="password" minLength="10" autoComplete="new-password" value={patientForm.password} onChange={event => setPatientForm(current => ({ ...current, password: event.target.value }))} required /></div>
            <div className="booking-actions booking-form-wide"><button type="button" className="button secondary booking-back" onClick={goBack}>Volver</button><button type="submit" className="button booking-next" disabled={savingPatient}>{savingPatient ? 'Creando tu cuenta…' : 'Continuar'}</button></div>
          </form>}
        </>}
      </div>}

      {step === 6 && <div className="booking-step">
        {appointment ? <div className="booking-success"><span className="booking-success-mark" aria-hidden="true">✓</span><h3>¡Tu solicitud de turno fue registrada!</h3><p>Te esperamos en Aura Vital. El turno queda pendiente de confirmación por el consultorio.</p><div className="booking-summary"><p><strong>Profesional</strong><span>{selectedProfessional.name}</span></p><p><strong>Tratamiento</strong><span>{appointment.treatmentName || selectedTreatment?.name}</span></p><p><strong>Fecha</strong><span>{dateLabel(appointment.date)}</span></p><p><strong>Hora</strong><span>{appointment.time}</span></p><p><strong>Valor</strong><span>$ {Number(appointment.price || 0).toLocaleString('es-AR')}</span></p><p><strong>Dirección</strong><span>Libertad 351, Darregueira</span></p><p><strong>Paciente</strong><span>{patient?.name || `${patient?.firstName || ''} ${patient?.lastName || ''}`.trim()} · {patient?.email}</span></p><p><strong>DNI y teléfono</strong><span>{patient?.dni || 'No informado'} · {patient?.phone || 'No informado'}</span></p><p><strong>Número de solicitud</strong><span>{appointment.id}</span></p></div><div className="booking-success-actions"><button className="button secondary" type="button" onClick={addToCalendar}>Agregar al calendario</button><a className="button booking-next" href="https://maps.app.goo.gl/6MYYkXz3YeLJorZH7" target="_blank" rel="noopener noreferrer">Cómo llegar</a></div><button className="booking-restart" type="button" onClick={() => { setAppointment(null); setExternalOpened(false); setExternalConfirmed(false); setSelectedSpecialty(null); setSelectedProfessional(null); setSelectedTreatment(null); setSelectedDate(''); setSelectedTime(''); setStep(1); }}>Reservar otro turno</button></div> : externalConfirmed ? <div className="booking-success booking-external-success"><span className="booking-success-mark" aria-hidden="true">✓</span><h3>¡Gracias por reservar tu turno!</h3><p>Tu reserva con <strong>{selectedProfessional?.name}</strong> se gestiona desde BlipDoc. Revisá allí los detalles y la confirmación de tu turno.</p><p>¿Necesitás ayuda? Escribinos por WhatsApp.</p><div className="booking-success-actions"><a className="button booking-next" href={WHATSAPP} target="_blank" rel="noopener noreferrer">Escribir por WhatsApp</a></div><button className="booking-restart" type="button" onClick={() => { setExternalOpened(false); setExternalConfirmed(false); setSelectedSpecialty(null); setSelectedProfessional(null); setSelectedDate(''); setSelectedTime(''); setStep(1); }}>Reservar otro turno</button></div> : <>
          <h3>Revisá los datos de tu turno</h3>
          <div className="booking-summary"><p><strong>Especialidad</strong><span>{selectedSpecialty?.title}</span></p><p><strong>Profesional</strong><span>{selectedProfessional?.name}</span></p><p><strong>Tratamiento</strong><span>{selectedTreatment?.name}</span></p><p><strong>Duración</strong><span>{selectedTreatment?.durationMinutes} min</span></p><p><strong>Valor</strong><span>{Number(selectedTreatment?.price) > 0 ? `$ ${Number(selectedTreatment.price).toLocaleString('es-AR')}` : 'Consultar valor'}</span></p><p><strong>Fecha</strong><span>{selectedDate && dateLabel(selectedDate)}</span></p><p><strong>Hora</strong><span>{selectedTime}</span></p><p><strong>Dirección</strong><span>Libertad 351, Darregueira</span></p><p><strong>Paciente</strong><span>{patient?.name || `${patient?.firstName || ''} ${patient?.lastName || ''}`.trim()} · {patient?.email}</span></p><p><strong>DNI y teléfono</strong><span>{patient?.dni || 'No informado'} · {patient?.phone || 'No informado'}</span></p></div>
          <p className="booking-confirm-note">Al confirmar, el horario se vuelve a verificar para evitar reservas duplicadas.</p>
          <div className="booking-actions"><button className="button secondary booking-back" type="button" onClick={goBack}>Volver</button><button className="button booking-next" type="button" onClick={confirmBooking} disabled={submitting}>{submitting ? 'Verificando disponibilidad…' : 'Confirmar mi turno'}</button></div>
        </>}
      </div>}
    </section>
  </div>;
}

export default BookingWizard;
