# Aura Vital — inventario funcional previo al rediseño

Inspección realizada antes de modificar la presentación. Este registro describe los flujos ya presentes en el frontend y no propone cambios funcionales.

## Sitio público
- Navbar anclada a inicio, especialidades, profesionales, comunidad y consultorio; menú responsive y botones de reserva e ingreso.
- Hero con imágenes actuales, dirección y accesos a reservas y tratamientos.
- Especialidades vinculadas a cada profesional; listado de profesionales cargado desde `/api/professionals`, con elección de reserva interna o redirección externa a BlipDoc.
- Secciones actuales de comunidad/testimonios, invitación a reservar, galería real del consultorio y contacto con mapa/enlace a Google Maps.
- Acceso fijo a WhatsApp y pie de página con navegación.

## Turnos y autenticación
- Modal de reserva con pasos para especialidad, profesional, tratamiento, fecha y hora, datos de paciente y confirmación.
- Agenda Aura Vital consulta disponibilidad y crea solicitudes autenticadas; agenda BlipDoc abre el destino externo y ofrece confirmación del flujo externo.
- Selección de días/horarios disponibles, cambio de mes, resumen y descarga de evento `.ics`.
- Ingreso, registro de paciente, acceso desde el flujo de reserva, actualización de contraseña y cierre de sesión.

## Portales
- Paciente: próximos turnos, historial, cancelación permitida y edición de perfil.
- Profesional: agenda y horarios, disponibilidad por fecha, bloqueos, tratamientos/valores y gestión de turnos.
- Administración: resumen, profesionales, turnos y reglas/configuración.

## Límites del rediseño
- Solo modificar CSS/presentación. No alterar componentes React, JavaScript, HTML funcional, rutas, datos, formularios, permisos, API, backend ni base de datos.
- Mantener fotografías, equipo, especialidades, secciones y destinos existentes.
