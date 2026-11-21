const { Controller, Get } = require('@nestjs/common');
const { timezone } = require('../lib/config');
const { store } = require('../lib/store');

class HealthController {
  getHealth() {
    return {
      ok: true,
      persistence: store.constructor.name === 'MongoStore' ? 'mongodb' : 'local-json',
      timezone,
    };
  }
}

Controller('api')(HealthController);
Get('health')(HealthController.prototype, 'getHealth', Object.getOwnPropertyDescriptor(HealthController.prototype, 'getHealth'));

module.exports = { HealthController };
