import { Router } from 'express';
import { pool, hoyLocal } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validaSucursal } from '../lib/sucursal.js';

const router = Router();

const TIPOS = ['inversion', 'gasto'];

//Crea tablas y categorías por defecto si no existen
async function asegurarTablas() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contabilidad_categorias (
        id     INT          AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(60)  NOT NULL,
        tipo   ENUM('inversion','gasto') NOT NULL DEFAULT 'gasto',
        color  VARCHAR(7)   NOT NULL DEFAULT '#E1BEE7'
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contabilidad (
        id           INT          AUTO_INCREMENT PRIMARY KEY,
        fecha        DATE         NOT NULL,
        tipo         ENUM('inversion','gasto') NOT NULL DEFAULT 'gasto',
        categoria_id INT,
        descripcion  TEXT,
        monto        DECIMAL(12,0) NOT NULL DEFAULT 0,
        es_diario    TINYINT      NOT NULL DEFAULT 0,
        usuario_id   INT          NOT NULL,
        creado_en    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const [[cuenta]] = await pool.query('SELECT COUNT(*) AS n FROM contabilidad_categorias');
    if (!cuenta || cuenta.n === 0) {
      const semilla = [
        ['Compra de ropa', 'inversion', '#E1BEE7'],
        ['Accesorios / Complementos', 'inversion', '#BBDEFB'],
        ['Adecuación del local', 'inversion', '#FFF9C4'],
        ['Equipos y muebles', 'inversion', '#C8E6C9'],
        ['Otros (inversión)', 'inversion', '#F8BBD0'],
        ['Arriendo', 'gasto', '#BBDEFB'],
        ['Servicios públicos', 'gasto', '#FFF9C4'],
        ['Empleados / Salarios', 'gasto', '#C8E6C9'],
        ['Transporte', 'gasto', '#F8BBD0'],
        ['Publicidad / Marketing', 'gasto', '#E1BEE7'],
        ['Papelería', 'gasto', '#B2EBF2'],
        ['Mantenimiento', 'gasto', '#FFE0B2'],
        ['Otros', 'gasto', '#BBBBBB'],
      ];
      for (const [nombre, tipo, color] of semilla) {
        await pool.query(
          'INSERT INTO contabilidad_categorias (nombre, tipo, color) VALUES (?, ?, ?)',
          [nombre, tipo, color]
        );
      }
    }
  } catch (err) {
    console.error('contabilidad init error:', err.message);
  }
}

//Garantiza tablas/categorías antes de cada request (seguro en serverless)
router.use(async (req, res, next) => {
  await asegurarTablas();
  next();
});

//Calcula los límites del período según mes (YYYY-MM) o todo
function rangoPeriodo(mes) {
  if (mes && /^\d{4}-\d{2}$/.test(mes)) {
    const [y, m] = mes.split('-').map(Number);
    const fin = new Date(y, m, 0).getDate();
    return { inicio: `${mes}-01`, fin: `${mes}-${String(fin).padStart(2, '0')}` };
  }
  return null;
}

