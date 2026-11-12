const { mkdirSync, readFileSync } = require('node:fs');
const { createServer } = require('node:http');
const { homedir, networkInterfaces } = require('node:os');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { publicOriginFrom } = require('./publicacion.cjs');

const dataDirectory = process.env.GRADUACION_DATA_DIR
  || join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'InvitacionGraduacion');
const databasePath = join(dataDirectory, 'registros.sqlite');
const port = Number(process.env.GRADUACION_PORT || 8080);

mkdirSync(dataDirectory, { recursive: true });
const database = new DatabaseSync(databasePath);
database.exec(`
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS registros (
    id INTEGER PRIMARY KEY,
    nombre TEXT NOT NULL CHECK (length(nombre) BETWEEN 1 AND 120),
    registrado_utc TEXT NOT NULL
  ) STRICT;
`);

if (process.argv[2] === '--registros') {
  const rows = database.prepare('SELECT id, nombre, registrado_utc FROM registros ORDER BY id').all();
  console.log(databasePath);
  if (rows.length) console.table(rows);
  else console.log('Aún no hay inscripciones.');
  database.close();
} else {
  startServer();
}

function startServer() {
  const publicOrigin = process.env.GRADUACION_PUBLIC_URL
    ? publicOriginFrom(process.env.GRADUACION_PUBLIC_URL)
    : null;
  const localAddresses = Object.values(networkInterfaces()).flat()
    .filter(address => address.family === 'IPv4' && !address.internal)
    .map(address => address.address);
  const localHosts = ['127.0.0.1', 'localhost', ...(publicOrigin ? [] : localAddresses)];
  const allowedHosts = new Set(localHosts.map(address => port === 80 ? address : address + ':' + port));
  if (publicOrigin) allowedHosts.add(new URL(publicOrigin).host);

  const registrationPolicy = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  const insertRegistration = database.prepare('INSERT INTO registros (nombre, registrado_utc) VALUES (?, ?)');
  const publicFiles = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/index.html', ['index.html', 'text/html; charset=utf-8']],
    ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
    ['/motion.js', ['motion.js', 'text/javascript; charset=utf-8']],
    ['/assets/favicon-32.png', ['assets/favicon-32.png', 'image/png']],
    ['/assets/favicon-64.png', ['assets/favicon-64.png', 'image/png']],
    ['/assets/fondo-invitacion.png', ['assets/fondo-invitacion.png', 'image/png']],
    ['/assets/fondo-registro.png', ['assets/fondo-registro.png', 'image/png']],
  ]);
  const registrationPage = readFileSync(join(__dirname, 'registro.html'), 'utf8');

  function showRegistration(response, status = 200, message = '') {
    const notice = message ? '<p class="registration-status">' + message + '</p>' : '';
    response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(registrationPage.replace('<!-- registration-status -->', notice));
  }

  const server = createServer({ headersTimeout: 10_000, requestTimeout: 20_000 }, async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Cache-Control', 'no-store');

    try {
      const { host, origin, referer } = request.headers;
      if (!allowedHosts.has(host)) {
        response.writeHead(421, { 'Content-Type': 'text/plain; charset=utf-8' });
        return response.end('Dirección de la invitación no válida.');
      }

      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/registro.html') {
        response.setHeader('Content-Security-Policy', registrationPolicy);
      }

      if (url.pathname === '/registro.html' && request.method === 'GET') {
        const message = url.searchParams.get('estado') === 'guardado' ? 'Tu inscripción quedó registrada.' : '';
        return showRegistration(response, 200, message);
      }

      if (url.pathname === '/registro.html' && request.method === 'POST') {
        const senderOrigin = origin || (referer ? URL.parse(referer)?.origin : undefined);
        const expectedLocalOrigin = 'http://' + host;
        if (!senderOrigin || (senderOrigin !== expectedLocalOrigin && senderOrigin !== publicOrigin)) {
          return showRegistration(response, 403, 'Abre el formulario desde la invitación.');
        }

        if (request.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') {
          return showRegistration(response, 415, 'Completa el formulario de inscripción.');
        }

        const chunks = [];
        let size = 0;
        for await (const chunk of request.iterator({ destroyOnReturn: false })) {
          size += chunk.length;
          if (size > 4096) {
            response.setHeader('Connection', 'close');
            return showRegistration(response, 413, 'El formulario supera el tamaño permitido.');
          }
          chunks.push(chunk);
        }

        const name = new URLSearchParams(Buffer.concat(chunks).toString('utf8')).get('nombre')?.trim();
        if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) {
          return showRegistration(response, 400, 'Escribe un nombre válido de hasta 120 caracteres.');
        }

        insertRegistration.run(name, new Date().toISOString());
        response.writeHead(303, { Location: '/registro.html?estado=guardado' });
        return response.end();
      }

      const file = request.method === 'GET' && publicFiles.get(url.pathname);
      if (file) {
        const [filename, contentType] = file;
        const contents = readFileSync(join(__dirname, filename));
        response.writeHead(200, { 'Content-Type': contentType });
        return response.end(contents);
      }

      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return response.end('Página no encontrada.');
    } catch (error) {
      if (response.destroyed) return;
      console.error('Error en la solicitud:', error.message);
      return showRegistration(response, 500, 'No pudimos completar la solicitud. Inténtalo de nuevo.');
    }
  });

  server.listen(port, publicOrigin ? '127.0.0.1' : '0.0.0.0', () => {
    console.log('En esta computadora: http://127.0.0.1:' + port);
    if (publicOrigin) {
      console.log('Formulario por el túnel: ' + publicOrigin + '/registro.html');
    } else {
      for (const address of localAddresses) console.log('En la misma red: http://' + address + ':' + port);
    }
    console.log('Base de datos: ' + databasePath);
  });
}
