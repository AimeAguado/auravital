# Aura Vital · turnos

Aplicación separada en un frontend React/Vite y un backend NestJS. La persistencia compatible con la versión anterior permanece en MongoDB o JSON local.

## Estructura

```text
frontend/                 React, Vite, estilos y recursos públicos
backend/
  main.js                 Bootstrap de NestJS, middleware HTTP y servidor estático de producción
  src/app.module.js       Módulo principal de NestJS
  src/health.controller.js Endpoint de salud de NestJS
  src/controllers/        Controladores NestJS por área (auth, turnos, profesionales, admin)
  src/middleware/         Seguridad, sesión y manejo de errores HTTP
  src/guards/             Guards de autenticación y roles
  src/filters/            Filtro global de errores de API
  src/common/             Constantes, fechas, serialización y utilidades compartidas
  lib/                    Configuración, autenticación y almacenamiento
  scripts/                Herramientas administrativas
tests/                    Pruebas de integración
```

NestJS inicia el servidor, publica el endpoint de salud y atiende todas las rutas de la API mediante controladores por área. El middleware previo aplica cabeceras de seguridad, parseo de cuerpos, validación de origen y carga de la sesión antes de cada controlador.

## Desarrollo

```bash
npm install
npm run dev
```

Frontend: `http://127.0.0.1:5173`. Backend NestJS/API: `http://127.0.0.1:4173`.

Para crear el primer administrador, ejecutá `npm run create-admin` en otra terminal.

## Producción local

```bash
npm start
```

Esto compila `frontend/` y NestJS sirve la aplicación en `http://127.0.0.1:4173`.

## Configuración y pruebas

La configuración privada permanece en `.env` (excluido de Git). Las variables principales son `DATA_STORE`, `MONGODB_URI`, `MONGODB_DB`, `MONGODB_DNS_SERVERS` y `PORT`. MongoDB debe permitir transacciones. El servidor escucha en `127.0.0.1` y conserva el secreto de sesión en `.data/session-secret`.

### Correos de turnos (Resend)

Configurá `RESEND_API_KEY` y `RESEND_FROM_EMAIL` en `.env` o en el entorno del servidor. El remitente debe pertenecer a un dominio verificado en Resend, por ejemplo `Aura Vital <turnos@tu-dominio-verificado.com>`. Sin estas variables, las notificaciones quedan pendientes y se reintentan cuando el servicio vuelva a estar configurado.

Cuando el paciente confirma su reserva, el turno queda confirmado inmediatamente, Aura Vital envía el correo de confirmación y programa un recordatorio 24 horas antes. El paciente puede cancelar sus turnos activos en cualquier momento. El recordatorio solo se envía mientras el turno siga confirmado. Un proceso del backend revisa las notificaciones cada minuto; el proveedor recibe una clave idempotente por turno y evento para evitar reenvíos duplicados.

### Reseñas de Google Places

Para mostrar hasta tres reseñas de 5 estrellas de Aura Estética Integral, configurá `GOOGLE_PLACES_API_KEY` en `.env`. La clave debe tener habilitada Places API (New) en Google Cloud, con facturación activa; mantenela solo en el backend y restringila a Places API. Recomendamos fijar `GOOGLE_PLACE_ID` con el ID de la ficha oficial para evitar búsquedas por texto; si no se indica, el backend resuelve la ficha con `GOOGLE_PLACES_QUERY`. La respuesta se guarda en memoria durante una hora. Opcionalmente, `GOOGLE_REVIEW_URL` define el enlace del botón «Dejar una reseña» y `GOOGLE_MAPS_URL` el de «Ver todas las reseñas en Google». Sin `GOOGLE_PLACES_API_KEY`, la sección muestra un mensaje para leer las opiniones directamente en Google, sin reseñas ficticias.

```bash
npm test
```

Las pruebas crean datos temporales aislados y comprueban autenticación, permisos, privacidad, disponibilidad, reservas simultáneas y agendas BlipDoc.
