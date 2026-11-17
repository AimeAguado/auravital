# Aura Vital · sistema local de turnos

La web existente se sirve como SPA desde el mismo servidor. La configuración local activa usa MongoDB Atlas con las credenciales privadas de `.env`.

## Iniciar en la computadora

```bash
npm install
npm run create-admin
npm start
```

Abrí `http://localhost:4173`. El primer administrador se crea de forma explícita desde el terminal; no se genera una cuenta con contraseña conocida. Los pacientes se registran desde **Ingresar → Crear cuenta** y el administrador puede crear las cuentas de profesionales desde su panel.

## Configuración

`.env` es local y está excluido de Git. La configuración activa es:

```env
DATA_STORE=mongodb
MONGODB_URI=mongodb+srv://...
MONGODB_DB=auravital
MONGODB_DNS_SERVERS=1.1.1.1,8.8.8.8
```

MongoDB debe permitir conexión desde la computadora y soportar transacciones (como Atlas). El servidor queda limitado a `127.0.0.1`. El secreto de sesión se genera y conserva dentro de `.data/session-secret`, excluido de Git. Cambiar de JSON a MongoDB no copia automáticamente datos anteriores del archivo local.

El archivo JSON y las cuentas creadas en esta modalidad son para desarrollo local. No uses esa persistencia para exponer información real de pacientes en producción.

## Pruebas

```bash
npm test
```

Las pruebas crean datos temporales aislados y comprueban autenticación, control de roles, privacidad de turnos, reservas simultáneas y modalidad BlipDoc.
