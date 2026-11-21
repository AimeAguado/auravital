# Aura Vital · turnos

Aplicación separada en un frontend React/Vite y un backend NestJS. La persistencia compatible con la versión anterior permanece en MongoDB o JSON local.

## Estructura

```text
frontend/                 React, Vite, estilos y recursos públicos
backend/
  main.js                 Bootstrap de NestJS y servidor estático de producción
  src/app.module.js       Módulo principal de NestJS
  src/health.controller.js Endpoint de salud de NestJS
  src/legacy-api.js       Adaptador temporal de las rutas existentes
  lib/                    Configuración, autenticación y almacenamiento
  scripts/                Herramientas administrativas
tests/                    Pruebas de integración
```

NestJS inicia el servidor y publica el endpoint de salud. Las rutas existentes se mantienen detrás de un adaptador Express de compatibilidad para que la migración no rompa autenticación, turnos ni la conexión de datos; ese adaptador queda aislado en `backend/src/legacy-api.js`.

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

```bash
npm test
```

Las pruebas crean datos temporales aislados y comprueban autenticación, permisos, privacidad, disponibilidad, reservas simultáneas y agendas BlipDoc.
