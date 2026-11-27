const { createApp } = require('../backend/main');

let handlerPromise = null;

function initialize() {
  if (!handlerPromise) {
    handlerPromise = createApp({ serveFrontend: false })
      .then(async ({ app, instance }) => {
        await app.init();
        return instance;
      })
      .catch(error => {
        handlerPromise = null;
        throw error;
      });
  }
  return handlerPromise;
}

module.exports = async (req, res) => {
  const handler = await initialize();
  return handler(req, res);
};
