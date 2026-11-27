import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../app.js';
import './aura.css';

const team = [
  {
    key: 'daniela-lugo', name: 'Dra. Daniela Lugo', specialty: 'Médica especialista en clínica médica · Dermatología clínica · Medicina estética',
    description: 'Médica especialista en clínica médica, especialista en dermatología clínica y medicina estética.', image: '/profesionales/daniela-lugo.jpeg', mode: 'BLIPDOC',
    blipdocUrl: 'https://blipdoc.com/portal/dermatologalugodaniela/turnos/6903',
  },
  {
    key: 'trinidad-gonzales', name: 'Trinidad Gonzales', specialty: 'Perfilado de cejas · Micropigmentación de cejas, ojos y labios',
    description: 'Diseño y perfilado de cejas, y micropigmentación de cejas, ojos y labios.', image: '/profesionales/trinidad-gonzales.jpeg', mode: 'AURA_VITAL',
  },
  {
    key: 'fernanda-crosato', name: 'Fernanda Crosato', specialty: 'Especialista en tocoginecología · Ginecología regenerativa, funcional y estética',
    description: 'Atención especializada en tocoginecología y ginecología regenerativa, funcional y estética.', image: '/profesionales/fernanda-crosato.jpeg', mode: 'BLIPDOC',
    blipdocUrl: 'https://blipdoc.com/portal/dermatologalugodaniela/turnos/11176',
  },
  {
    key: 'jeronimo-serrano', name: 'Jerónimo Serrano', specialty: 'Especialista universitario en cirugía plástica, estética y reparadora',
    description: 'Especialista universitario en cirugía plástica, estética y reparadora. Miembro de SACPER y MAAC.', image: '/profesionales/jeronimo-serrano.jpeg', mode: 'BLIPDOC',
    blipdocUrl: 'https://blipdoc.com/portal/dermatologalugodaniela/turnos/11212',
  },
  {
    key: 'diana-lafitte', name: 'Diana Lafitte', specialty: 'Medicina tradicional china',
    description: 'Acupuntura, reflexología, armonización energética, ventosas y auriculoterapia.', image: '/profesionales/diana-lafitte.jpeg', mode: 'AURA_VITAL',
  },
  {
    key: 'martina-durand', name: 'Martina Durand', specialty: 'Kinesiología y Fisiatría · Especializada en dermatofuncional y vascular',
    description: 'Atención de kinesiología y fisiatría, con especialización dermatofuncional y vascular.', image: '/profesionales/martina-durand.jpeg', mode: 'BLIPDOC',
    blipdocUrl: 'https://blipdoc.com/portal/dermatologalugodaniela/turnos/11298',
  },
];

const specialtyCards = [
  { icon: '✧', title: 'Clínica médica, dermatología clínica y medicina estética', description: 'Médica especialista en clínica médica, dermatología clínica y medicina estética.', professional: 'daniela-lugo' },
  { icon: '✦', title: 'Perfilado y micropigmentación', description: 'Perfilado de cejas y micropigmentación de cejas, ojos y labios.', professional: 'trinidad-gonzales' },
  { icon: '♡', title: 'Tocoginecología y ginecología regenerativa', description: 'Especialista en tocoginecología y ginecología regenerativa, funcional y estética.', professional: 'fernanda-crosato' },
  { icon: '✧', title: 'Cirugía plástica, estética y reparadora', description: 'Especialista universitario en cirugía plástica, estética y reparadora.', professional: 'jeronimo-serrano' },
  { icon: '☯', title: 'Medicina tradicional china', description: 'Acupuntura, reflexología, armonización energética, ventosas y auriculoterapia.', professional: 'diana-lafitte' },
  { icon: '◌', title: 'Kinesiología y Fisiatría', description: 'Especializada en dermatofuncional y vascular.', professional: 'martina-durand' },
];

function normalizedName(name) {
  return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/^(dra?\.?|lic\.?|dr\.?|prof\.?)/, '').replace(/[^a-z0-9 ]/g, ' ').trim().replace(/\s+/g, ' ');
}

function matchProfessional(person, professionals) {
  const expected = normalizedName(person.name).split(' ');
  const first = expected[0];
  const surname = expected.at(-1).slice(0, 5);
  return professionals.find(professional => {
    const actual = normalizedName(professional.name).split(' ');
    return actual[0] === first && actual.some(part => part.startsWith(surname));
  });
}

function initials(name) {
  return normalizedName(name).split(' ').filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('');
}

function useLiveProfessionals() {
  const [professionals, setProfessionals] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const receiveProfessionals = event => { setProfessionals(event.detail); setError(''); };
    const receiveError = event => { setError(event.detail); setProfessionals([]); };
    document.addEventListener('auravital:professionals', receiveProfessionals);
    document.addEventListener('auravital:professionals-error', receiveError);
    return () => {
      document.removeEventListener('auravital:professionals', receiveProfessionals);
      document.removeEventListener('auravital:professionals-error', receiveError);
    };
  }, []);
  return { professionals, error };
}

function extraProfessionals(professionals) {
  if (!professionals) return [];
  const matched = new Set(team.map(person => matchProfessional(person, professionals)).filter(Boolean).map(professional => professional.id));
  return professionals.filter(professional => !matched.has(professional.id));
}

const specialtyIcons = ['✧', '✦', '♡', '☯', '◌', '◉'];

