const { store } = require('../../lib/store');
const { createNotificationWorker } = require('../../lib/notifications');

const notifications = createNotificationWorker(store, { logger: console });

module.exports = { notifications };
