import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { schema } from './confirmaciones.mjs';

const directory = process.env.GRADUACION_DATA_DIR
  || join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'InvitacionGraduacion');
const db = new DatabaseSync(join(directory, 'registros.sqlite'), { readOnly: true });
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
try {
  const rows = db.prepare('SELECT id, nombre, registrado_utc FROM registros ORDER BY id').all();
  const statements = rows.map(row => `INSERT INTO confirmaciones (id, nombre, registrado_utc)
    VALUES (${quote('local-' + row.id)}, ${quote(row.nombre)}, ${quote(row.registrado_utc)})
    ON CONFLICT(id) DO NOTHING;`);
  const destination = join(directory, 'migracion-confirmaciones.sql');
  writeFileSync(destination, [schema + ';', ...statements, ''].join('\n'), { mode: 0o600 });
  console.log(`${rows.length} confirmaciones listas para importar en ${destination}`);
} finally {
  db.close();
}