function SpecialtyList() {
  const { professionals } = useLiveProfessionals();
  const extras = extraProfessionals(professionals).filter(professional => !specialtyCards.some(card => normalizedName(card.title) === normalizedName(professional.specialty)));
  return <>
    {specialtyCards.map(specialty => (
      <article className="specialty-card" key={specialty.professional}>
        <span className="specialty-icon" aria-hidden="true">{specialty.icon}</span>
        <div className="specialty-card-copy">
          <h3>{specialty.title}</h3>
          <p>{specialty.description}</p>
          <a href={`#profesional-${specialty.professional}`}>Conocer al profesional <span aria-hidden="true">↗</span></a>
        </div>
      </article>
    ))}
    {extras.map((professional, index) => (
      <article className="specialty-card" key={`specialty-${professional.id}`}>
        <span className="specialty-icon" aria-hidden="true">{specialtyIcons[index % specialtyIcons.length]}</span>
        <div className="specialty-card-copy">
          <h3>{professional.specialty}</h3>
          <p>{professional.description || professional.specialty}</p>
          <a href={`#profesional-${professional.id}`}>Conocer al profesional <span aria-hidden="true">↗</span></a>
        </div>
      </article>
    ))}
  </>;
}

function ProfessionalList() {
  const { professionals, error } = useLiveProfessionals();

  if (professionals === null) return <p className="notice">Cargando profesionales...</p>;
  const extras = extraProfessionals(professionals);

  return <>
    {error && <p className="notice professional-load-error">No pudimos cargar las agendas. El equipo está disponible para que consultes por contacto.</p>}
    {team.map(person => {
      const professional = matchProfessional(person, professionals);
      const isBlipdoc = person.mode === 'BLIPDOC';
      return (
        <article className="professional-card" id={`profesional-${person.key}`} key={person.key}>
          <img className="professional-presentation" src={professional?.photo || person.image} alt={`Presentación profesional de ${person.name}`} loading="lazy" />
          <div className="professional-card-content">
            <span className={`professional-badge${isBlipdoc ? ' external' : ''}`}>{isBlipdoc ? 'Turnos online · BlipDoc' : 'Reserva en Aura Vital'}</span>
            <h3>{person.name}</h3>
            <div className="professional-specialty">{person.specialty}</div>
            <p className="professional-description">{person.description}</p>
            <div className="professional-booking-note">
              <strong>{isBlipdoc ? 'Modalidad de reserva' : 'Atención personalizada'}</strong><br />
              {isBlipdoc ? 'Reservá tu consulta directamente desde BlipDoc.' : 'Consultá disponibilidad con el equipo de Aura Vital.'}
            </div>
            {isBlipdoc
              ? (person.blipdocUrl || professional?.blipdocUrl)
                ? <a className="button professional-booking secondary" href={person.blipdocUrl || professional?.blipdocUrl} target="_blank" rel="noopener noreferrer">Sacar turno por BlipDoc ↗</a>
                : <button className="button professional-booking secondary" type="button" data-professional-contact={person.name}>Sacar turno por BlipDoc ↗</button>
              : professional
                ? <button className="button professional-booking" type="button" data-book-professional={professional.id}>Sacar turno</button>
                : <button className="button professional-booking" type="button" data-professional-contact={person.name}>Sacar turno</button>}
          </div>
        </article>
      );
    })}
    {extras.map(professional => {
      const isBlipdoc = professional.turnerMode === 'BLIPDOC';
      return (
        <article className="professional-card" id={`profesional-${professional.id}`} key={professional.id}>
          {professional.photo
            ? <img className="professional-presentation" src={professional.photo} alt={`Presentación profesional de ${professional.name}`} loading="lazy" />
            : <div className="professional-presentation professional-avatar-fallback" aria-hidden="true">{initials(professional.name)}</div>}
          <div className="professional-card-content">
            <span className={`professional-badge${isBlipdoc ? ' external' : ''}`}>{isBlipdoc ? 'Turnos online · BlipDoc' : 'Reserva en Aura Vital'}</span>
            <h3>{professional.name}</h3>
            <div className="professional-specialty">{professional.specialty}</div>
            <p className="professional-description">{professional.description || professional.specialty}</p>
            <div className="professional-booking-note">
              <strong>{isBlipdoc ? 'Modalidad de reserva' : 'Atención personalizada'}</strong><br />
              {isBlipdoc ? 'Reservá tu consulta directamente desde BlipDoc.' : 'Consultá disponibilidad con el equipo de Aura Vital.'}
            </div>
            {isBlipdoc
              ? professional.blipdocUrl
                ? <a className="button professional-booking secondary" href={professional.blipdocUrl} target="_blank" rel="noopener noreferrer">Sacar turno por BlipDoc ↗</a>
                : <button className="button professional-booking secondary" type="button" data-professional-contact={professional.name}>Sacar turno por BlipDoc ↗</button>
              : <button className="button professional-booking" type="button" data-book-professional={professional.id}>Sacar turno</button>}
          </div>
        </article>
      );
    })}
  </>;
}

createRoot(document.getElementById('specialty-list')).render(<SpecialtyList />);
createRoot(document.getElementById('professional-list')).render(<ProfessionalList />);

let bookingRoot = null;
let bookingModule;
document.addEventListener('auravital:open-booking', event => {
  if (bookingRoot) return;
  const initialDetail = event.detail || {};
  const container = document.getElementById('booking-react-root');
  if (!bookingModule) container.textContent = 'Abriendo el sistema de turnos…';
  bookingModule ||= import('./BookingWizard.jsx');
  bookingModule.then(({ default: BookingWizard }) => {
    if (bookingRoot) return;
    bookingRoot = createRoot(container);
    bookingRoot.render(<BookingWizard initialDetail={initialDetail} />);
  }).catch(() => { container.textContent = 'No pudimos abrir las reservas. Escribinos por WhatsApp y te ayudamos.'; });
});
