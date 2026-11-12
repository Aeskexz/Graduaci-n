const { mkdirSync, readFileSync, renameSync, writeFileSync } = require('node:fs');
const { createServer } = require('node:http');
const { homedir, networkInterfaces } = require('node:os');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { publicOriginFrom, useWebpBackgrounds } = require('./publicacion.cjs');

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

const mode = process.argv[2];
if (mode === '--asistentes') {
  try {
    console.log(writeAttendeeReport());
  } finally {
    database.close();
  }
} else if (mode === '--registros') {
  const rows = database.prepare('SELECT id, nombre, registrado_utc FROM registros ORDER BY id').all();
  console.log(databasePath);
  if (rows.length) console.table(rows);
  else console.log('Aún no hay inscripciones.');
  database.close();
} else {
  startServer();
}

function writeAttendeeReport() {
  const rows = database.prepare('SELECT nombre FROM registros ORDER BY id').all();
  const names = rows.map(({ nombre }) => {
    const escapedName = nombre.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    return `      <li>${escapedName}</li>`;
  });
  const content = names.length
    ? `    <ol>\n${names.join('\n')}\n    </ol>`
    : '    <p>Aún no hay confirmaciones de asistencia.</p>';
  const reportPath = join(dataDirectory, 'asistentes.html');
  const temporaryPath = join(dataDirectory, `asistentes-${process.pid}.tmp`);

  writeFileSync(temporaryPath, `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
  <title>Asistentes · Fiesta de graduación</title>
  <style>
    body { margin: 0; padding: 1.5rem; background: #f4f1e9; color: #20364b; font: 1rem/1.5 system-ui, sans-serif; }
    main { max-width: 38rem; margin: 2rem auto; padding: clamp(1.25rem, 5vw, 3rem); background: #fffdf8; border: 1px solid #c9d3db; }
    h1 { margin: 0; font: 2rem/1.15 Georgia, serif; }
    ol { padding-inline-start: 1.5rem; }
    li { padding: .45rem .25rem; border-bottom: 1px solid #dce2e6; overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <main>
    <h1>Asistentes a la graduación</h1>
    <p>Total de confirmaciones: ${rows.length}</p>
${content}
  </main>
</body>
</html>
`, { encoding: 'utf8', mode: 0o600 });

  renameSync(temporaryPath, reportPath);
  return reportPath;
}

function refreshAttendeeReport() {
  try {
    writeAttendeeReport();
  } catch (error) {
    console.error('No se pudo actualizar la lista privada de asistentes:', error.message);
  }
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
    ['/assets/fondo-invitacion.webp', ['assets/fondo-invitacion.webp', 'image/webp']],
    ['/assets/fondo-registro.webp', ['assets/fondo-registro.webp', 'image/webp']],
  ]);
  const registrationPage = useWebpBackgrounds(readFileSync(join(__dirname, 'registro.html'), 'utf8'));

  function showRegistration(response, status = 200, message = '', confirmed = false) {
    const notice = confirmed
      ? '<p class="registration-confirmation" role="status">Muchas gracias, ¡te esperamos!</p>'
      : message ? '<p class="registration-status">' + message + '</p>' : '';
    let page = registrationPage.replace('<!-- registration-status -->', notice);
    if (confirmed) page = page.replace('<form class="registration-form"', '<form hidden class="registration-form"');
    response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(page);
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
        return showRegistration(response);
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
        refreshAttendeeReport();
        return showRegistration(response, 200, '', true);
      }

      const file = request.method === 'GET' && publicFiles.get(url.pathname);
      if (file) {
        const [filename, contentType] = file;
        const path = join(__dirname, filename);
        const contents = filename === 'index.html' || filename === 'styles.css'
          ? useWebpBackgrounds(readFileSync(path, 'utf8'))
          : readFileSync(path);
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
    refreshAttendeeReport();
    console.log('En esta computadora: http://127.0.0.1:' + port);
    if (publicOrigin) {
      console.log('Formulario por el túnel: ' + publicOrigin + '/registro.html');
    } else {
      for (const address of localAddresses) console.log('En la misma red: http://' + address + ':' + port);
    }
    console.log('Base de datos: ' + databasePath);
  });
}
