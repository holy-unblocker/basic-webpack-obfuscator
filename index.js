const obfuscate = require('./obfuscate.js');
const { join } = require('path');

exports.obfuscate = obfuscate;
exports.loader = join(__dirname, 'loader.js');
