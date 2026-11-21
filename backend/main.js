require('reflect-metadata');

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./src/app.module');
const legacyApi = require('./src/legacy-api');
const { root, port } = require('./lib/config');
const { store } = require('./lib/store');

async function bootstrap() {
  if (typeof store.ready === 'function') await store.ready();

  const app = await NestFactory.create(AppModule);
  const instance = app.getHttpAdapter().getInstance();
  // Keep the existing API router as a compatibility module while it is
  // migrated into Nest feature controllers. Nest owns bootstrap and health.
  instance.use((req, res, next) => {
    if (req.path === '/api/health') return next();
    return legacyApi(req, res, next);
  });

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
  console.log(`Aura Vital NestJS disponible en http://127.0.0.1:${port}`);
}

bootstrap().catch(error => {
  console.error(`No se pudo iniciar Aura Vital: ${error.message}`);
  process.exitCode = 1;
});
