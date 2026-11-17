(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { user: null, professionals: [], selectedProfessional: null, selectedSlot: null, pendingBooking: false, tab: 'login' };
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
  const statusName = status => ({ pending: 'Pendiente', confirmed: 'Confirmado', completed: 'Realizado', cancelled: 'Cancelado', no_show: 'Ausente' }[status] || status);
  const fmtDate = date => new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

  function openModal(element) { element.classList.add('open'); document.body.style.overflow = 'hidden'; }
  function closeModal(element) { element.classList.remove('open'); if (!$('.modal.open')) document.body.style.overflow = ''; }
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
      if (!state.professionals.length) { list.innerHTML = '<p class="notice">Próximamente vas a poder conocer a nuestro equipo y consultar su disponibilidad.</p>'; return; }
      list.innerHTML = state.professionals.map(professional => `<article class="profile-card">${professional.photo ? `<img class="profile-photo" src="${escapeHtml(professional.photo)}" alt="${escapeHtml(professional.name)}">` : ''}<span class="eyebrow">${escapeHtml(professional.specialty)}</span><h3>${escapeHtml(professional.name)}</h3><p>${escapeHtml(professional.description || 'Profesional de Aura Vital, dedicada/o a tu bienestar y salud.')}</p><p><strong>${professional.price ? `$ ${Number(professional.price).toLocaleString('es-AR')}` : 'Consultar valor'}</strong> · ${professional.durationMinutes} min</p>${professional.turnerMode === 'BLIPDOC' && professional.blipdocUrl ? `<a class="button small" href="${escapeHtml(professional.blipdocUrl)}" target="_blank" rel="noopener">Agendar turno ↗</a>` : `<button class="button small" type="button" data-book-professional="${escapeHtml(professional.id)}">Agendar turno</button>`}</article>`).join('');
    } catch (error) { list.innerHTML = `<p class="notice">No pudimos cargar profesionales. ${escapeHtml(error.message)}</p>`; }
  }

  function chooseProfessional(professional) {
    if (professional.turnerMode === 'BLIPDOC') {
      if (professional.blipdocUrl) window.open(professional.blipdocUrl, '_blank', 'noopener');
      else toast('Este profesional todavía no tiene un enlace de turnos configurado.');
      return;
    }
    state.selectedProfessional = professional.id; state.selectedSlot = null;
    $('#booking-professional').innerHTML = `<option value="${escapeHtml(professional.id)}">${escapeHtml(professional.name)} · ${escapeHtml(professional.specialty)}</option>`;
    $('#booking-date').min = dateToday(); $('#booking-date').value = '';
    $('#booking-form').hidden = false;
    $('#booking-professional-detail').textContent = `${professional.specialty} · ${professional.durationMinutes} minutos · ${professional.price ? `$ ${Number(professional.price).toLocaleString('es-AR')}` : 'consultar valor'}`;
    $('#booking-slots').innerHTML = '<span class="notice">Elegí una fecha para ver los horarios disponibles.</span>';
    $('#booking-confirmation').hidden = true; $('#booking-form button[type="submit"]').disabled = true;
    openModal(modal);
  }
  $('#professional-list').addEventListener('click', event => {
    const button = event.target.closest('[data-book-professional]'); if (!button) return;
    const professional = state.professionals.find(item => item.id === button.dataset.bookProfessional); if (professional) chooseProfessional(professional);
  });
  document.addEventListener('click', event => {
    const anchor = event.target.closest('[data-booking]'); if (!anchor) return;
    event.preventDefault();
    if (anchor.dataset.service) {
      const professional = state.professionals.find(item => item.specialty.toLowerCase().includes(anchor.dataset.service.toLowerCase()));
      if (professional) { chooseProfessional(professional); return; }
    }
    const internal = state.professionals.find(item => item.turnerMode === 'AURA_VITAL');
    if (internal) chooseProfessional(internal); else toast('En breve vas a poder solicitar turnos desde este sitio.');
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
  function setAuthTab(tab) {
    state.tab = tab;
    $$('#auth-modal [data-auth-tab]').forEach(button => button.classList.toggle('active', button.dataset.authTab === tab));
    $('#login-form').hidden = tab !== 'login'; $('#register-form').hidden = tab !== 'register';
    $('#auth-title').textContent = tab === 'login' ? 'Ingresá a tu cuenta.' : 'Creá tu cuenta.';
  }
  $$('[data-auth-tab]').forEach(button => button.addEventListener('click', () => setAuthTab(button.dataset.authTab)));
  $('#account-button').addEventListener('click', () => state.user ? renderPortal() : openAuth());
  async function submitAuth(form, endpoint) {
    try {
      const result = await api(endpoint, { method: 'POST', body: JSON.stringify(formData(form)) });
      state.user = result.user; closeModal(authModal); updateAccountButton();
      if (state.pendingBooking) { state.pendingBooking = false; await confirmBooking(); }
      else renderPortal();
    } catch (error) { toast(error.message); }
  }
  $('#login-form').addEventListener('submit', event => { event.preventDefault(); submitAuth(event.currentTarget, '/api/auth/login'); });
  $('#register-form').addEventListener('submit', event => { event.preventDefault(); submitAuth(event.currentTarget, '/api/auth/register'); });
  $('#password-form').addEventListener('submit', async event => {
    event.preventDefault(); const data = formData(event.currentTarget);
    if (data.newPassword !== data.confirmPassword) { toast('Las contraseñas nuevas no coinciden.'); return; }
    try { await api('/api/account/password', { method: 'POST', body: JSON.stringify({ currentPassword: data.currentPassword, newPassword: data.newPassword }) }); event.currentTarget.reset(); closeModal(passwordModal); toast('Contraseña actualizada.'); }
    catch (error) { toast(error.message); }
  });
  function updateAccountButton() { $('#account-button').textContent = state.user ? 'Mi cuenta' : 'Ingresar'; }

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
    appShell.innerHTML = `<div class="portal-head"><div><span class="eyebrow">Espacio privado · ${escapeHtml(state.user.role)}</span><h2>Hola, ${escapeHtml(state.user.firstName || state.user.name)}.</h2><p>${escapeHtml(state.user.email)}</p></div><div><button class="button secondary" id="home-button">Volver al sitio</button> <button class="button secondary" id="password-button">Cambiar contraseña</button> <button class="button" id="logout-button">Cerrar sesión</button></div></div><div id="portal-content"><p class="notice">Cargando tus datos...</p></div>`;
    $('#home-button').addEventListener('click', leavePortal);
    $('#password-button').addEventListener('click', () => { $('#password-form').reset(); openModal(passwordModal); $('#current-password').focus(); });
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
  async function renderProfessional() {
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

  async function renderAdmin() {
    const [professionalsData, appointmentsData] = await Promise.all([api('/api/admin/professionals'), api('/api/appointments')]); let stats = await api('/api/admin/stats');
    $('#portal-content').innerHTML = `<div class="portal-nav"><button class="button small" data-admin-tab="overview">Resumen</button><button class="button secondary small" data-admin-tab="professionals">Profesionales</button><button class="button secondary small" data-admin-tab="appointments">Turnos</button><button class="button secondary small" data-admin-tab="settings">Reglas</button></div><div id="admin-view"></div>`;
    const view = $('#admin-view');
    const showOverview = () => { view.innerHTML = `<div class="portal-grid"><div class="portal-panel"><span class="eyebrow">Turnos totales</span><h3>${stats.total}</h3></div><div class="portal-panel"><span class="eyebrow">Realizados</span><h3>${stats.completed}</h3></div><div class="portal-panel"><span class="eyebrow">Pendientes</span><h3>${stats.pending}</h3></div><div class="portal-panel"><span class="eyebrow">Cancelados</span><h3>${stats.cancelled}</h3></div><div class="portal-panel"><span class="eyebrow">Facturación interna</span><h3>$ ${Number(stats.revenue).toLocaleString('es-AR')}</h3></div><div class="portal-panel"><span class="eyebrow">BlipDoc externo</span><h3>${stats.externalAppointments}</h3><p>Sin integración de reservas/facturación externas.</p></div></div><div class="portal-panel"><h3>Estadísticas por profesional</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Profesional</th><th>Turnero</th><th>Total</th><th>Realizados</th><th>Cancelados</th><th>Pendientes</th><th>Facturación</th></tr></thead><tbody>${stats.byProfessional.map(item => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.turnerMode)}</td><td>${item.total}</td><td>${item.completed}</td><td>${item.cancelled}</td><td>${item.pending}</td><td>$ ${Number(item.revenue).toLocaleString('es-AR')}</td></tr>`).join('')}</tbody></table></div></div><div class="portal-panel"><h3>Facturación mensual</h3>${stats.byPeriod.map(item => `<p>${escapeHtml(item.period)} · ${item.appointments} turnos · $ ${Number(item.revenue).toLocaleString('es-AR')}</p>`).join('') || '<p class="notice">Sin actividad para el período.</p>'}</div>`; };
    const showProfessionals = () => {
      view.innerHTML = `<div class="portal-panel"><h3>Dar de alta profesional</h3><form id="new-professional" class="portal-form"><div class="field"><label>Nombre y apellido</label><input name="name" required></div><div class="field"><label>Especialidad</label><input name="specialty" required></div><div class="field"><label>Email de acceso</label><input name="email" type="email" required></div><div class="field"><label>Contraseña inicial (mínimo 10)</label><input name="password" type="password" minlength="10" required></div><div class="field"><label>Precio</label><input name="price" type="number" min="0" step="0.01" required></div><div class="field"><label>Duración (minutos)</label><input name="durationMinutes" type="number" min="10" max="240" step="5" value="30" required></div><div class="field"><label>Modalidad</label><select name="turnerMode"><option value="AURA_VITAL">Turnero Aura Vital</option><option value="BLIPDOC">BlipDoc</option></select></div><div class="field"><label>Enlace BlipDoc (HTTPS)</label><input name="blipdocUrl" type="url" placeholder="https://..."></div><div class="field full"><label>Descripción</label><textarea name="description" rows="3"></textarea></div><div class="field full"><label>Foto (URL)</label><input name="photo" type="url"></div><button class="button full">Crear profesional</button></form></div><div class="portal-panel"><h3>Equipo profesional</h3>${professionalsData.professionals.map(item => `<article class="profile-card"><strong>${escapeHtml(item.name)}</strong> · ${escapeHtml(item.specialty)} · ${item.active ? 'Activo' : 'Inactivo'} · ${escapeHtml(item.turnerMode)}<form class="professional-edit portal-form" data-professional="${escapeHtml(item.id)}"><div class="field"><label>Modalidad</label><select name="turnerMode"><option value="AURA_VITAL" ${item.turnerMode === 'AURA_VITAL' ? 'selected' : ''}>Aura Vital</option><option value="BLIPDOC" ${item.turnerMode === 'BLIPDOC' ? 'selected' : ''}>BlipDoc</option></select></div><div class="field"><label>Enlace externo</label><input name="blipdocUrl" type="url" value="${escapeHtml(item.blipdocUrl || '')}"></div><div class="field"><label>Precio</label><input name="price" type="number" min="0" step="0.01" value="${Number(item.price)}"></div><div class="field"><label>Duración</label><input name="durationMinutes" type="number" min="10" max="240" value="${Number(item.durationMinutes)}"></div><div class="field"><label>Estado</label><select name="active"><option value="true" ${item.active ? 'selected' : ''}>Activo</option><option value="false" ${!item.active ? 'selected' : ''}>Inactivo</option></select></div><button class="button small">Guardar</button></form></article>`).join('') || '<p class="notice">Todavía no hay profesionales dados de alta.</p>'}</div>`;
      professionalsData.professionals.forEach(item => { const form = $(`.professional-edit[data-professional="${item.id}"]`); if (!form) return; form.insertAdjacentHTML('afterbegin', `<div class="field"><label>Nombre</label><input name="name" value="${escapeHtml(item.name)}" required></div><div class="field"><label>Especialidad</label><input name="specialty" value="${escapeHtml(item.specialty)}" required></div><div class="field"><label>Email de acceso</label><input name="email" type="email" value="${escapeHtml(item.email || '')}" required></div><div class="field"><label>Cambiar contraseña (opcional)</label><input name="password" type="password" minlength="10" autocomplete="new-password"></div><div class="field full"><label>Descripción</label><textarea name="description" rows="2">${escapeHtml(item.description || '')}</textarea></div><div class="field full"><label>Foto (URL)</label><input name="photo" type="url" value="${escapeHtml(item.photo || '')}"></div>`); });
      $('#new-professional').addEventListener('submit', async event => { event.preventDefault(); const data = formData(event.target); data.price = Number(data.price); data.durationMinutes = Number(data.durationMinutes); try { await api('/api/admin/professionals', { method: 'POST', body: JSON.stringify(data) }); toast('Profesional creado.'); await loadProfessionals(); renderPortal(); } catch (error) { toast(error.message); } });
      $$('.professional-edit').forEach(form => form.addEventListener('submit', async event => { event.preventDefault(); const data = formData(form); data.active = data.active === 'true'; data.price = Number(data.price); data.durationMinutes = Number(data.durationMinutes); try { await api(`/api/admin/professionals/${form.dataset.professional}`, { method: 'PATCH', body: JSON.stringify(data) }); toast('Profesional actualizado.'); await loadProfessionals(); renderPortal(); } catch (error) { toast(error.message); } }));
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
})();
