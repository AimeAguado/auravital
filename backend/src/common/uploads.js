const path = require('node:path');
const { root } = require('../../lib/config');

const uploadsRoot = path.join(root, '.data', 'uploads');
const uploadsDirectory = path.join(uploadsRoot, 'profesionales');

module.exports = { uploadsRoot, uploadsDirectory };
