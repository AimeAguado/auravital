require('reflect-metadata');

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./src/app.module');
const { ApiErrorFilter } = require('./src/filters/api-error.filter');
const { securityHeaders, parseCookies, enforceSameOrigin, loadUser, apiErrorHandler } = require('./src/middleware/http');
const { IMAGE_TYPES } = require('./src/common/images');
const { uploadsRoot } = require('./src/common/uploads');
const { notifications } = require('./src/common/notifications');
const { root, port } = require('./lib/config');
const { store } = require('./lib/store');

async function bootstrap() {
  if (typeof store.ready === 'function') await store.ready();

  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.useGlobalFilters(new ApiErrorFilter());
  const instance = app.getHttpAdapter().getInstance();

  instance.disable('x-powered-by');
  instance.use(securityHeaders);
  instance.use(express.json({ limit: '256kb' }));
  instance.use(express.raw({ type: Object.keys(IMAGE_TYPES), limit: '6mb' }));
  instance.use(parseCookies);
  instance.use('/api', enforceSameOrigin);
  instance.use('/uploads', express.static(uploadsRoot, { maxAge: '7d' }));
  instance.use('/api', loadUser);
  instance.use(apiErrorHandler);

  const frontendDist = path.join(root, 'frontend', 'dist');
  if (fs.existsSync(path.join(frontendDist, 'index.html'))) {
    instance.use(express.static(frontendDist, { extensions: ['html'] }));
    instance.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api') && req.accepts('html')) {
        return res.sendFile(path.join(frontendDist, 'index.html'));
      }
      next();
    });
  }

  await app.listen(port, '127.0.0.1');
  notifications.start();
  console.log(`Aura Vital NestJS disponible en http://127.0.0.1:${port}`);
}

bootstrap().catch(error => {
  console.error(`No se pudo iniciar Aura Vital: ${error.message}`);
  process.exitCode = 1;
});
