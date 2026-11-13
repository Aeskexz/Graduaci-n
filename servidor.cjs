const { mkdirSync, readFileSync, renameSync, writeFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { createServer } = require('node:http');
const { homedir, networkInterfaces } = require('node:os');
const { join } = require('node:path');
const { createInterface } = require('node:readline');
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
if (mode === '--panel-asistentes') {
  database.close();
  startAttendeePanel();
} else if (mode === '--asistentes' || mode === '--borrar-invitado') {
  database.close();
  manageCloudConfirmations(mode).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
} else if (mode === '--registros') {
  const rows = database.prepare('SELECT id, nombre, registrado_utc FROM registros ORDER BY id').all();
  console.log(databasePath);
  if (rows.length) console.table(rows);
  else console.log('Aún no hay inscripciones.');
  database.close();
} else {
  startServer();
}

function queryCloudConfirmations(sql) {
  const pnpm = process.env.GRADUACION_PNPM_CLI || join(homedir(), '.cache', 'codex-runtimes',
    'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs');
  const output = execFileSync(process.execPath, [
    pnpm, 'dlx', 'wrangler@4.160.1', 'd1', 'execute', 'graduacion-confirmaciones',
    '--remote', '--json', '--command',
    sql,
  ], {
    cwd: __dirname,
    encoding: 'utf8',
    env: { ...process.env, Path: join(process.execPath, '..') + ';' + (process.env.Path || '') },
    windowsHide: true,
  });
  const [result] = JSON.parse(output);
  if (!result?.success || !Array.isArray(result.results)) {
    throw new Error('Cloudflare no devolvió la lista de confirmaciones.');
  }
  return result;
}

function readCloudConfirmations() {
  return queryCloudConfirmations('SELECT id, nombre, registrado_utc FROM confirmaciones ORDER BY registrado_utc, id').results;
}

function deleteCloudConfirmation(guest) {
  const sqlText = value => "'" + value.replaceAll("'", "''") + "'";
  return queryCloudConfirmations(`DELETE FROM confirmaciones
    WHERE id = ${sqlText(guest.id)} AND nombre = ${sqlText(guest.nombre)}
    AND registrado_utc = ${sqlText(guest.registrado_utc)}`).meta.changes === 1;
}

async function manageCloudConfirmations(mode) {
  const rows = readCloudConfirmations();
  if (mode === '--asistentes') {
    console.log(writeAttendeeReport(rows));
    return;
  }
  if (!rows.length) {
    console.log('No hay invitados para borrar.');
    return;
  }

  console.table(rows.map(({ nombre, registrado_utc }, index) => ({
    numero: index + 1,
    nombre,
    fecha: new Intl.DateTimeFormat('es-SV', {
      dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/El_Salvador',
    }).format(new Date(registrado_utc)),
  })));
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const lines = input[Symbol.asyncIterator]();
    console.log('Escribe el número del invitado o presiona Enter para cancelar.');
    const choice = (await lines.next()).value?.trim() || '';
    const guest = /^[1-9][0-9]*$/.test(choice) && rows[Number(choice) - 1];
    if (!guest) {
      console.log(choice ? 'Número inválido. No se borró ningún registro.' : 'Operación cancelada.');
      return;
    }

    console.log(`¿Borrar a ${guest.nombre}? Escribe BORRAR para confirmar.`);
    if ((await lines.next()).value?.trim() !== 'BORRAR') {
      console.log('Operación cancelada.');
      return;
    }

    console.log(deleteCloudConfirmation(guest)
      ? 'Invitado borrado de Cloudflare.'
      : 'Ese registro ya no coincide con el seleccionado.');
    console.log(writeAttendeeReport(readCloudConfirmations()));
  } finally {
    input.close();
  }
}

function writeAttendeeReport(rows, filename = 'asistentes.html') {
  const reportPath = join(dataDirectory, filename);
  const temporaryPath = join(dataDirectory, `asistentes-${process.pid}.tmp`);
  const instructions = filename === 'asistentes.html'
    ? '<p>Copia privada de Cloudflare. Para actualizarla, ejecuta <code>.\\iniciar.cmd --asistentes</code>. Para abrir la lista con botones de borrado, ejecuta <code>.\\iniciar.cmd --panel-asistentes</code>.</p>'
    : '<p>Copia de los registros del servidor local.</p>';
  writeFileSync(temporaryPath, attendeeHtml(instructions + attendeeList(rows)), { encoding: 'utf8', mode: 0o600 });
  renameSync(temporaryPath, reportPath);
  return reportPath;
}

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function attendeeList(rows, panelPath) {
  const names = rows.map(({ nombre, id, registrado_utc }) => {
    const name = escapeHtml(nombre);
    if (!panelPath) return `<li>${name}</li>`;
    const date = new Date(registrado_utc).toLocaleString('es-SV', { timeZone: 'America/El_Salvador' });
    return `<li><div class="guest"><span>${name}<small>${escapeHtml(date)}</small></span>
      <a class="delete" href="${panelPath}?invitado=${encodeURIComponent(id)}" aria-label="Borrar a ${name}">Borrar</a></div></li>`;
  });
  return `<p>Total de confirmaciones: ${rows.length}</p>` + (names.length
    ? `<ol>${names.join('\n')}</ol>`
    : '<p>Aún no hay confirmaciones de asistencia.</p>');
}

