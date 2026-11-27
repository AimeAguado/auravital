const fs = require('node:fs/promises');
const path = require('node:path');
const { dataFile } = require('./config');
const { mongoUri, mongoDbName, mongoDnsServers, dataStore } = require('./config');

const emptyDatabase = () => ({
  users: [],
  professionals: [],
  appointments: [],
  audit: [],
  settings: { cancellationHours: 24, minBookingHours: 2, maxBookingDays: 90 },
});

class JsonStore {
  constructor(file = dataFile) {
    this.file = file;
    this.queue = Promise.resolve();
  }

  async read() {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      return { ...emptyDatabase(), ...JSON.parse(raw) };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return emptyDatabase();
    }
  }

  async update(mutator) {
    const operation = this.queue.then(async () => {
      const database = await this.read();
      const result = await mutator(database);
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temporaryFile = `${this.file}.tmp`;
      await fs.writeFile(temporaryFile, JSON.stringify(database, null, 2), { mode: 0o600 });
      await fs.rename(temporaryFile, this.file);
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}

class MongoStore {
  constructor(uri = mongoUri, databaseName = mongoDbName) {
    this.uri = uri;
    this.databaseName = databaseName;
    this.client = null;
    this.db = null;
    this.readyPromise = null;
  }

  async ready() {
    if (!this.readyPromise) this.readyPromise = this.connect();
    return this.readyPromise;
  }

  async connect() {
    if (mongoDnsServers.length) require('node:dns').setServers(mongoDnsServers);
    const { MongoClient } = require('mongodb');
    if (!this.uri) throw new Error('MONGODB_URI no está configurada en .env.');
    this.client = new MongoClient(this.uri, { serverSelectionTimeoutMS: 10000, appName: 'AuraVitalLocal', autoSelectFamily: false, family: 4 });
    await this.client.connect();
    this.db = this.client.db(this.databaseName);
    await Promise.all([
      this.db.collection('users').createIndex({ email: 1 }, { unique: true, name: 'users_email_unique' }),
      this.db.collection('professionals').createIndex({ userId: 1 }, { unique: true, name: 'professionals_user_unique' }),
      this.db.collection('appointments').createIndex({ professionalId: 1, startAt: 1 }),
      this.db.collection('appointments').createIndex({ patientId: 1, startAt: -1 }),
      this.db.collection('appointments').createIndex({ status: 1, date: 1 }),
      this.db.collection('audit').createIndex({ at: -1 }),
    ]);
    await this.db.collection('_coordination').updateOne({ _id: 'writes' }, { $setOnInsert: { sequence: 0 } }, { upsert: true });
    return this;
  }

  async readWithSession(session) {
    const names = ['users', 'professionals', 'appointments', 'audit', 'settings'];
    const result = await Promise.all(names.map(name => this.db.collection(name).find({}, { session }).toArray()));
    const state = emptyDatabase();
    names.forEach((name, index) => {
      state[name] = result[index].map(({ _id, ...document }) => ({ ...document, id: document.id || String(_id) }));
    });
    if (!state.settings.length) state.settings = { cancellationHours: 24, minBookingHours: 2, maxBookingDays: 90 };
    else state.settings = state.settings[0];
    return state;
  }

  async read() {
    await this.ready();
    const names = ['users', 'professionals', 'appointments', 'audit', 'settings'];
    const result = await Promise.all(names.map(name => this.db.collection(name).find({}).toArray()));
    const state = emptyDatabase();
    names.forEach((name, index) => {
      state[name] = result[index].map(({ _id, ...document }) => ({ ...document, id: document.id || String(_id) }));
    });
    if (!state.settings.length) state.settings = { cancellationHours: 24, minBookingHours: 2, maxBookingDays: 90 };
    else state.settings = state.settings[0];
    return state;
  }

  async writeCollection(name, items, session) {
    const collection = this.db.collection(name);
    const documents = name === 'settings' ? [{ ...items, id: 'global' }] : items;
    const writes = documents.map(item => {
      const { id, ...fields } = item;
      return { replaceOne: { filter: { _id: String(id) }, replacement: { _id: String(id), id: String(id), ...fields }, upsert: true } };
    });
    if (writes.length) await collection.bulkWrite(writes, { ordered: true, session });
    const ids = documents.map(item => String(item.id));
    await collection.deleteMany({ _id: { $nin: ids } }, { session });
  }

  async update(mutator) {
    await this.ready();
    const session = this.client.startSession();
    let output;
    try {
      await session.withTransaction(async () => {
        // Every write transaction acquires this common document. MongoDB retries
        // write conflicts, serializing availability checks across app processes.
        await this.db.collection('_coordination').updateOne({ _id: 'writes' }, { $inc: { sequence: 1 } }, { session });
        const state = await this.readWithSession(session);
        output = await mutator(state);
        for (const name of ['users', 'professionals', 'appointments', 'audit', 'settings']) {
          const items = name === 'settings' ? state.settings : state[name];
          await this.writeCollection(name, items, session);
        }
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
      return output;
    } finally { await session.endSession(); }
  }
}

const store = dataStore.toLowerCase() === 'mongodb' && mongoUri ? new MongoStore() : new JsonStore();
module.exports = { JsonStore, MongoStore, store, emptyDatabase };
