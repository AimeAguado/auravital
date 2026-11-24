(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { user: null, professionals: [], selectedProfessional: null, selectedSlot: null, pendingBooking: false, bookingWizardAuthPending: false, tab: 'login', resetToken: null };
  const modal = $('#turno'); const authModal = $('#auth-modal'); const passwordModal = $('#password-modal'); const appShell = $('#app-shell');
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const dateToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const toast = message => { const el = document.createElement('div'); el.className = 'toast'; el.textContent = message; document.body.append(el); setTimeout(() => el.remove(), 4200); };
  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
    if (response.status === 204) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación.');
    return data;
  }
  const formData = form => Object.fromEntries(new FormData(form).entries());
  async function uploadProfessionalPhoto(professionalId, file) {
    const response = await fetch(`/api/admin/professionals/${encodeURIComponent(professionalId)}/photo`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type }, body: file });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'No se pudo cargar la foto.');
    return result;
  }
  const statusName = status => ({ pending: 'Pendiente', confirmed: 'Confirmado', completed: 'Realizado', cancelled: 'Cancelado', no_show: 'Ausente' }[status] || status);
  const fmtDate = date => new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

  function openModal(element) { element.classList.add('open'); document.body.style.overflow = 'hidden'; }
  function closeModal(element) { element.classList.remove('open'); if (!$('.modal.open')) document.body.style.overflow = ''; if (element === modal) document.dispatchEvent(new Event('auravital:booking-closed')); if (element === authModal && !state.user) state.bookingWizardAuthPending = false; }
  function openBooking(detail = {}) { openModal(modal); document.dispatchEvent(new CustomEvent('auravital:open-booking', { detail })); }
  [modal, authModal, passwordModal].forEach(element => {
    $('.modal-close', element).addEventListener('click', () => closeModal(element));
    element.addEventListener('click', event => { if (event.target === element) closeModal(element); });
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') [modal, authModal, passwordModal].forEach(closeModal); });

  const nav = $('#navlinks'); const menu = $('#menu');
  menu.addEventListener('click', () => { const expanded = nav.classList.toggle('open'); menu.setAttribute('aria-expanded', String(expanded)); menu.textContent = expanded ? '×' : '☰'; });
  nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => { nav.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); menu.textContent = '☰'; }));
  document.addEventListener('click', event => { const link = event.target.closest('a[href^="#"]'); if (document.body.classList.contains('app-mode') && link && !link.hasAttribute('data-booking')) leavePortal(); });

  async function loadProfessionals() {
    const list = $('#professional-list');
    try {
      const result = await api('/api/professionals'); state.professionals = result.professionals;
      document.dispatchEvent(new CustomEvent('auravital:professionals', { detail: state.professionals }));
    } catch (error) { document.dispatchEvent(new CustomEvent('auravital:professionals-error', { detail: error.message })); }
  }

  function chooseProfessional(professional) {
    if (professional.turnerMode === 'BLIPDOC') {
      if (professional.blipdocUrl) window.open(professional.blipdocUrl, '_blank', 'noopener');
      else toast('Este profesional todavía no tiene un enlace de turnos configurado.');
      return;
    }
    openBooking({ professionalId: professional.id });
  }
  $('#professional-list').addEventListener('click', event => {
    const contactButton = event.target.closest('[data-professional-contact]');
    if (contactButton) {
      const name = contactButton.dataset.professionalContact;
      if (contactButton.closest('.professional-card')?.querySelector('.professional-badge.external')) toast(`El enlace de BlipDoc de ${name} todavía no está configurado. Contactanos y te ayudamos a reservar.`);
      else toast(`La agenda de ${name} todavía no está configurada en el turnero. Contactanos para consultar disponibilidad.`);
      return;
    }
    const button = event.target.closest('[data-book-professional]'); if (!button) return;
    const professional = state.professionals.find(item => item.id === button.dataset.bookProfessional); if (professional) chooseProfessional(professional);
  });
  document.addEventListener('click', event => {
    const anchor = event.target.closest('[data-booking]'); if (!anchor) return;
    event.preventDefault();
    openBooking({ service: anchor.dataset.service || '' });
  });
  $('#booking-professional').addEventListener('change', event => {
    const professional = state.professionals.find(item => item.id === event.target.value); if (professional) chooseProfessional(professional);
  });
  $('#booking-date').addEventListener('change', async event => {
    const professionalId = state.selectedProfessional; const date = event.target.value;
    state.selectedSlot = null; $('#booking-form button[type="submit"]').disabled = true;
    if (!professionalId || !date) return;
    $('#booking-slots').innerHTML = '<span class="notice">Buscando disponibilidad...</span>';
    try {
      const data = await api(`/api/professionals/${encodeURIComponent(professionalId)}/availability?from=${encodeURIComponent(date)}&to=${encodeURIComponent(date)}`);
      if (!data.slots.length) { $('#booking-slots').innerHTML = '<span class="notice">No hay horarios disponibles para esta fecha. Probá otro día.</span>'; return; }
      $('#booking-slots').innerHTML = data.slots.map(slot => `<button type="button" class="slot-button" data-slot="${escapeHtml(slot.time)}">${escapeHtml(slot.time)}</button>`).join('');
    } catch (error) { $('#booking-slots').innerHTML = `<span class="notice">${escapeHtml(error.message)}</span>`; }
  });
  $('#booking-slots').addEventListener('click', event => {
    const button = event.target.closest('[data-slot]'); if (!button) return;
    $$('.slot-button', $('#booking-slots')).forEach(item => item.classList.remove('selected'));
    button.classList.add('selected'); state.selectedSlot = button.dataset.slot; $('#booking-form button[type="submit"]').disabled = false;
  });
  $('#booking-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!state.selectedSlot) return;
    if (!state.user) { state.pendingBooking = true; openAuth('login'); toast('Iniciá sesión o creá tu cuenta para confirmar el horario.'); return; }
    await confirmBooking();
  });
  async function confirmBooking() {
    if (!state.selectedProfessional || !state.selectedSlot || !state.user) return;
    try {
      const result = await api('/api/appointments', { method: 'POST', body: JSON.stringify({ professionalId: state.selectedProfessional, date: $('#booking-date').value, time: state.selectedSlot }) });
      const professional = state.professionals.find(item => item.id === result.appointment.professionalId);
      $('#booking-form').hidden = true;
      $('#booking-confirmation').hidden = false;
      $('#booking-confirmation').innerHTML = `<strong>Turno solicitado.</strong><br>${escapeHtml(professional?.name || '')} · ${escapeHtml(fmtDate(result.appointment.date))} a las ${escapeHtml(result.appointment.time)}. Estado: pendiente de confirmación.`;
      toast('El turno quedó registrado.');
      await loadProfessionals();
    } catch (error) { toast(error.message); $('#booking-date').dispatchEvent(new Event('change')); }
  }

  function openAuth(tab = 'login') { state.tab = tab; setAuthTab(tab); openModal(authModal); }
  document.addEventListener('auravital:request-booking-auth', () => { state.bookingWizardAuthPending = true; openAuth('login'); });
  document.addEventListener('auravital:booking-user-updated', event => { state.user = event.detail; updateAccountButton(); });
  function setAuthTab(tab) {
    state.tab = tab;
    $$('#auth-modal [data-auth-tab]').forEach(button => button.classList.toggle('active', button.dataset.authTab === tab));
    const titles = { login: 'Ingresá a tu cuenta.', register: 'Creá tu cuenta.', forgot: 'Recuperar contraseña.', reset: 'Crear nueva contraseña.' };
    $('#auth-modal .auth-tabs').hidden = tab === 'forgot' || tab === 'reset';
    $('#login-form').hidden = tab !== 'login'; $('#register-form').hidden = tab !== 'register';
    $('#forgot-form').hidden = tab !== 'forgot'; $('#reset-form').hidden = tab !== 'reset';
    $('#auth-title').textContent = titles[tab] || titles.login;
  }
  $$('[data-auth-tab]').forEach(button => button.addEventListener('click', () => setAuthTab(button.dataset.authTab)));
  const initialResetToken = new URLSearchParams(location.search).get('reset');
  if (initialResetToken) { state.resetToken = initialResetToken; openAuth('reset'); }
  $('#forgot-link').addEventListener('click', () => { $('#forgot-form').reset(); setAuthTab('forgot'); $('#forgot-form [name="email"]').focus(); });
  $('#forgot-form').addEventListener('submit', async event => {
    event.preventDefault();
    try { await api('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify(formData(event.currentTarget)) }); event.currentTarget.reset(); toast('Si existe una cuenta con ese email, vas a recibir un correo con el enlace para recuperar la contraseña.'); setAuthTab('login'); }
    catch (error) { toast(error.message); }
  });
  $('#reset-form').addEventListener('submit', async event => {
    event.preventDefault(); const data = formData(event.currentTarget);
    if (data.password !== data.confirmPassword) { toast('Las contraseñas no coinciden.'); return; }
    try {
      await api('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: state.resetToken, password: data.password }) });
      state.resetToken = null; history.replaceState({}, '', location.pathname); setAuthTab('login'); closeModal(authModal); toast('Contraseña actualizada. Ingresá con tu nueva contraseña.');
    } catch (error) { toast(error.message); }
  });
  const registerForm = $('#register-form');
  if (!registerForm.elements.phone) {
    const phoneField = document.createElement('div');
    phoneField.className = 'field full';
    phoneField.innerHTML = '<label for="register-phone">Teléfono</label><input id="register-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" pattern="[+0-9() .-]{8,24}" title="Ingresá un teléfono válido con código de área" placeholder="+54 9 ..." required>';
    $('#register-form [name="email"]').closest('.field').before(phoneField);
  }
  $('#account-button').addEventListener('click', () => state.user ? renderPortal() : openAuth());
  async function submitAuth(form, endpoint) {
    try {
      const result = await api(endpoint, { method: 'POST', body: JSON.stringify(formData(form)) });
      state.user = result.user; closeModal(authModal); updateAccountButton();
      if (state.pendingBooking) { state.pendingBooking = false; await confirmBooking(); }
      else if (state.bookingWizardAuthPending) { state.bookingWizardAuthPending = false; document.dispatchEvent(new CustomEvent('auravital:booking-authenticated', { detail: result.user })); }
      else renderPortal();
    } catch (error) { toast(error.message); }
  }
  $('#login-form').addEventListener('submit', event => { event.preventDefault(); submitAuth(event.currentTarget, '/api/auth/login'); });
  $('#register-form').addEventListener('submit', event => { event.preventDefault(); submitAuth(event.currentTarget, '/api/auth/register'); });
  $('#password-form').addEventListener('submit', async event => {
    event.preventDefault(); const data = formData(event.currentTarget);
    if (data.newPassword !== data.confirmPassword) { toast('Las contraseñas nuevas no coinciden.'); return; }
    if (!data.newPassword && data.email === state.user.email) { toast('No hay cambios para guardar.'); return; }
    try {
      const result = await api('/api/account/credentials', { method: 'PATCH', body: JSON.stringify({ email: data.email, currentPassword: data.currentPassword, newPassword: data.newPassword }) });
      state.user = result.user; event.currentTarget.reset(); closeModal(passwordModal); updateAccountButton(); toast('Datos de acceso actualizados.'); renderPortal();
    }
    catch (error) { toast(error.message); }
  });
  function updateAccountButton() {
    $('#account-button').textContent = state.user ? 'Mi cuenta' : 'Ingresar';
    document.body.classList.toggle('professional-user', state.user?.role === 'PROFESSIONAL');
  }

  function showPortal() {
    document.body.classList.add('app-mode'); appShell.hidden = false;
    $$('main > section').forEach(section => { if (section !== appShell) section.hidden = true; });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function leavePortal() {
    document.body.classList.remove('app-mode'); appShell.hidden = true;
    $$('main > section').forEach(section => { if (section !== appShell) section.hidden = false; });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function renderPortal() {
    if (!state.user) return openAuth();
    showPortal();
    appShell.innerHTML = `<div class="portal-head"><div><span class="eyebrow">Espacio privado · ${escapeHtml(state.user.role)}</span><h2>Hola, ${escapeHtml(state.user.firstName || state.user.name)}.</h2><p>${escapeHtml(state.user.email)}</p></div><div><button class="button secondary" id="home-button">Volver al sitio</button> <button class="button secondary" id="password-button">Cuenta y acceso</button> <button class="button" id="logout-button">Cerrar sesión</button></div></div><div id="portal-content"><p class="notice">Cargando tus datos...</p></div>`;
    $('#home-button').addEventListener('click', leavePortal);
    $('#password-button').addEventListener('click', () => { $('#password-form').reset(); $('#account-email').value = state.user.email; openModal(passwordModal); $('#account-email').focus(); });
    $('#logout-button').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); state.user = null; updateAccountButton(); leavePortal(); toast('Sesión cerrada.'); });
    if (state.user.role === 'ADMIN') await renderAdmin();
    else if (state.user.role === 'PROFESSIONAL') await renderProfessional();
    else await renderPatient();
  }
  function appointmentsTable(items, actions = false) {
    if (!items.length) return '<p class="notice">No hay turnos para mostrar.</p>';
    const admin = state.user?.role === 'ADMIN';
    return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Fecha y hora</th><th>Paciente</th><th>Profesional</th><th>Estado</th><th>Importe</th>${actions ? '<th>Acción</th>' : ''}${actions && admin ? '<th>Reasignar</th><th>Editar fecha/importe</th>' : ''}</tr></thead><tbody>${items.map(item => `<tr data-appointment-row="${escapeHtml(item.id)}"><td>${escapeHtml(fmtDate(item.date))} · ${escapeHtml(item.time)}${actions && admin ? `<div><input type="date" data-edit-date value="${escapeHtml(item.date)}"><input type="time" data-edit-time value="${escapeHtml(item.time)}"></div>` : ''}</td><td>${escapeHtml(item.patient?.name || '—')}<small style="display:block;color:var(--muted)">${admin ? escapeHtml(item.patient?.email || '') : ''}</small></td><td>${escapeHtml(item.professional?.name || '—')}</td><td><span class="status-pill">${escapeHtml(statusName(item.status))}</span></td><td>$ ${Number(item.price || 0).toLocaleString('es-AR')}${actions && admin ? `<input type="number" min="0" step="0.01" data-edit-price value="${Number(item.price || 0)}">` : ''}</td>${actions ? `<td>${item.status === 'pending' || item.status === 'confirmed' ? `<select data-status-for="${escapeHtml(item.id)}"><option value="">Cambiar estado</option><option value="confirmed">Confirmado</option><option value="completed">Realizado</option><option value="cancelled">Cancelado</option><option value="no_show">Ausente</option></select>` : '—'}</td>` : ''}${actions && admin ? `<td><select data-reassign-for="${escapeHtml(item.id)}"><option value="">Elegir profesional</option>${state.professionals.filter(professional => professional.active && ((item.source === 'BLIPDOC') === (professional.turnerMode === 'BLIPDOC'))).map(professional => `<option value="${escapeHtml(professional.id)}" ${professional.id === item.professionalId ? 'selected' : ''}>${escapeHtml(professional.name)}</option>`).join('')}</select></td><td><button type="button" class="button secondary small" data-save-appointment="${escapeHtml(item.id)}">Guardar</button></td>` : ''}</tr>`).join('')}</tbody></table></div>`;
  }
  async function renderPatient() {
    const [data] = await Promise.all([api('/api/appointments')]);
    const now = new Date(); const upcoming = data.appointments.filter(item => new Date(item.startAt) >= now && ['pending', 'confirmed'].includes(item.status)); const history = data.appointments.filter(item => !upcoming.includes(item));
    $('#portal-content').innerHTML = `<div class="portal-nav"><button class="button small" data-portal-tab="upcoming">Próximos turnos</button><button class="button secondary small" data-portal-tab="history">Historial</button><button class="button secondary small" data-portal-tab="profile">Mi perfil</button></div><div id="patient-view"></div>`;
    const view = $('#patient-view');
    const show = tab => {
      if (tab === 'profile') view.innerHTML = `<div class="portal-panel"><h3>Mi perfil</h3><form id="profile-form" class="portal-form"><div class="field"><label>Nombre</label><input name="firstName" value="${escapeHtml(state.user.firstName)}" required></div><div class="field"><label>Apellido</label><input name="lastName" value="${escapeHtml(state.user.lastName)}" required></div><button class="button full">Guardar cambios</button></form></div>`;
      else { const list = tab === 'history' ? history : upcoming; view.innerHTML = `<div class="portal-panel"><h3>${tab === 'history' ? 'Historial de turnos' : 'Próximos turnos'}</h3>${list.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Fecha</th><th>Profesional</th><th>Estado</th><th>Importe</th><th></th></tr></thead><tbody>${list.map(item => `<tr><td>${escapeHtml(fmtDate(item.date))} · ${escapeHtml(item.time)}</td><td>${escapeHtml(item.professional?.name || '')}</td><td>${escapeHtml(statusName(item.status))}</td><td>$ ${Number(item.price || 0).toLocaleString('es-AR')}</td><td>${['pending', 'confirmed'].includes(item.status) ? `<button class="button secondary small" data-cancel="${escapeHtml(item.id)}">Cancelar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="notice">Todavía no hay turnos en esta sección.</p>'}</div>`; }
    };
    show('upcoming');
    $$('#portal-content [data-portal-tab]').forEach(button => button.addEventListener('click', () => show(button.dataset.portalTab)));
    view.addEventListener('click', async event => { const button = event.target.closest('[data-cancel]'); if (!button) return; try { await api(`/api/appointments/${button.dataset.cancel}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) }); toast('Turno cancelado.'); renderPortal(); } catch (error) { toast(error.message); } });
    view.addEventListener('submit', async event => { if (event.target.id !== 'profile-form') return; event.preventDefault(); try { const result = await api('/api/profile', { method: 'PATCH', body: JSON.stringify(formData(event.target)) }); state.user = result.user; toast('Perfil actualizado.'); renderPortal(); } catch (error) { toast(error.message); } });
  }
  async function renderProfessionalLegacy() {
    const [profile, data] = await Promise.all([api('/api/professional/me'), api('/api/appointments')]); const professional = profile.professional;
    $('#portal-content').innerHTML = `<div class="portal-grid"><div class="portal-panel"><span class="eyebrow">Especialidad</span><h3>${escapeHtml(professional.specialty)}</h3><p>Turnero Aura Vital · ${professional.durationMinutes} minutos · $ ${Number(professional.price).toLocaleString('es-AR')}</p></div><div class="portal-panel"><span class="eyebrow">Próximos turnos</span><h3>${data.appointments.filter(item => new Date(item.startAt) >= new Date()).length}</h3></div><div class="portal-panel"><span class="eyebrow">Zona horaria</span><h3>Argentina</h3><p>America/Argentina/Buenos_Aires</p></div></div><div class="portal-panel"><h3>Agenda de turnos</h3><div class="portal-nav"><button class="button secondary small" data-range="week">Semana</button><button class="button secondary small" data-range="month">Mes</button><button class="button secondary small" data-range="all">Todos</button></div><div id="professional-appointments">${appointmentsTable(data.appointments, true)}</div></div><div class="portal-panel"><h3>Horarios habituales</h3><p class="notice">Configurá hasta cinco franjas semanales. Los cambios no eliminan reservas existentes.</p><form id="schedule-form" class="portal-form"><div class="field"><label>Día</label><select name="weekday"><option value="1">Lunes</option><option value="2">Martes</option><option value="3">Miércoles</option><option value="4">Jueves</option><option value="5">Viernes</option><option value="6">Sábado</option><option value="0">Domingo</option></select></div><div class="field"><label>Desde</label><input type="time" name="start" value="09:00" required></div><div class="field"><label>Hasta</label><input type="time" name="end" value="17:00" required></div><button class="button full">Agregar horario semanal</button></form><div id="schedule-list"></div></div><div class="portal-panel"><h3>Bloquear fecha o franja</h3><form id="block-form" class="portal-form"><div class="field"><label>Fecha</label><input name="date" type="date" min="${dateToday()}" required></div><div class="field"><label><input type="checkbox" name="allDay"> Día completo</label></div><div class="field"><label>Desde</label><input name="start" type="time" value="09:00"></div><div class="field"><label>Hasta</label><input name="end" type="time" value="17:00"></div><button class="button full">Guardar bloqueo</button></form><div id="block-list"></div></div>`;
    const renderSchedule = schedule => { $('#schedule-list').innerHTML = schedule.map((item, index) => `<span class="tag" style="opacity:${item.enabled === false ? '.5' : '1'}">${['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'][item.weekday]} · ${escapeHtml(item.start)}–${escapeHtml(item.end)} <button type="button" data-toggle-schedule="${index}">${item.enabled === false ? 'Habilitar' : 'Inhabilitar'}</button> <button type="button" data-delete-schedule="${index}" aria-label="Quitar horario">×</button></span>`).join(' ') || '<p class="notice">Aún no configuraste horarios.</p>'; };
    const renderBlocks = blocks => { $('#block-list').innerHTML = blocks.map(block => `<p>${escapeHtml(fmtDate(block.date))} · ${block.allDay ? 'Día completo' : `${escapeHtml(block.start)}–${escapeHtml(block.end)}`} <button class="button secondary small" data-unblock="${escapeHtml(block.id)}">Quitar</button></p>`).join('') || ''; };
    renderSchedule(professional.schedule || []); renderBlocks(professional.blocks || []);
    $('#schedule-list').addEventListener('click', async event => { const toggle = event.target.closest('[data-toggle-schedule]'); const remove = event.target.closest('[data-delete-schedule]'); const index = Number((toggle || remove)?.dataset.toggleSchedule ?? remove?.dataset.deleteSchedule); if (!Number.isInteger(index)) return; const schedule = [...(professional.schedule || [])]; if (toggle) schedule[index] = { ...schedule[index], enabled: schedule[index].enabled === false }; else schedule.splice(index, 1); try { const result = await api('/api/professional/me/schedule', { method: 'PATCH', body: JSON.stringify({ schedule }) }); professional.schedule = result.professional.schedule; renderSchedule(professional.schedule); toast(toggle ? 'Horario actualizado.' : 'Horario eliminado.'); } catch (error) { toast(error.message); } });
    $('#schedule-form').addEventListener('submit', async event => { event.preventDefault(); const schedule = [...(professional.schedule || []), formData(event.target)]; try { const result = await api('/api/professional/me/schedule', { method: 'PATCH', body: JSON.stringify({ schedule }) }); professional.schedule = result.professional.schedule; renderSchedule(professional.schedule); toast('Disponibilidad actualizada.'); } catch (error) { toast(error.message); } });
    $('#block-form').addEventListener('submit', async event => { event.preventDefault(); const data = formData(event.target); data.allDay = event.target.elements.allDay.checked; try { await api('/api/professional/me/blocks', { method: 'POST', body: JSON.stringify(data) }); toast('Bloqueo creado.'); renderPortal(); } catch (error) { toast(error.message); } });
    $('#block-list').addEventListener('click', async event => { const button = event.target.closest('[data-unblock]'); if (!button) return; try { await api(`/api/professional/me/blocks/${button.dataset.unblock}`, { method: 'DELETE' }); toast('Bloqueo eliminado.'); renderPortal(); } catch (error) { toast(error.message); } });
    $('#portal-content').addEventListener('change', async event => { const select = event.target.closest('[data-status-for]'); if (!select || !select.value) return; try { await api(`/api/appointments/${select.dataset.statusFor}/status`, { method: 'PATCH', body: JSON.stringify({ status: select.value }) }); toast('Estado del turno actualizado.'); renderPortal(); } catch (error) { toast(error.message); } });
    const renderCalendar = mode => {
      const anchor = new Date(`${dateToday()}T12:00:00Z`); let first; let count;
      if (mode === 'week') { const weekday = anchor.getUTCDay(); const offset = (weekday + 6) % 7; first = new Date(anchor.getTime() - offset * 86400000); count = 7; }
      else { const monthStart = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1, 12)); const offset = (monthStart.getUTCDay() + 6) % 7; first = new Date(monthStart.getTime() - offset * 86400000); count = 42; }
      const days = Array.from({ length: count }, (_, index) => { const date = new Date(first.getTime() + index * 86400000).toISOString().slice(0, 10); const entries = data.appointments.filter(item => item.date === date); const sameMonth = new Date(`${date}T12:00:00Z`).getUTCMonth() === anchor.getUTCMonth(); return `<div class="calendar-day ${mode === 'month' && !sameMonth ? 'muted' : ''}"><strong>${escapeHtml(fmtDate(date))}</strong>${entries.map(item => `<div class="calendar-entry"><b>${escapeHtml(item.time)}</b> · ${escapeHtml(item.patient?.name || '')}<br><span class="status-pill">${escapeHtml(statusName(item.status))}</span>${['pending','confirmed'].includes(item.status) ? `<select data-status-for="${escapeHtml(item.id)}"><option value="">Estado</option><option value="confirmed">Confirmado</option><option value="completed">Realizado</option><option value="cancelled">Cancelado</option><option value="no_show">Ausente</option></select>` : ''}</div>`).join('')}</div>`; }).join('');
      $('#professional-appointments').innerHTML = `<div class="calendar-grid">${days}</div>`;
    };
    $$('[data-range]').forEach(button => button.addEventListener('click', () => {
      const now = new Date(`${dateToday()}T00:00:00-03:00`);
      if (button.dataset.range === 'week' || button.dataset.range === 'month') { renderCalendar(button.dataset.range); return; }
      const filtered = data.appointments.filter(item => new Date(item.startAt) >= now); $('#professional-appointments').innerHTML = appointmentsTable(filtered, true);
    }));
  }

  async function renderProfessional() {
    const [profile, data] = await Promise.all([api('/api/professional/me'), api('/api/appointments')]);
    let professional = profile.professional;
    let appointments = data.appointments;
    let treatmentDraft = Array.isArray(professional.treatments)
      ? professional.treatments.map(item => ({ ...item }))
      : [{ id: '', name: professional.specialty, durationMinutes: professional.durationMinutes || 30, price: professional.price || 0, active: true }];
    const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const isInternal = professional.turnerMode === 'AURA_VITAL';
    let calendarMonth = new Date(); calendarMonth.setDate(1);
    let selectedAgendaDate = dateToday();
    $('#portal-content').innerHTML = `<div class="professional-dashboard"><nav class="professional-side-nav" aria-label="Gestión profesional"><span class="eyebrow">Mi espacio</span><strong>${escapeHtml(professional.name)}</strong><button type="button" data-prof-tab="agenda">Agenda y horarios</button><button type="button" data-prof-tab="blocks">Bloqueos</button><button type="button" data-prof-tab="values">Tratamientos y valores</button><button type="button" data-prof-tab="appointments">Turnos reservados</button><div class="professional-side-foot">${escapeHtml(professional.specialty)}<button type="button" id="professional-logout-shortcut">Cerrar sesión</button></div></nav><section class="professional-workspace"><div class="professional-workspace-heading"><span class="eyebrow">Panel profesional · Aura Vital</span><h2>${escapeHtml(professional.specialty)}</h2><p>Administrá tu agenda, tus servicios y los valores de atención.</p></div><div id="professional-pane"></div></section></div>`;
    const pane = $('#professional-pane');
    const enabledSchedule = () => (professional.schedule || []).filter(item => item.enabled !== false);
    const calendarDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const renderDateCalendar = () => {
      const first = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
      const offset = (first.getDay() + 6) % 7;
      const lastDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
      const blanks = Array.from({ length: offset }, (_, index) => `<span class="professional-calendar-blank" key="blank-${index}"></span>`).join('');
      const dateButtons = Array.from({ length: lastDay }, (_, index) => {
        const day = index + 1; const value = calendarDate(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day));
        const override = (professional.dateSchedules || []).find(item => item.date === value);
        const hasHours = override?.intervals?.some(item => item.enabled !== false);
        return `<button type="button" class="professional-calendar-day${value === selectedAgendaDate ? ' selected' : ''}${hasHours ? ' has-hours' : ''}" data-calendar-date="${value}" ${value < dateToday() ? 'disabled' : ''}><span>${day}</span>${hasHours ? '<i aria-label="Tiene horarios"></i>' : ''}</button>`;
      }).join('');
      const monthName = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(calendarMonth);
      const selected = (professional.dateSchedules || []).find(item => item.date === selectedAgendaDate);
      const weekly = (professional.schedule || []).filter(item => Number(item.weekday) === new Date(`${selectedAgendaDate}T12:00:00Z`).getUTCDay() && item.enabled !== false);
      const selectedRanges = selected?.intervals || [];
      const currentRanges = selected ? selectedRanges : weekly;
      const rangesHtml = currentRanges.map((item, index) => `<div class="professional-date-range${item.enabled === false ? ' disabled' : ''}"><span>${escapeHtml(item.start)} – ${escapeHtml(item.end)}${!selected ? ' · semanal' : ''}</span>${selected ? `<button type="button" data-date-range-toggle="${index}" aria-label="${item.enabled === false ? 'Habilitar' : 'Inhabilitar'} franja">${item.enabled === false ? 'Habilitar' : '×'}</button>` : ''}</div>`).join('') || `<p class="professional-date-empty">${selected ? 'No hay horarios específicos cargados para esta fecha.' : 'No hay horario semanal para este día.'}</p>`;
      return `<div class="portal-panel professional-date-calendar-panel"><div class="professional-panel-heading"><div><h3>Días para turnos pactados</h3><p>Elegí una fecha del calendario y agregá las franjas disponibles para ese día.</p></div><span class="professional-live-badge">Fechas puntuales</span></div><div class="professional-date-calendar-layout"><div class="professional-month-calendar"><div class="professional-month-heading"><button type="button" data-calendar-month="-1" aria-label="Mes anterior">‹</button><strong>${escapeHtml(monthName)}</strong><button type="button" data-calendar-month="1" aria-label="Mes siguiente">›</button></div><div class="professional-month-grid">${['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(label => `<span class="professional-calendar-weekday">${label}</span>`).join('')}${blanks}${dateButtons}</div><div class="professional-calendar-legend"><span><i class="configured"></i>Con horarios puntuales</span><span><i></i>Sin configurar</span></div></div><div class="professional-date-editor"><span class="eyebrow">Disponibilidad puntual</span><h4>${escapeHtml(fmtDate(selectedAgendaDate))}</h4><div class="professional-date-ranges">${rangesHtml}</div>${selected ? '<button type="button" class="professional-reset-date" data-reset-date-schedule>Restablecer horario semanal</button>' : `<p class="professional-date-hint">${weekly.length ? 'Este día usa el horario semanal. Al agregar franjas, esta fecha tendrá su propia disponibilidad.' : 'Agregá una o más franjas para habilitar reservas en esta fecha.'}</p>`}<form id="professional-date-hours-form" class="portal-form professional-date-hours-form"><div class="field"><label>Desde</label><input name="start" type="time" value="09:00" required></div><div class="field"><label>Hasta</label><input name="end" type="time" value="13:00" required></div><button class="button">+ Agregar horario</button></form></div></div></div>`;
    };
    const showAgenda = () => {
      if (!isInternal) {
        pane.innerHTML = `<div class="portal-panel professional-external-note"><span class="eyebrow">Agenda externa</span><h3>Tu agenda se administra en BlipDoc</h3><p>Los horarios y reservas de esta especialidad se gestionan desde tu agenda externa. Los tratamientos y valores que configures en este panel se guardan en Aura Vital.</p>${professional.blipdocUrl ? `<a class="button" href="${escapeHtml(professional.blipdocUrl)}" target="_blank" rel="noopener noreferrer">Abrir BlipDoc ↗</a>` : ''}</div>`;
        return;
      }
      const rows = days.map((day, weekday) => {
        const entries = (professional.schedule || []).map((entry, index) => ({ ...entry, index })).filter(entry => Number(entry.weekday) === weekday);
        const active = entries.some(entry => entry.enabled !== false);
        return `<div class="professional-schedule-day${active ? '' : ' disabled'}"><div class="professional-day-label"><span class="professional-toggle${active ? ' on' : ''}" aria-hidden="true"></span><strong>${day}</strong></div><div class="professional-day-slots">${entries.length ? entries.map(entry => `<span class="professional-time-chip${entry.enabled === false ? ' disabled' : ''}">${escapeHtml(entry.start)} – ${escapeHtml(entry.end)}<button type="button" data-schedule-remove="${entry.index}" aria-label="Quitar horario">×</button></span>`).join('') : '<span class="professional-no-time">Sin horario</span>'}</div>${entries.length ? `<button class="professional-day-switch" type="button" data-schedule-toggle="${weekday}">${active ? 'Inhabilitar día' : 'Habilitar día'}</button>` : ''}</div>`;
      }).join('');
      pane.innerHTML = `${renderDateCalendar()}<div class="professional-content-grid"><div class="portal-panel professional-schedule-panel"><div class="professional-panel-heading"><div><h3>Horarios habituales</h3><p>Franjas semanales disponibles como base para tus turnos regulares.</p></div><span class="professional-live-badge">Agenda Aura Vital</span></div><div class="professional-schedule-list">${rows}</div><form id="professional-schedule-form" class="portal-form professional-add-hours"><div class="field"><label>Día</label><select name="weekday">${days.map((day, index) => `<option value="${index}">${day}</option>`).join('')}</select></div><div class="field"><label>Desde</label><input name="start" type="time" value="09:00" required></div><div class="field"><label>Hasta</label><input name="end" type="time" value="17:00" required></div><button class="button">Agregar horario</button></form><p class="professional-duration-note">Duración del turno: <strong>${professional.durationMinutes} min</strong> · Editala en Tratamientos y valores.</p></div><div class="portal-panel professional-schedule-help"><span class="eyebrow">Disponibilidad</span><h3>${enabledSchedule().length} franjas activas</h3><p>Los horarios semanales se aplican salvo en las fechas que configures en el calendario. Las reservas existentes se mantienen.</p><button type="button" class="button secondary" data-prof-tab="blocks">Administrar bloqueos</button></div></div>`;
      $('#professional-schedule-form').addEventListener('submit', async event => {
        event.preventDefault();
        const schedule = [...(professional.schedule || []), formData(event.currentTarget)];
        try { const result = await api('/api/professional/me/schedule', { method: 'PATCH', body: JSON.stringify({ schedule }) }); professional = result.professional; showAgenda(); toast('Horario agregado.'); }
        catch (error) { toast(error.message); }
      });
      $('#professional-date-hours-form').addEventListener('submit', async event => {
        event.preventDefault();
        const next = [...(professional.dateSchedules || [])];
        const existing = next.find(day => day.date === selectedAgendaDate);
        const interval = formData(event.currentTarget);
        if (existing) existing.intervals.push({ ...interval, enabled: true });
        else next.push({ date: selectedAgendaDate, intervals: [{ ...interval, enabled: true }] });
        try { const result = await api('/api/professional/me/date-schedule', { method: 'PATCH', body: JSON.stringify({ dateSchedules: next }) }); professional = result.professional; showAgenda(); toast('Disponibilidad para la fecha agregada.'); }
        catch (error) { toast(error.message); }
      });
    };
    const showBlocks = async () => {
      if (!isInternal) { pane.innerHTML = '<div class="portal-panel professional-external-note"><span class="eyebrow">Agenda externa</span><h3>Los bloqueos se gestionan en BlipDoc</h3><p>Para bloquear vacaciones, licencias o franjas horarias, actualizá tu agenda externa.</p></div>'; return; }
      try { const result = await api('/api/professional/me'); professional = result.professional; }
      catch (error) { toast(error.message); }
      pane.innerHTML = `<div class="professional-content-grid"><div class="portal-panel"><div class="professional-panel-heading"><div><h3>Días y horarios bloqueados</h3><p>Vacaciones, congresos o imprevistos: no se podrán reservar.</p></div></div><div class="professional-block-list">${(professional.blocks || []).map(block => `<article class="professional-block-item"><span><strong>${escapeHtml(fmtDate(block.date))}</strong><small>${block.allDay ? 'Todo el día' : `${escapeHtml(block.start)} – ${escapeHtml(block.end)}`}</small></span><button type="button" data-unblock="${escapeHtml(block.id)}" aria-label="Quitar bloqueo">×</button></article>`).join('') || '<p class="notice">Todavía no hay días bloqueados.</p>'}</div><form id="professional-block-form" class="portal-form professional-block-form"><div class="field"><label>Fecha</label><input name="date" type="date" min="${dateToday()}" required></div><div class="field"><label class="professional-checkbox-label"><input name="allDay" type="checkbox"> Todo el día</label></div><div class="field"><label>Desde</label><input name="start" type="time" value="09:00"></div><div class="field"><label>Hasta</label><input name="end" type="time" value="17:00"></div><button class="button secondary">+ Bloquear día u horario</button></form></div><div class="portal-panel professional-schedule-help"><span class="eyebrow">Tu agenda</span><h3>Bloqueos activos</h3><p>Al quitar un bloqueo, los horarios habituales vuelven a estar disponibles, excepto si ya fueron reservados.</p><button type="button" class="button secondary" data-prof-tab="agenda">Volver a horarios</button></div></div>`;
      $('#professional-block-form').addEventListener('submit', async event => { event.preventDefault(); const values = formData(event.currentTarget); values.allDay = event.currentTarget.elements.allDay.checked; try { await api('/api/professional/me/blocks', { method: 'POST', body: JSON.stringify(values) }); toast('Bloqueo agregado.'); showBlocks(); } catch (error) { toast(error.message); } });
    };
    const readTreatmentRows = () => $$('#treatment-editor [data-treatment-row]').map(row => ({ id: row.dataset.treatmentId || '', name: $('[name="treatmentName"]', row).value.trim(), durationMinutes: Number($('[name="treatmentDuration"]', row).value), price: Number($('[name="treatmentPrice"]', row).value), active: $('[name="treatmentActive"]', row).checked }));
    const renderTreatmentRows = () => {
      const list = $('#treatment-list');
      if (!list) return;
      list.innerHTML = treatmentDraft.map((item, index) => `<article class="professional-treatment-row" data-treatment-row data-treatment-id="${escapeHtml(item.id || '')}"><label class="professional-treatment-active"><input name="treatmentActive" type="checkbox" ${item.active !== false ? 'checked' : ''}><span>Activo</span></label><div class="field"><label>Tratamiento / servicio</label><input name="treatmentName" value="${escapeHtml(item.name || '')}" maxlength="160" required></div><div class="field"><label>Duración (min)</label><input name="treatmentDuration" type="number" min="10" max="240" step="5" value="${Number(item.durationMinutes || 30)}" required></div><div class="field"><label>Valor ($)</label><input name="treatmentPrice" type="number" min="0" max="100000000" step="100" value="${Number(item.price || 0)}" required></div><button type="button" class="professional-remove-treatment" data-remove-treatment="${index}" aria-label="Eliminar tratamiento">×</button></article>`).join('') || '<p class="notice">Aún no publicaste tratamientos. Agregá los servicios que ofrecés.</p>';
    };
    const showValues = () => {
      pane.innerHTML = `<div class="portal-panel professional-values-panel"><div class="professional-panel-heading"><div><h3>Tratamientos y valores</h3><p>Los valores se mostrarán junto a cada servicio al reservar.</p></div><span class="professional-live-badge">${isInternal ? 'Aura Vital' : 'Perfil profesional'}</span></div><form id="treatment-editor"><div id="treatment-list"></div><div class="professional-treatment-actions"><button type="button" class="button secondary" id="add-treatment">+ Agregar tratamiento</button><button type="submit" class="button" id="save-treatments">Guardar cambios</button></div></form><p class="professional-values-footnote">La duración y el valor del primer servicio también se usan como referencia general de tu agenda.</p></div>`;
      renderTreatmentRows();
      $('#add-treatment').addEventListener('click', () => { treatmentDraft = readTreatmentRows(); treatmentDraft.push({ id: '', name: '', durationMinutes: professional.durationMinutes || 30, price: 0, active: true }); renderTreatmentRows(); });
      $('#treatment-list').addEventListener('click', event => { const button = event.target.closest('[data-remove-treatment]'); if (!button) return; treatmentDraft = readTreatmentRows(); treatmentDraft.splice(Number(button.dataset.removeTreatment), 1); renderTreatmentRows(); });
      $('#treatment-editor').addEventListener('submit', async event => {
        event.preventDefault();
        const treatments = readTreatmentRows();
        const primary = treatments.find(item => item.active) || treatments[0];
        try {
          const result = await api('/api/professional/me/settings', { method: 'PATCH', body: JSON.stringify({ price: primary?.price ?? professional.price ?? 0, durationMinutes: primary?.durationMinutes ?? professional.durationMinutes ?? 30, treatments }) });
          professional = result.professional; treatmentDraft = professional.treatments; toast('Tratamientos y valores actualizados.'); showValues();
        } catch (error) { toast(error.message); }
      });
    };
    const showAppointments = () => {
      pane.innerHTML = `<div class="portal-panel"><div class="professional-panel-heading"><div><h3>Turnos reservados</h3><p>Consultá y actualizá el estado de tus reservas.</p></div></div><div id="professional-appointments">${appointmentsTable(appointments, true)}</div></div>`;
      $('#professional-appointments').addEventListener('change', async event => { const select = event.target.closest('[data-status-for]'); if (!select || !select.value) return; try { await api(`/api/appointments/${select.dataset.statusFor}/status`, { method: 'PATCH', body: JSON.stringify({ status: select.value }) }); toast('Estado del turno actualizado.'); const response = await api('/api/appointments'); appointments = response.appointments; showAppointments(); } catch (error) { toast(error.message); } });
    };
    const panels = { agenda: showAgenda, blocks: showBlocks, values: showValues, appointments: showAppointments };
    const selectTab = async tab => {
      if (!panels[tab]) return;
      $$('.professional-side-nav [data-prof-tab]').forEach(button => { button.classList.toggle('active', button.dataset.profTab === tab); button.setAttribute('aria-current', button.dataset.profTab === tab ? 'page' : 'false'); });
      await panels[tab]();
    };
    $('#professional-logout-shortcut').addEventListener('click', () => $('#logout-button').click());
    $('.professional-side-nav').addEventListener('click', event => { const button = event.target.closest('[data-prof-tab]'); if (button) selectTab(button.dataset.profTab).catch(error => toast(error.message)); });
    pane.addEventListener('click', async event => {
      const dateButton = event.target.closest('[data-calendar-date]');
      const monthButton = event.target.closest('[data-calendar-month]');
      const rangeToggle = event.target.closest('[data-date-range-toggle]');
      const resetDate = event.target.closest('[data-reset-date-schedule]');
      const toggle = event.target.closest('[data-schedule-toggle]');
      const remove = event.target.closest('[data-schedule-remove]');
      const unblock = event.target.closest('[data-unblock]');
      try {
        if (dateButton) { selectedAgendaDate = dateButton.dataset.calendarDate; showAgenda(); }
        else if (monthButton) {
          calendarMonth.setMonth(calendarMonth.getMonth() + Number(monthButton.dataset.calendarMonth));
          const first = calendarDate(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1));
          selectedAgendaDate = first < dateToday() ? dateToday() : first;
          showAgenda();
        } else if (rangeToggle) {
          const dateSchedules = [...(professional.dateSchedules || [])].map(day => day.date === selectedAgendaDate ? { ...day, intervals: day.intervals.map((interval, index) => index === Number(rangeToggle.dataset.dateRangeToggle) ? { ...interval, enabled: interval.enabled === false } : interval) } : day);
          const result = await api('/api/professional/me/date-schedule', { method: 'PATCH', body: JSON.stringify({ dateSchedules }) }); professional = result.professional; showAgenda(); toast('Disponibilidad puntual actualizada.');
        } else if (resetDate) {
          const dateSchedules = (professional.dateSchedules || []).filter(day => day.date !== selectedAgendaDate);
          const result = await api('/api/professional/me/date-schedule', { method: 'PATCH', body: JSON.stringify({ dateSchedules }) }); professional = result.professional; showAgenda(); toast('Se restauró el horario semanal para esa fecha.');
        } else if (toggle) {
          const weekday = Number(toggle.dataset.scheduleToggle); const schedule = (professional.schedule || []).map(item => Number(item.weekday) === weekday ? { ...item, enabled: item.enabled === false } : item);
          const result = await api('/api/professional/me/schedule', { method: 'PATCH', body: JSON.stringify({ schedule }) }); professional = result.professional; showAgenda(); toast('Disponibilidad actualizada.');
        } else if (remove) {
          const schedule = (professional.schedule || []).filter((_, index) => index !== Number(remove.dataset.scheduleRemove));
          const result = await api('/api/professional/me/schedule', { method: 'PATCH', body: JSON.stringify({ schedule }) }); professional = result.professional; showAgenda(); toast('Franja eliminada.');
        } else if (unblock) { await api(`/api/professional/me/blocks/${unblock.dataset.unblock}`, { method: 'DELETE' }); toast('Bloqueo eliminado.'); showBlocks(); }
      } catch (error) { toast(error.message); }
    });
    await selectTab('agenda');
  }

  async function renderAdmin() {
    const [professionalsData, appointmentsData] = await Promise.all([api('/api/admin/professionals'), api('/api/appointments')]); let stats = await api('/api/admin/stats');
    $('#portal-content').innerHTML = `<div class="portal-nav"><button class="button small" data-admin-tab="overview">Resumen</button><button class="button secondary small" data-admin-tab="professionals">Profesionales</button><button class="button secondary small" data-admin-tab="appointments">Turnos</button><button class="button secondary small" data-admin-tab="settings">Reglas</button></div><div id="admin-view"></div>`;
    const view = $('#admin-view');
    const showOverview = () => { view.innerHTML = `<div class="portal-grid"><div class="portal-panel"><span class="eyebrow">Turnos totales</span><h3>${stats.total}</h3></div><div class="portal-panel"><span class="eyebrow">Realizados</span><h3>${stats.completed}</h3></div><div class="portal-panel"><span class="eyebrow">Pendientes</span><h3>${stats.pending}</h3></div><div class="portal-panel"><span class="eyebrow">Cancelados</span><h3>${stats.cancelled}</h3></div><div class="portal-panel"><span class="eyebrow">Facturación interna</span><h3>$ ${Number(stats.revenue).toLocaleString('es-AR')}</h3></div><div class="portal-panel"><span class="eyebrow">BlipDoc externo</span><h3>${stats.externalAppointments}</h3><p>Sin integración de reservas/facturación externas.</p></div></div><div class="portal-panel"><h3>Estadísticas por profesional</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Profesional</th><th>Turnero</th><th>Total</th><th>Realizados</th><th>Cancelados</th><th>Pendientes</th><th>Facturación</th></tr></thead><tbody>${stats.byProfessional.map(item => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.turnerMode)}</td><td>${item.total}</td><td>${item.completed}</td><td>${item.cancelled}</td><td>${item.pending}</td><td>$ ${Number(item.revenue).toLocaleString('es-AR')}</td></tr>`).join('')}</tbody></table></div></div><div class="portal-panel"><h3>Facturación mensual</h3>${stats.byPeriod.map(item => `<p>${escapeHtml(item.period)} · ${item.appointments} turnos · $ ${Number(item.revenue).toLocaleString('es-AR')}</p>`).join('') || '<p class="notice">Sin actividad para el período.</p>'}</div>`; };
    const showProfessionals = () => {
      view.innerHTML = `<div class="portal-panel"><h3>Dar de alta profesional</h3><form id="new-professional" class="portal-form"><div class="field"><label>Nombre y apellido</label><input name="name" required></div><div class="field"><label>Especialidad</label><input name="specialty" required></div><div class="field"><label>Email de acceso</label><input name="email" type="email" required></div><div class="field"><label>Contraseña inicial (mínimo 10)</label><input name="password" type="password" minlength="10" required></div><div class="field"><label>Precio</label><input name="price" type="number" min="0" step="0.01" required></div><div class="field"><label>Duración (minutos)</label><input name="durationMinutes" type="number" min="10" max="240" step="5" value="30" required></div><div class="field"><label>Modalidad</label><select name="turnerMode"><option value="AURA_VITAL">Turnero Aura Vital</option><option value="BLIPDOC">BlipDoc</option></select></div><div class="field"><label>Enlace BlipDoc (HTTPS)</label><input name="blipdocUrl" type="url" placeholder="https://..."></div><div class="field full"><label>Descripción</label><textarea name="description" rows="3"></textarea></div><div class="field full"><label>Foto (JPG, PNG o WebP · máx. 6 MB)</label><input name="photoFile" type="file" accept="image/jpeg,image/png,image/webp"></div><button class="button full">Crear profesional</button></form></div><div class="portal-panel"><h3>Equipo profesional</h3>${professionalsData.professionals.map(item => `<article class="profile-card"><strong>${escapeHtml(item.name)}</strong> · ${escapeHtml(item.specialty)} · ${item.active ? 'Activo' : 'Inactivo'} · ${escapeHtml(item.turnerMode)}<form class="professional-edit portal-form" data-professional="${escapeHtml(item.id)}"><div class="field"><label>Modalidad</label><select name="turnerMode"><option value="AURA_VITAL" ${item.turnerMode === 'AURA_VITAL' ? 'selected' : ''}>Aura Vital</option><option value="BLIPDOC" ${item.turnerMode === 'BLIPDOC' ? 'selected' : ''}>BlipDoc</option></select></div><div class="field"><label>Enlace externo</label><input name="blipdocUrl" type="url" value="${escapeHtml(item.blipdocUrl || '')}"></div><div class="field"><label>Precio</label><input name="price" type="number" min="0" step="0.01" value="${Number(item.price)}"></div><div class="field"><label>Duración</label><input name="durationMinutes" type="number" min="10" max="240" value="${Number(item.durationMinutes)}"></div><div class="field"><label>Estado</label><select name="active"><option value="true" ${item.active ? 'selected' : ''}>Activo</option><option value="false" ${!item.active ? 'selected' : ''}>Inactivo</option></select></div><button class="button small">Guardar</button></form></article>`).join('') || '<p class="notice">Todavía no hay profesionales dados de alta.</p>'}</div>`;
      $('#new-professional').querySelectorAll('[name="price"], [name="durationMinutes"]').forEach(input => input.closest('.field')?.remove());
      professionalsData.professionals.forEach(item => { const form = $(`.professional-edit[data-professional="${item.id}"]`); if (!form) return; form.insertAdjacentHTML('afterbegin', `<div class="field"><label>Nombre</label><input name="name" value="${escapeHtml(item.name)}" required></div><div class="field"><label>Especialidad</label><input name="specialty" value="${escapeHtml(item.specialty)}" required></div><div class="field"><label>Email de acceso</label><input name="email" type="email" value="${escapeHtml(item.email || '')}" required></div><div class="field"><label>Cambiar contraseña (opcional)</label><input name="password" type="password" minlength="10" autocomplete="new-password"></div><div class="field full"><label>Descripción</label><textarea name="description" rows="2">${escapeHtml(item.description || '')}</textarea></div><div class="field full"><label>Foto actual</label>${item.photo ? `<img class="admin-photo-preview" src="${escapeHtml(item.photo)}" alt="Foto de ${escapeHtml(item.name)}">` : '<span class="notice">Sin foto cargada</span>'}</div><div class="field full"><label>Cambiar foto (JPG, PNG o WebP · máx. 6 MB)</label><input name="photoFile" type="file" accept="image/jpeg,image/png,image/webp"></div>`); form.querySelectorAll('[name="price"], [name="durationMinutes"]').forEach(input => input.closest('.field')?.remove()); });
      $('#new-professional').addEventListener('submit', async event => { event.preventDefault(); const data = formData(event.target); const file = data.photoFile; delete data.photoFile; try { const created = await api('/api/admin/professionals', { method: 'POST', body: JSON.stringify(data) }); if (file && file.size) await uploadProfessionalPhoto(created.professional.id, file); toast('Profesional creado. El profesional podrá cargar sus tratamientos y valores desde su cuenta.'); await loadProfessionals(); renderPortal(); } catch (error) { toast(error.message); } });
      $$('.professional-edit').forEach(form => form.addEventListener('submit', async event => { event.preventDefault(); const data = formData(form); data.active = data.active === 'true'; const file = data.photoFile; delete data.photoFile; try { await api(`/api/admin/professionals/${form.dataset.professional}`, { method: 'PATCH', body: JSON.stringify(data) }); if (file && file.size) await uploadProfessionalPhoto(form.dataset.professional, file); toast('Profesional actualizado.'); await loadProfessionals(); renderPortal(); } catch (error) { toast(error.message); } }));
      professionalsData.professionals.filter(item => item.turnerMode === 'AURA_VITAL').forEach(professional => {
        const edit = $(`.professional-edit[data-professional="${professional.id}"]`); if (!edit) return;
        edit.insertAdjacentHTML('afterend', `<form class="admin-schedule-form portal-form" data-schedule-professional="${escapeHtml(professional.id)}"><strong class="field full">Disponibilidad semanal</strong><div class="field"><label>Día</label><select name="weekday"><option value="1">Lunes</option><option value="2">Martes</option><option value="3">Miércoles</option><option value="4">Jueves</option><option value="5">Viernes</option><option value="6">Sábado</option><option value="0">Domingo</option></select></div><div class="field"><label>Desde</label><input name="start" type="time" value="09:00" required></div><div class="field"><label>Hasta</label><input name="end" type="time" value="17:00" required></div><button class="button small">Agregar horario</button><div class="field full">${(professional.schedule || []).map((item, index) => `<span class="tag">${['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'][item.weekday]} ${escapeHtml(item.start)}–${escapeHtml(item.end)} <button type="button" data-admin-toggle="${index}">${item.enabled === false ? 'Habilitar' : 'Inhabilitar'}</button> <button type="button" data-admin-remove="${index}">×</button></span>`).join('') || 'Sin horarios todavía'}</div></form><form class="admin-block-form portal-form" data-block-professional="${escapeHtml(professional.id)}"><strong class="field full">Bloquear disponibilidad</strong><div class="field"><label>Fecha</label><input name="date" type="date" min="${dateToday()}" required></div><div class="field"><label><input name="allDay" type="checkbox"> Día completo</label></div><div class="field"><label>Desde</label><input name="start" type="time" value="09:00"></div><div class="field"><label>Hasta</label><input name="end" type="time" value="17:00"></div><button class="button secondary small">Crear bloqueo</button><div class="field full">${(professional.blocks || []).map(block => `<span class="tag">${escapeHtml(fmtDate(block.date))} ${block.allDay ? 'día completo' : `${escapeHtml(block.start)}–${escapeHtml(block.end)}`} <button type="button" data-remove-block="${escapeHtml(block.id)}">Quitar</button></span>`).join('')}</div></form>`);
      });
      $$('.admin-schedule-form').forEach(form => {
        const professional = professionalsData.professionals.find(item => item.id === form.dataset.scheduleProfessional);
        form.addEventListener('submit', async event => { event.preventDefault(); const schedule = [...(professional.schedule || []), formData(form)]; try { await api(`/api/admin/professionals/${professional.id}/schedule`, { method: 'PATCH', body: JSON.stringify({ schedule }) }); toast('Disponibilidad del profesional actualizada.'); renderPortal(); } catch (error) { toast(error.message); } });
        form.addEventListener('click', async event => { const toggle = event.target.closest('[data-admin-toggle]'); const remove = event.target.closest('[data-admin-remove]'); if (!toggle && !remove) return; const index = Number(toggle?.dataset.adminToggle ?? remove.dataset.adminRemove); const schedule = [...(professional.schedule || [])]; if (toggle) schedule[index] = { ...schedule[index], enabled: schedule[index].enabled === false }; else schedule.splice(index, 1); try { await api(`/api/admin/professionals/${professional.id}/schedule`, { method: 'PATCH', body: JSON.stringify({ schedule }) }); toast('Disponibilidad actualizada.'); renderPortal(); } catch (error) { toast(error.message); } });
      });
      $$('.admin-block-form').forEach(form => {
        form.addEventListener('submit', async event => { event.preventDefault(); const data = formData(form); data.allDay = form.elements.allDay.checked; try { await api(`/api/admin/professionals/${form.dataset.blockProfessional}/blocks`, { method: 'POST', body: JSON.stringify(data) }); toast('Bloqueo creado.'); renderPortal(); } catch (error) { toast(error.message); } });
        form.addEventListener('click', async event => { const button = event.target.closest('[data-remove-block]'); if (!button) return; try { await api(`/api/admin/professionals/${form.dataset.blockProfessional}/blocks/${button.dataset.removeBlock}`, { method: 'DELETE' }); toast('Bloqueo quitado.'); renderPortal(); } catch (error) { toast(error.message); } });
      });
    };
    const showAppointments = () => { view.innerHTML = `<div class="portal-panel"><h3>Todos los turnos</h3><div class="portal-form"><div class="field"><label>Profesional</label><select id="filter-professional"><option value="">Todos</option>${professionalsData.professionals.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')}</select></div><div class="field"><label>Estado</label><select id="filter-status"><option value="">Todos</option><option value="pending">Pendiente</option><option value="confirmed">Confirmado</option><option value="completed">Realizado</option><option value="cancelled">Cancelado</option><option value="no_show">Ausente</option></select></div><div class="field"><label>Desde</label><input id="filter-from" type="date"></div><div class="field"><label>Hasta</label><input id="filter-to" type="date"></div></div><div id="admin-appointments">${appointmentsTable(appointmentsData.appointments, true)}</div></div><div class="portal-panel"><h3>Registrar turno externo BlipDoc</h3><p>Ingresá solo datos confirmados manualmente; estos registros quedan separados de los turnos internos.</p><form id="external-appointment" class="portal-form"><div class="field"><label>Profesional</label><select name="professionalId" required>${professionalsData.professionals.filter(item => item.turnerMode === 'BLIPDOC').map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')}</select></div><div class="field"><label>Email del paciente registrado</label><input name="patientEmail" type="email" required></div><div class="field"><label>Fecha</label><input name="date" type="date" required></div><div class="field"><label>Hora</label><input name="time" type="time" required></div><div class="field"><label>Importe</label><input name="price" type="number" min="0" step="0.01" required></div><button class="button full">Registrar dato externo</button></form></div>`;
      view.insertAdjacentHTML('beforeend', `<div class="portal-panel"><h3>Crear turno interno manual</h3><p>Usá esta opción para una reserva telefónica o presencial. Solo se confirma si el profesional tiene habilitado ese horario.</p><form id="manual-internal-appointment" class="portal-form"><div class="field"><label>Profesional</label><select name="professionalId" required>${professionalsData.professionals.filter(item => item.active && item.turnerMode === 'AURA_VITAL').map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')}</select></div><div class="field"><label>Email del paciente registrado</label><input name="patientEmail" type="email" required></div><div class="field"><label>Fecha</label><input name="date" type="date" min="${dateToday()}" required></div><div class="field"><label>Hora</label><input name="time" type="time" required></div><div class="field"><label>Importe</label><input name="price" type="number" min="0" step="0.01" required></div><button class="button full">Crear turno interno</button></form></div>`);
      $('#manual-internal-appointment').addEventListener('submit', async event => { event.preventDefault(); const data = formData(event.target); data.price = Number(data.price); try { await api('/api/admin/appointments', { method: 'POST', body: JSON.stringify(data) }); toast('Turno interno creado.'); renderPortal(); } catch (error) { toast(error.message); } });
      const filter = async () => { const query = new URLSearchParams(); for (const [key, selector] of [['professionalId', '#filter-professional'], ['status', '#filter-status'], ['from', '#filter-from'], ['to', '#filter-to']]) if ($(selector).value) query.set(key, $(selector).value); const data = await api(`/api/appointments?${query}`); $('#admin-appointments').innerHTML = appointmentsTable(data.appointments, true); };
      $('.portal-form', view).insertAdjacentHTML('beforeend', '<div class="field"><label>Buscar paciente (nombre/email)</label><input id="filter-patient" type="search" placeholder="Escribí al menos 2 caracteres"></div>');
      let patientSearchTimer; $('#filter-patient').addEventListener('input', () => { clearTimeout(patientSearchTimer); patientSearchTimer = setTimeout(async () => { const query = new URLSearchParams(); const patient = $('#filter-patient').value.trim(); if (patient.length < 2) return; query.set('patient', patient); if ($('#filter-professional').value) query.set('professionalId', $('#filter-professional').value); if ($('#filter-status').value) query.set('status', $('#filter-status').value); if ($('#filter-from').value) query.set('from', $('#filter-from').value); if ($('#filter-to').value) query.set('to', $('#filter-to').value); try { const result = await api(`/api/appointments?${query}`); $('#admin-appointments').innerHTML = appointmentsTable(result.appointments, true); } catch (error) { toast(error.message); } }, 250); });
      ['#filter-professional', '#filter-status', '#filter-from', '#filter-to'].forEach(selector => $(selector).addEventListener('change', () => filter().catch(error => toast(error.message))));
      $('#external-appointment').addEventListener('submit', async event => { event.preventDefault(); const data = formData(event.target); data.price = Number(data.price); try { await api('/api/admin/appointments', { method: 'POST', body: JSON.stringify(data) }); toast('Dato externo registrado.'); renderPortal(); } catch (error) { toast(error.message); } });
      $('#admin-appointments').addEventListener('change', async event => { const status = event.target.closest('[data-status-for]'); const reassign = event.target.closest('[data-reassign-for]'); try { if (status && status.value) { await api(`/api/appointments/${status.dataset.statusFor}/status`, { method: 'PATCH', body: JSON.stringify({ status: status.value }) }); toast('Estado actualizado.'); renderPortal(); } else if (reassign && reassign.value) { await api(`/api/admin/appointments/${reassign.dataset.reassignFor}`, { method: 'PATCH', body: JSON.stringify({ professionalId: reassign.value }) }); toast('Turno reasignado.'); renderPortal(); } } catch (error) { toast(error.message); renderPortal(); } });
      $('#admin-appointments').addEventListener('click', async event => { const button = event.target.closest('[data-save-appointment]'); if (!button) return; const row = button.closest('[data-appointment-row]'); const data = { date: $('[data-edit-date]', row).value, time: $('[data-edit-time]', row).value, price: Number($('[data-edit-price]', row).value) }; try { await api(`/api/admin/appointments/${button.dataset.saveAppointment}`, { method: 'PATCH', body: JSON.stringify(data) }); toast('Turno actualizado.'); renderPortal(); } catch (error) { toast(error.message); } });
    };
    const showSettings = async () => { const { settings } = await api('/api/admin/settings'); view.innerHTML = `<div class="portal-panel"><h3>Reglas de agenda y cancelación</h3><form id="settings-form" class="portal-form"><div class="field"><label>Anticipación mínima (horas)</label><input name="minBookingHours" type="number" min="0" value="${settings.minBookingHours}" required></div><div class="field"><label>Anticipación máxima (días)</label><input name="maxBookingDays" type="number" min="1" max="365" value="${settings.maxBookingDays}" required></div><div class="field"><label>Cancelar con anticipación (horas)</label><input name="cancellationHours" type="number" min="0" value="${settings.cancellationHours}" required></div><button class="button full">Guardar reglas</button></form></div>`; $('#settings-form').addEventListener('submit', async event => { event.preventDefault(); const data = formData(event.target); Object.keys(data).forEach(key => data[key] = Number(data[key])); try { await api('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(data) }); toast('Reglas actualizadas.'); } catch (error) { toast(error.message); } }); };
    const tabs = { overview: showOverview, professionals: showProfessionals, appointments: showAppointments, settings: showSettings };
    $$('#portal-content [data-admin-tab]').forEach(button => button.addEventListener('click', () => Promise.resolve(tabs[button.dataset.adminTab]()).catch(error => toast(error.message))));
    const addStatsFilters = () => {
      view.insertAdjacentHTML('afterbegin', `<div class="portal-panel"><h3>Filtrar estadísticas</h3><form id="stats-filter" class="portal-form"><div class="field"><label>Período</label><select name="period"><option value="week">Semana</option><option value="month" selected>Mes</option><option value="year">Año</option><option value="custom">Rango de fechas</option></select></div><div class="field"><label>Profesional</label><select name="professionalId"><option value="">Todos</option>${professionalsData.professionals.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('')}</select></div><div class="field"><label>Estado</label><select name="status"><option value="">Todos</option><option value="pending">Pendiente</option><option value="confirmed">Confirmado</option><option value="completed">Realizado</option><option value="cancelled">Cancelado</option><option value="no_show">Ausente</option></select></div><div class="field"><label>Desde</label><input name="from" type="date"></div><div class="field"><label>Hasta</label><input name="to" type="date"></div><button class="button full">Aplicar filtros</button></form></div>`);
      $('#stats-filter [name=period]').addEventListener('change', event => { const custom = event.target.value === 'custom'; $('#stats-filter [name=from]').disabled = !custom; $('#stats-filter [name=to]').disabled = !custom; });
      $('#stats-filter [name=from]').disabled = true; $('#stats-filter [name=to]').disabled = true;
      $('#stats-filter').addEventListener('submit', async event => {
        event.preventDefault(); const values = formData(event.target); const query = new URLSearchParams();
        if (values.period === 'custom') { if (values.from) query.set('from', values.from); if (values.to) query.set('to', values.to); }
        else { const now = new Date(); let from; if (values.period === 'week') from = new Date(now.getTime() - 7 * 86400000); else if (values.period === 'month') from = new Date(now.getTime() - 30 * 86400000); else from = new Date(now.getTime() - 365 * 86400000); query.set('from', from.toISOString().slice(0, 10)); query.set('to', dateToday()); }
        if (values.professionalId) query.set('professionalId', values.professionalId); if (values.status) query.set('status', values.status);
        try { stats = await api(`/api/admin/stats?${query}`); showOverview(); addStatsFilters(); } catch (error) { toast(error.message); }
      });
      const maxRevenue = Math.max(1, ...stats.byPeriod.map(item => item.revenue));
      const chart = stats.byPeriod.map(item => `<div style="display:grid;grid-template-columns:90px 1fr 110px;gap:12px;align-items:center;margin:10px 0;font-size:12px"><span>${escapeHtml(item.period)}</span><div style="height:12px;background:var(--sand);border-radius:20px;overflow:hidden"><div style="height:100%;width:${Math.max(3, item.revenue / maxRevenue * 100)}%;background:var(--gold);border-radius:20px"></div></div><strong>$ ${Number(item.revenue).toLocaleString('es-AR')}</strong></div>`).join('') || '<p class="notice">Sin turnos registrados para crear el gráfico.</p>';
      view.insertAdjacentHTML('beforeend', `<div class="portal-panel"><h3>Evolución de facturación · turnos realizados</h3>${chart}</div>`);
    };
    showOverview(); addStatsFilters();
  }

  (async () => {
    try { const result = await api('/api/auth/me'); state.user = result.user; updateAccountButton(); }
    catch { state.user = null; }
    await loadProfessionals();
    if (state.user) updateAccountButton();
  })();

  async function loadGoogleReviews() {
    const reviewList = $('#google-reviews');
    const ratingSummary = $('#google-rating-summary');
    if (!reviewList) return;
    const showReviewSamples = () => {
      const samples = [
        { author: 'Perfil de ejemplo', text: 'Un espacio cálido y cuidado, donde cada detalle invita a sentirse cómoda.' },
        { author: 'Perfil de ejemplo', text: 'La atención cercana y el ambiente tranquilo hacen que la visita se sienta especial.' },
        { author: 'Perfil de ejemplo', text: 'Un consultorio hermoso y acogedor, pensado para que te sientas bien acompañada.' },
      ];
      reviewList.innerHTML = samples.map(review => `<article class="google-review-card google-review-sample"><span class="google-review-demo-label">Ejemplo ficticio · No publicado en Google</span><div class="google-review-meta"><span class="google-review-stars" aria-label="5 de 5 estrellas">★★★★★</span><span class="google-review-date">5.0</span></div><blockquote>${escapeHtml(review.text)}</blockquote><div class="google-review-author"><span class="google-review-avatar" aria-hidden="true">E</span><strong>${escapeHtml(review.author)}</strong></div></article>`).join('');
    };
    try {
      const response = await fetch('/api/reviews');
      if (!response.ok) throw new Error('No pudimos consultar las reseñas.');
      const data = await response.json();
      if (data.rating) {
        ratingSummary.hidden = false;
        ratingSummary.innerHTML = `<strong>★ ${Number(data.rating).toFixed(1)}</strong><span>·</span><span>${Number(data.userRatingCount || 0)} reseñas en Google</span>`;
      }
      const reviews = (data.reviews || []).slice(0, 3);
      if (!reviews.length) {
        reviewList.innerHTML = '<p class="google-reviews-status">Todavía no hay reseñas disponibles para mostrar.</p>';
        return;
      }
      reviewList.innerHTML = reviews.map(review => `<article class="google-review-card"><div class="google-review-meta"><span class="google-review-stars">★ ${Number(review.rating).toFixed(1)}</span><span class="google-review-date">${escapeHtml(review.published || 'Google')}</span></div>${review.text ? `<blockquote>${escapeHtml(review.text)}</blockquote>` : '<p class="google-review-no-text">Calificación sin comentario escrito.</p>'}<div class="google-review-author"><span class="google-review-avatar" aria-hidden="true">${escapeHtml(String(review.author || 'G').trim().charAt(0).toUpperCase())}</span><strong>${escapeHtml(review.author || 'Usuario de Google')}</strong></div></article>`).join('');
    } catch {
      showReviewSamples();
    }
  }
  loadGoogleReviews();

  const contactSection = $('#contacto');
  if (contactSection && 'IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    contactSection.classList.add('contact-motion-ready');
    const contactObserver = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        contactSection.classList.add('contact-motion-visible');
        contactObserver.disconnect();
      }
    }, { threshold: 0.12 });
    contactObserver.observe(contactSection);
  }
})();
