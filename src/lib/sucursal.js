import { pool } from '../db.js';

//Locales / sucursales de la tienda
export const SUCURSALES = ['floripondia', 'for-men'];

//Normaliza el valor de sucursal recibido (default floripondia)
export function validaSucursal(s) {
  return SUCURSALES.includes(s) ? s : 'floripondia';
}

let migracionPromise = null;
let stockMigracionPromise = null;

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
      //Abonos de apartados: historial de pagos con fecha y metodo (para el cierre)
      try {
        await pool.query(
          `CREATE TABLE IF NOT EXISTS apartados_abono (
             id INT AUTO_INCREMENT PRIMARY KEY,
             apartado_id INT NOT NULL,
             monto DECIMAL(12,0) NOT NULL DEFAULT 0,
             metodo_pago VARCHAR(20) NOT NULL DEFAULT 'efectivo',
             fecha DATE NOT NULL,
             vendedor_id INT NOT NULL,
             sucursal VARCHAR(20) NOT NULL DEFAULT 'floripondia',
             creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
             INDEX idx_aa_apartado (apartado_id),
             INDEX idx_aa_fecha_suc (fecha, sucursal)
           ) ENGINE=InnoDB`
        );
      } catch (err) {
        console.error('abonos migration error:', err.message);
      }
    })().catch(err => {
      console.error('sucursal migration error:', err.message);
    });
  }
  return migracionPromise;
}

//Migración: el stock pasa a vivir en productos (categorias queda como respaldo sin tocar)
//Se ejecuta una sola vez: agrega stock/descripcion a productos y copia desde categorias
export function asegurarStockEnProductos() {
  if (!stockMigracionPromise) {
    stockMigracionPromise = (async () => {
      const [cols] = await pool.query(
        `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND COLUMN_NAME = 'stock'`
      );
      if (cols[0].n) return;
      await pool.query(`ALTER TABLE productos ADD COLUMN stock INT NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE productos ADD COLUMN descripcion TEXT`);
      //El producto ya no depende de categorias: suelta la FK hacia categorias
      const [fks] = await pool.query(
        `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos'
           AND REFERENCED_TABLE_NAME = 'categorias'`
      );
      for (const fk of fks) {
        await pool.query(`ALTER TABLE productos DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``);
      }
      await pool.query(
        `UPDATE productos p
         JOIN categorias c ON c.nombre = p.categoria AND c.sucursal = p.sucursal
         SET p.stock = COALESCE(c.stock, 0), p.descripcion = COALESCE(c.descripcion, '')
         WHERE c.id IS NOT NULL`
      );
      console.log('stock migration: productos actualizados desde categorias');
    })().catch(err => {
      console.error('stock migration error:', err.message);
    });
  }
  return stockMigracionPromise;
}
