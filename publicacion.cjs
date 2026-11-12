const { copyFileSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

function publicOriginFrom(value) {
  const url = URL.parse(value);
  if (!url || url.protocol !== 'https:' || url.username || url.password
      || !/^[a-z0-9.-]+$/.test(url.hostname)
      || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('GRADUACION_PUBLIC_URL debe ser la dirección HTTPS del túnel, sin ruta ni parámetros.');
  }
  return url.origin;
}

if (require.main === module) {
  const origin = publicOriginFrom(process.env.GRADUACION_PUBLIC_URL || '');
  const destination = process.argv[2] || '_site';
  const index = readFileSync(join(__dirname, 'index.html'), 'utf8');
  const localLink = 'href="./registro.html"';
  if (!index.includes(localLink)) throw new Error('Falta el enlace al registro en index.html.');

  mkdirSync(destination);
  mkdirSync(join(destination, 'assets'));
  for (const file of ['styles.css', 'motion.js', 'assets/favicon-32.png', 'assets/favicon-64.png']) {
    copyFileSync(join(__dirname, file), join(destination, file));
  }
  const indexForPages = index.replace(localLink, 'href="' + origin + '/registro.html"');
  writeFileSync(join(destination, 'index.html'), indexForPages);
}

module.exports = { publicOriginFrom };
