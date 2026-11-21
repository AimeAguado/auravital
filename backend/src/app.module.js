const { Module } = require('@nestjs/common');
const { HealthController } = require('./health.controller');

class AppModule {}

Module({ controllers: [HealthController] })(AppModule);

module.exports = { AppModule };
