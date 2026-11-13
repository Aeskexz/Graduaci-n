export const schema = `CREATE TABLE IF NOT EXISTS confirmaciones (
  id TEXT PRIMARY KEY NOT NULL,
  nombre TEXT NOT NULL CHECK (length(nombre) BETWEEN 1 AND 120),
  registrado_utc TEXT NOT NULL
) STRICT`;

const initialized = new WeakMap();

function prepareDatabase(db) {
  if (!initialized.has(db)) {
    initialized.set(db, db.prepare(schema).run().catch(error => {
      initialized.delete(db);
      throw error;
    }));
  }
  return initialized.get(db);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/registro.html' && request.method === 'GET') {
      return Response.redirect(new URL('/', url), 302);
    }
    if (url.pathname !== '/api/confirmaciones') return env.ASSETS.fetch(request);

    const origin = request.headers.get('Origin');
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' };
    const reply = (status, guardado = false) => Response.json({ guardado }, { status, headers });
    if (!origin || (origin !== url.origin && origin !== env.GITHUB_PAGES_ORIGIN)) return reply(403);
    headers['Access-Control-Allow-Origin'] = origin;
    if (request.method !== 'POST') return reply(405);
    if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/x-www-form-urlencoded') return reply(415);

    const reader = request.body?.getReader();
    if (!reader) return reply(400);
    const decoder = new TextDecoder();
    let size = 0;
    let body = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        return reply(413);
      }
      body += decoder.decode(value, { stream: true });
    }
    const fields = new URLSearchParams(body + decoder.decode());
    const name = fields.get('nombre')?.trim();
    const id = fields.get('id') || '';
    if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)
        || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) {
      return reply(400);
    }

    try {
      const { success } = await env.CONFIRMATION_LIMIT.limit({
        key: request.headers.get('CF-Connecting-IP') || 'local',
      });
      if (!success) return reply(429);
      await prepareDatabase(env.DB);
      const saved = await env.DB.prepare(`INSERT INTO confirmaciones (id, nombre, registrado_utc)
        VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre
        WHERE confirmaciones.nombre = excluded.nombre RETURNING id`)
        .bind(id, name, new Date().toISOString()).first();
      return saved ? reply(201, true) : reply(409);
    } catch (error) {
      console.error('No se pudo guardar una confirmación.', error.name);
      return reply(503);
    }
  },
};