function attendeeHtml(content, formAction = "'none'") {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action ${formAction}">
  <title>Asistentes · Fiesta de graduación</title>
  <style>
    body { margin: 0; padding: 1.5rem; background: #f4f1e9; color: #20364b; font: 1rem/1.5 system-ui, sans-serif; }
    main { max-width: 38rem; margin: 2rem auto; padding: clamp(1.25rem, 5vw, 3rem); background: #fffdf8; border: 1px solid #c9d3db; }
    h1 { margin: 0; font: 2rem/1.15 Georgia, serif; }
    ol { padding-inline-start: 1.5rem; }
    li { padding: .45rem .25rem; border-bottom: 1px solid #dce2e6; overflow-wrap: anywhere; }
    .guest { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
    .guest small { display: block; }
    .delete { display: inline-block; padding: .35rem .7rem; border: 1px solid #84292b; border-radius: .25rem; color: #84292b; background: transparent; font: inherit; cursor: pointer; }
  </style>
</head>
<body>
  <main>
    <h1>Asistentes a la graduación</h1>
${content}
  </main>
</body>
</html>
`;
}

function startAttendeePanel() {
  const panelPath = '/' + randomBytes(24).toString('hex');
  const pending = new Map();
  let origin;
  let notice = '';
  const server = createServer((request, response) => {
    const send = (status, content) => {
      response.writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
      });
      response.end(attendeeHtml(content, "'self'"));
    };

    const url = new URL(request.url, origin);
    if (request.headers.host !== new URL(origin).host || url.pathname !== panelPath) {
      return send(404, '<p>Página no encontrada.</p>');
    }
    try {
      if (request.method === 'GET') {
        const rows = readCloudConfirmations();
        const guestId = url.searchParams.get('invitado');
        if (guestId === null) return send(200, notice + attendeeList(rows, panelPath));
        const guest = rows.find(row => row.id === guestId);
        if (!guest) return send(404, `<p>Ese registro ya no está disponible.</p><a href="${panelPath}">Volver</a>`);
        const confirmation = randomBytes(24).toString('hex');
        pending.clear();
        pending.set(confirmation, guest);
        return send(200, `<p>¿Borrar a <strong>${escapeHtml(guest.nombre)}</strong>?</p>
          <form method="post" action="${panelPath}?confirmar=${confirmation}">
            <button class="delete" type="submit">Sí, borrar</button> <a href="${panelPath}">Cancelar</a>
          </form>`);
      }
      const token = url.searchParams.get('confirmar');
      if (request.method !== 'POST' || request.headers.origin !== origin || !pending.has(token)) {
        return send(403, `<p>Abre la lista para confirmar el borrado.</p><a href="${panelPath}">Volver</a>`);
      }
      const guest = pending.get(token);
      pending.delete(token);
      const deleted = deleteCloudConfirmation(guest);
      notice = deleted ? '<p>Invitado borrado de Cloudflare.</p>' : '<p>Ese registro ya no coincide con el seleccionado.</p>';
      try {
        writeAttendeeReport(readCloudConfirmations());
      } catch {
        notice += '<p>No se pudo actualizar la copia HTML. Puedes actualizarla después con <code>.\\iniciar.cmd --asistentes</code>.</p>';
      }
      response.writeHead(303, { Location: panelPath, 'Cache-Control': 'no-store' });
      response.end();
    } catch {
      send(502, `<p>No se pudo verificar el resultado en Cloudflare. Consulta la lista antes de volver a intentarlo.</p><a href="${panelPath}">Volver a la lista</a>`);
    }
  });
  server.listen(0, '127.0.0.1', () => {
    origin = `http://127.0.0.1:${server.address().port}`;
    console.log(`Abre este enlace en tu navegador: ${origin}${panelPath}`);
    console.log('Deja esta ventana abierta mientras uses la lista.');
  });
}

function refreshAttendeeReport() {
  try {
    const rows = database.prepare('SELECT nombre FROM registros ORDER BY id').all();
    writeAttendeeReport(rows, 'asistentes-local.html');
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
      ? '<p class="registration-confirmation" role="status">Muchas gracias, ¡te esperamos!</p><p class="gift-note">Tus muestras de cariño en regalo de sobre</p>'
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