//Lista categorías + movimientos + resumen (inversión, gastos, ventas, balance) por local
router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const mes = req.query.mes;
    const sucursal = validaSucursal(req.query.sucursal);
    const rango = rangoPeriodo(mes);

    const [categorias] = await pool.query(
      'SELECT id, nombre, tipo, color FROM contabilidad_categorias ORDER BY tipo, nombre'
    );

    let movQuery = `SELECT m.id, m.fecha, m.tipo, m.categoria_id, c.nombre AS categoria,
               c.color, m.descripcion, m.monto, m.es_diario, u.nombre AS usuario, m.creado_en
        FROM contabilidad m
        LEFT JOIN contabilidad_categorias c ON c.id = m.categoria_id
        LEFT JOIN usuarios u ON u.id = m.usuario_id`;
    let movParams = [];
    const conds = ["m.sucursal = ?"];
    movParams.push(sucursal);
    if (rango) {
      conds.push('m.fecha >= ? AND m.fecha <= ?');
      movParams.push(rango.inicio, rango.fin);
    }
    movQuery += ' WHERE ' + conds.join(' AND ');
    movQuery += ' ORDER BY m.fecha DESC, m.id DESC';
    const [movimientos] = await pool.query(movQuery, movParams);

    const resumen = await calcularResumen(rango, sucursal);

    res.json({ categorias, movimientos, resumen });
  } catch (err) {
    console.error('contabilidad GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

//Crea un movimiento contable (inversión o gasto) de un local
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { fecha, tipo, categoria_id, descripcion, monto, es_diario } = req.body;
    const sucursal = validaSucursal(req.body.sucursal);
    if (!TIPOS.includes(tipo)) return res.status(400).json({ error: 'Tipo inválido' });
    const montoN = Number(monto);
    if (Number.isNaN(montoN) || montoN < 0) return res.status(400).json({ error: 'Monto inválido' });

    //Categoría por defecto 'Otros'
    let catId = Number(categoria_id) || null;
    if (!catId) {
      const [[otros]] = await pool.query(
        'SELECT id FROM contabilidad_categorias WHERE nombre = ? AND tipo = ? LIMIT 1',
        ['Otros', tipo]
      );
      catId = otros ? otros.id : null;
      if (!catId) {
        const [ins] = await pool.query(
          'INSERT INTO contabilidad_categorias (nombre, tipo) VALUES (?, ?)',
          ['Otros', tipo]
        );
        catId = ins.insertId;
      }
    } else {
      const [[cat]] = await pool.query('SELECT id FROM contabilidad_categorias WHERE id = ?', [catId]);
      if (!cat) return res.status(400).json({ error: 'Categoría no válida' });
    }

    const fechaReg = fecha || hoyLocal();
    const [result] = await pool.query(
      `INSERT INTO contabilidad (fecha, tipo, categoria_id, descripcion, monto, es_diario, usuario_id, sucursal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [fechaReg, tipo, catId, descripcion || '', montoN, es_diario ? 1 : 0, req.user.id, sucursal]
    );
    res.status(201).json({ ok: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Crea una nueva categoría contable
router.post('/categorias', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { nombre, tipo, color } = req.body;
    if (!nombre || !TIPOS.includes(tipo)) return res.status(400).json({ error: 'Datos inválidos' });
    const [result] = await pool.query(
      'INSERT INTO contabilidad_categorias (nombre, tipo, color) VALUES (?, ?, ?)',
      [nombre, tipo, color || '#E1BEE7']
    );
    res.status(201).json({ ok: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Elimina una categoría contable (los movimientos quedan como 'Otros')
router.delete('/categorias/:id(\\d+)', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [[otros]] = await pool.query(
      'SELECT id FROM contabilidad_categorias WHERE nombre = ? LIMIT 1', ['Otros']
    );
    if (otros && otros.id !== id) {
      await pool.query('UPDATE contabilidad SET categoria_id = ? WHERE categoria_id = ?', [otros.id, id]);
    }
    await pool.query('DELETE FROM contabilidad_categorias WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Actualiza un movimiento contable
router.put('/:id(\\d+)', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { fecha, tipo, categoria_id, descripcion, monto, es_diario } = req.body;
    if (tipo && !TIPOS.includes(tipo)) return res.status(400).json({ error: 'Tipo inválido' });
    await pool.query(
      `UPDATE contabilidad
       SET fecha = ?, tipo = ?, categoria_id = ?, descripcion = ?, monto = ?, es_diario = ?
       WHERE id = ?`,
      [
        fecha || hoyLocal(),
        tipo || 'gasto',
        Number(categoria_id) || null,
        descripcion ?? '',
        Number(monto) ?? 0,
        es_diario ? 1 : 0,
        id
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Elimina un movimiento contable
router.delete('/:id(\\d+)', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    await pool.query('DELETE FROM contabilidad WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function calcularResumen(rango, sucursal) {
  const filtro = rango ? ' AND fecha >= ? AND fecha <= ?' : '';
  const invParams = rango ? [sucursal, rango.inicio, rango.fin] : [sucursal];
  const ventaParams = rango ? [sucursal, rango.inicio, rango.fin] : [sucursal];

  const [[inv]] = await pool.query(
    `SELECT COALESCE(SUM(monto),0) AS total FROM contabilidad WHERE tipo = 'inversion' AND sucursal = ?${filtro}`,
    invParams
  );
  const [[gas]] = await pool.query(
    `SELECT COALESCE(SUM(monto),0) AS total, COALESCE(SUM(CASE WHEN es_diario = 1 THEN monto ELSE 0 END),0) AS diarios
     FROM contabilidad WHERE tipo = 'gasto' AND sucursal = ?${filtro}`,
    invParams
  );
  const [[ventas]] = await pool.query(
    `SELECT COALESCE(SUM(total),0) AS total FROM ventas WHERE sucursal = ?${filtro}`,
    ventaParams
  );
  const totalInversion = Number(inv.total);
  const totalGastos = Number(gas.total);
  const gastosDiarios = Number(gas.diarios);
  const totalVentas = Number(ventas.total);
  const balance = totalVentas - (totalInversion + totalGastos);
  return {
    totalInversion,
    totalGastos,
    gastosDiarios,
    totalVentas,
    balance,
    //Desglose por categoría para gráficos
    porCategoria: await porCategoria(rango, sucursal),
    //Flujo diario: ventas vs gastos vs inversión por día
    diario: await diarioFlujo(rango, sucursal),
  };
}

async function diarioFlujo(rango, sucursal) {
  const filtro = rango ? ' AND fecha >= ? AND fecha <= ?' : '';
  const paramsV = rango ? [sucursal, rango.inicio, rango.fin] : [sucursal];
  const paramsC = rango ? [sucursal, rango.inicio, rango.fin] : [sucursal];

  const [ventasDia] = await pool.query(
    `SELECT fecha, COUNT(*) AS cantidad, COALESCE(SUM(total),0) AS ventas
     FROM ventas WHERE sucursal = ?${filtro} GROUP BY fecha`,
    paramsV
  );
  const [contaDia] = await pool.query(
    `SELECT fecha,
       COALESCE(SUM(CASE WHEN tipo = 'gasto' THEN monto ELSE 0 END),0) AS gastos,
       COALESCE(SUM(CASE WHEN tipo = 'inversion' THEN monto ELSE 0 END),0) AS inversion
     FROM contabilidad WHERE sucursal = ?${filtro} GROUP BY fecha`,
    paramsC
  );

  const mapa = new Map();
  for (const v of ventasDia) {
    mapa.set(String(v.fecha), { fecha: String(v.fecha), ventas: Number(v.ventas), cantidad: v.cantidad, gastos: 0, inversion: 0 });
  }
  for (const c of contaDia) {
    const f = String(c.fecha);
    const e = mapa.get(f) || { fecha: f, ventas: 0, cantidad: 0, gastos: 0, inversion: 0 };
    e.gastos += Number(c.gastos);
    e.inversion += Number(c.inversion);
    mapa.set(f, e);
  }
  return Array.from(mapa.values())
    .map(e => ({ ...e, neto: e.ventas - e.gastos - e.inversion }))
    .sort((a, b) => a.fecha > b.fecha ? -1 : 1);
}

async function porCategoria(rango, sucursal) {
  const filtro = rango ? ' AND m.fecha >= ? AND m.fecha <= ?' : '';
  const params = rango ? [sucursal, rango.inicio, rango.fin] : [sucursal];
  const [rows] = await pool.query(
    `SELECT c.nombre AS categoria, c.color, m.tipo, SUM(m.monto) AS total
     FROM contabilidad m
     LEFT JOIN contabilidad_categorias c ON c.id = m.categoria_id
     WHERE m.sucursal = ?${filtro}
     GROUP BY c.nombre, c.color, m.tipo
     ORDER BY total DESC`,
    params
  );
  return rows;
}

export default router;