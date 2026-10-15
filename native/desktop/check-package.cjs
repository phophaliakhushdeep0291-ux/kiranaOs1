const fs = require('node:fs');
const path = require('node:path');
module.exports = async function checkPackage() {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'runtime-config.json'), 'utf8'));
  if (config.target !== 'desktop') throw new Error('Run npm run prepare:desktop before packaging. A mobile bundle cannot be packaged as a desktop app.');
};
