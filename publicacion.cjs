const { copyFileSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
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

function useWebpBackgrounds(contents) {
  return contents.replace(/(assets\/fondo-(?:invitacion|registro))\.png/g, '$1.webp');
}

if (require.main === module) {
  const origin = publicOriginFrom(process.env.GRADUACION_PUBLIC_URL || '');
  const destination = process.argv[2] || '_site';
  const index = readFileSync(join(__dirname, 'index.html'), 'utf8');
  const localLink = 'href="./registro.html"';
  if (!index.includes(localLink)) throw new Error('Falta el enlace al registro en index.html.');

  mkdirSync(destination);
  mkdirSync(join(destination, 'assets'));
  for (const file of ['motion.js', 'assets/favicon-32.png', 'assets/favicon-64.png', 'assets/fondo-invitacion.webp']) {
    copyFileSync(join(__dirname, file), join(destination, file));
  }
  const styles = readFileSync(join(__dirname, 'styles.css'), 'utf8');
  writeFileSync(join(destination, 'styles.css'), useWebpBackgrounds(styles));
  let indexForPages = useWebpBackgrounds(index).replace(localLink, 'href="' + origin + '/registro.html"');
  for (const file of ['styles.css', 'motion.js']) {
    const version = createHash('sha256').update(readFileSync(join(destination, file))).digest('hex').slice(0, 12);
    indexForPages = indexForPages.replace(`"./${file}"`, `"./${file}?v=${version}"`);
  }
  writeFileSync(join(destination, 'index.html'), indexForPages);
}

module.exports = { publicOriginFrom, useWebpBackgrounds };
