import { pool } from '../db.js';

//Locales / sucursales de la tienda
export const SUCURSALES = ['floripondia', 'for-men'];

//Normaliza el valor de sucursal recibido (default floripondia)
export function validaSucursal(s) {
  return SUCURSALES.includes(s) ? s : 'floripondia';
}

let migracionPromise = null;

//Asegura que una tabla tenga la columna sucursal
async function asegurarColumna(table) {
  const [cols] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'sucursal'`,
    [table]
  );
  if (!cols[0].n) {
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN sucursal VARCHAR(20) NOT NULL DEFAULT 'floripondia'`);
  }
}

//Recrea el índice único para que cubra las columnas indicadas (nombre+sucursal, fecha+sucursal)
async function recreaIndiceUnico(table, columnas) {
  const [uniq] = await pool.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND NON_UNIQUE = 0
     GROUP BY INDEX_NAME`,
    [table]
  );
  if (!uniq.length) return;
  const [colsIndex] = await pool.query(
    `SELECT INDEX_NAME, COLUMN_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND NON_UNIQUE = 0`,
    [table]
  );
  const porIndex = {};
  for (const r of colsIndex) {
    if (!porIndex[r.INDEX_NAME]) porIndex[r.INDEX_NAME] = [];
    porIndex[r.INDEX_NAME].push(r.COLUMN_NAME);
  }
  const cubre = Object.values(porIndex).some(c => columnas.every(col => c.includes(col)));
  if (!cubre) {
    for (const i of uniq) {
      await pool.query(`ALTER TABLE \`${table}\` DROP INDEX \`${i.INDEX_NAME}\``);
    }
    await pool.query(
      `ALTER TABLE \`${table}\` ADD UNIQUE INDEX uq_${columnas.join('_')} (${columnas.join(', ')})`
    );
  }
}

//Migración idempotente de sucursales (se ejecuta una sola vez por proceso)
export function asegurarSucursales() {
  if (!migracionPromise) {
    migracionPromise = (async () => {
      const tablas = ['ventas', 'productos', 'categorias', 'apartados', 'contabilidad', 'aperturas_caja', 'cierres'];
      for (const t of tablas) {
        try { await asegurarColumna(t); } catch {}
      }
      try { await recreaIndiceUnico('categorias', ['nombre', 'sucursal']); } catch {}
      try { await recreaIndiceUnico('cierres', ['fecha', 'sucursal']); } catch {}
    })().catch(err => {
      console.error('sucursal migration error:', err.message);
    });
  }
  return migracionPromise;
}
