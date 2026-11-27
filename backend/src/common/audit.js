const { id } = require('./serialize');

function audit(database, actor, action, details = {}) {
  database.audit.push({ id: id(), actorId: actor.id, actorRole: actor.role, action, details, at: new Date().toISOString() });
  if (database.audit.length > 10000) database.audit.splice(0, database.audit.length - 10000);
}

module.exports = { audit };
