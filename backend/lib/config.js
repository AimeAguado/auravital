const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.startsWith('replace-')) {
  const secretFile = path.join(root, '.data', 'session-secret');
  fs.mkdirSync(path.dirname(secretFile), { recursive: true });
  try { sessionSecret = fs.readFileSync(secretFile, 'utf8').trim(); }
  catch {
    sessionSecret = crypto.randomBytes(64).toString('base64url');
    try { fs.writeFileSync(secretFile, sessionSecret, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; sessionSecret = fs.readFileSync(secretFile, 'utf8').trim(); }
  }
  process.env.SESSION_SECRET = sessionSecret;
}

module.exports = {
  root,
  port: Number(process.env.PORT || 4173),
  sessionSecret,
  dataFile: path.resolve(root, process.env.DATA_FILE || '.data/auravital.json'),
  mongoUri: process.env.MONGODB_URI || '',
  mongoDbName: process.env.MONGODB_DB || 'auravital',
  mongoDnsServers: (process.env.MONGODB_DNS_SERVERS || '').split(',').map(value => value.trim()).filter(Boolean),
  dataStore: process.env.DATA_STORE || 'json',
  resendApiKey: process.env.RESEND_API_KEY || '',
  resendFromEmail: process.env.RESEND_FROM_EMAIL || '',
  googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY || '',
  googlePlaceId: process.env.GOOGLE_PLACE_ID || '',
  googlePlacesQuery: process.env.GOOGLE_PLACES_QUERY || 'Aura Estética Integral, Libertad 351, Darregueira, Buenos Aires, Argentina',
  googleReviewUrl: process.env.GOOGLE_REVIEW_URL || 'https://share.google/KkgQVZW4HWienisuA',
  googleMapsUrl: process.env.GOOGLE_MAPS_URL || 'https://maps.app.goo.gl/6MYYkXz3YeLJorZH7',
  timezone: 'America/Argentina/Buenos_Aires',
};
