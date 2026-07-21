import { Router } from 'express';
import { pool, hoyLocal } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

//Lista ventas, opcionalmente filtradas por fecha
router.get('/', requireAuth, requireRole('admin', 'vendedor'), async (req, res) => {
  try {
    const { fecha } = req.query;
    let query, params;
    if (fecha) {
      query = `SELECT v.id, v.producto AS productName, v.cliente AS customer,
               v.cantidad AS quantity, v.total, v.recibido, v.cambio,
               v.metodo_pago AS paymentMethod, v.fecha AS date, u.nombre AS vendedor,
               v.comentario, v.grupo_id AS grupoId
        FROM ventas v
        JOIN usuarios u ON u.id = v.vendedor_id
        WHERE v.fecha = ?
        ORDER BY v.id ASC`;
      params = [fecha];
    } else {
      query = `SELECT v.id, v.producto AS productName, v.cliente AS customer,
               v.cantidad AS quantity, v.total, v.recibido, v.cambio,
               v.metodo_pago AS paymentMethod, v.fecha AS date, u.nombre AS vendedor,
               v.comentario, v.grupo_id AS grupoId
        FROM ventas v
        JOIN usuarios u ON u.id = v.vendedor_id
        ORDER BY v.fecha DESC, v.id DESC
        LIMIT 100`;
      params = [];
    }
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Ventas por vendedor y fecha (modal de vendedor)
router.get('/vendedor', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { nombre, fecha } = req.query;
    if (!nombre || !fecha) return res.status(400).json({ error: 'nombre y fecha requeridos' });
    const [rows] = await pool.query(
      `SELECT v.id, v.producto AS productName, v.cliente AS customer,
              v.cantidad AS quantity, v.total, v.recibido, v.cambio,
              v.metodo_pago AS paymentMethod, v.fecha AS date, u.nombre AS vendedor,
              v.comentario, v.grupo_id AS grupoId
       FROM ventas v
       JOIN usuarios u ON u.id = v.vendedor_id
       WHERE u.nombre = ? AND v.fecha = ?
       ORDER BY v.id ASC`,
      [nombre, fecha]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Estadisticas globales (dashboard)
router.get('/stats', requireAuth, requireRole('admin', 'vendedor'), async (req, res) => {
  try {
    const [ventas] = await pool.query('SELECT COUNT(*) AS total, COALESCE(SUM(total),0) AS monto FROM ventas');
    const [prod] = await pool.query('SELECT COUNT(*) AS total FROM productos');
    const [usr] = await pool.query('SELECT COUNT(*) AS total FROM usuarios');
    const [cat] = await pool.query('SELECT COUNT(*) AS total FROM categorias');

    const [ventasDia] = await pool.query(
      `SELECT fecha, COUNT(*) AS cantidad, COALESCE(SUM(total),0) AS ingresos
       FROM ventas GROUP BY fecha ORDER BY fecha DESC LIMIT 30`
    );

    const [metodos] = await pool.query(
      `SELECT metodo_pago, COUNT(*) AS cantidad, COALESCE(SUM(total),0) AS total
       FROM ventas GROUP BY metodo_pago`
    );

    const [topProductos] = await pool.query(
      `SELECT producto, SUM(cantidad) AS vendidos
       FROM ventas GROUP BY producto ORDER BY vendidos DESC LIMIT 10`
    );

    const [inventario] = await pool.query(
      `SELECT c.nombre, c.stock,
        COALESCE((SELECT SUM(v.cantidad) FROM ventas v WHERE v.producto = c.nombre), 0) AS vendidos
       FROM categorias c ORDER BY c.stock ASC`
    );

    const [stockBajo] = await pool.query(
      `SELECT COUNT(*) AS total FROM categorias WHERE stock <= 3`
    );

    const [ventasHoy] = await pool.query(
      `SELECT COUNT(*) AS cantidad, COALESCE(SUM(total),0) AS ingresos
       FROM ventas WHERE fecha = ?`,
      [hoyLocal()]
    );

    const [ventasPorVendedor] = await pool.query(
      `SELECT u.nombre AS vendedor, COUNT(*) AS ventas, COALESCE(SUM(v.total),0) AS total
       FROM ventas v
       JOIN usuarios u ON u.id = v.vendedor_id
       WHERE v.fecha = ?
       GROUP BY v.vendedor_id, u.nombre
       ORDER BY total DESC`,
      [hoyLocal()]
    );

    res.json({
      resumen: {
        ventas: ventas[0].total,
        monto: ventas[0].monto,
        productos: prod[0].total,
        usuarios: usr[0].total,
        categorias: cat[0].total,
        stockBajo: stockBajo[0].total,
        ventasHoy: ventasHoy[0].cantidad,
        ingresosHoy: ventasHoy[0].ingresos,
      },
      ventasDia,
      metodos,
      topProductos,
      inventario,
      ventasPorVendedor,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Abre caja del dia
router.post('/caja/abrir', requireAuth, requireRole('admin', 'vendedor'), async (req, res) => {
  try {
    const hoy = hoyLocal();
    await pool.query('INSERT INTO aperturas_caja (fecha, abierto_por) VALUES (?, ?)', [hoy, req.user.id]);
    res.json({ ok: true, fecha: hoy });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Estado del cierre: ventas del dia, resumen, metodos, confirmado
router.get('/cierre', requireAuth, requireRole('admin', 'vendedor'), async (req, res) => {
  try {
    const hoy = hoyLocal();
    const esAdmin = req.user.role === 'admin';
    const filtroUsuario = esAdmin ? '' : 'AND vendedor_id = ?';

    const [[confirmado]] = await pool.query(
      'SELECT id, confirmado_por, confirmado_en FROM cierres WHERE fecha = ?',
      [hoy]
    );

    const [[apertura]] = await pool.query(
      'SELECT id, abierto_por, abierto_en FROM aperturas_caja WHERE fecha = ? LIMIT 1',
      [hoy]
    );

    const paramsVentas = esAdmin ? [hoy] : [hoy, req.user.id];
    const [ventas] = await pool.query(
      `SELECT v.id, v.producto AS productName, v.cliente AS customer,
               v.cantidad AS quantity, v.total, v.recibido, v.cambio,
               v.metodo_pago AS paymentMethod, v.fecha AS date, u.nombre AS vendedor,
               v.comentario, v.grupo_id AS grupoId
        FROM ventas v
        JOIN usuarios u ON u.id = v.vendedor_id
        WHERE v.fecha = ? ${esAdmin ? '' : 'AND v.vendedor_id = ?'}
        ORDER BY v.id ASC`,
      paramsVentas
    );

    const [resumen] = await pool.query(
      `SELECT COUNT(*) AS transacciones, COALESCE(SUM(cantidad),0) AS articulos, COALESCE(SUM(total),0) AS total
       FROM ventas WHERE fecha = ? ${filtroUsuario}`,
      esAdmin ? [hoy] : [hoy, req.user.id]
    );

    const [metodos] = await pool.query(
      `SELECT metodo_pago, COUNT(*) AS cantidad, COALESCE(SUM(total),0) AS total
       FROM ventas WHERE fecha = ? ${filtroUsuario} GROUP BY metodo_pago ORDER BY total DESC`,
      esAdmin ? [hoy] : [hoy, req.user.id]
    );

    res.json({
      fecha: new Date().toISOString().slice(0, 10),
      usuario: req.user.nombre,
      rol: req.user.role,
      confirmado: !!confirmado,
      cajaAbierta: !!apertura,
      resumen: resumen[0],
      metodos,
      ventas,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Confirma cierre de caja del dia (admin)
router.post('/cierre/confirmar', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const hoy = hoyLocal();
    await pool.query(
      'INSERT INTO cierres (fecha, confirmado_por) VALUES (?, ?) ON DUPLICATE KEY UPDATE confirmado_por = VALUES(confirmado_por), confirmado_en = CURRENT_TIMESTAMP',
      [hoy, req.user.id]
    );
    res.json({ ok: true, fecha: hoy });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Historial de cierres con ventas agregadas
router.get('/cierres', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.id, c.fecha, c.confirmado_en, u.nombre AS confirmado_por,
              COALESCE(v.ventas, 0) AS ventas, COALESCE(v.articulos, 0) AS articulos, COALESCE(v.total, 0) AS total
       FROM cierres c
       JOIN usuarios u ON u.id = c.confirmado_por
       LEFT JOIN (
         SELECT fecha, COUNT(*) AS ventas, SUM(cantidad) AS articulos, SUM(total) AS total
         FROM ventas GROUP BY fecha
       ) v ON v.fecha = c.fecha
       ORDER BY c.fecha DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Informe mensual: resumen, por vendedor, por metodo, diario
router.get('/informe-mensual', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { mes } = req.query;
    if (!mes || !/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ error: 'Formato: mes=YYYY-MM' });
    const inicio = `${mes}-01`;
    const [y, m] = mes.split('-').map(Number);
    const ultimoDia = new Date(y, m, 0).getDate();
    const fin = `${mes}-${String(ultimoDia).padStart(2, '0')}`;

    const [[resumen]] = await pool.query(
      `SELECT COUNT(*) AS ventas, COALESCE(SUM(cantidad),0) AS articulos, COALESCE(SUM(total),0) AS monto
       FROM ventas WHERE fecha >= ? AND fecha <= ?`,
      [inicio, fin]
    );

    const [porVendedor] = await pool.query(
      `SELECT u.nombre AS vendedor, COUNT(*) AS ventas, COALESCE(SUM(v.total),0) AS total
       FROM ventas v JOIN usuarios u ON u.id = v.vendedor_id
       WHERE v.fecha >= ? AND v.fecha <= ?
       GROUP BY v.vendedor_id, u.nombre ORDER BY total DESC`,
      [inicio, fin]
    );

    const [porMetodo] = await pool.query(
      `SELECT metodo_pago, COUNT(*) AS cantidad, COALESCE(SUM(total),0) AS total
       FROM ventas WHERE fecha >= ? AND fecha <= ? GROUP BY metodo_pago ORDER BY total DESC`,
      [inicio, fin]
    );

    const [diario] = await pool.query(
      `SELECT fecha, COUNT(*) AS cantidad, COALESCE(SUM(total),0) AS ingresos
       FROM ventas WHERE fecha >= ? AND fecha <= ? GROUP BY fecha ORDER BY fecha ASC`,
      [inicio, fin]
    );

    const efectivo = porMetodo.filter(m => m.metodo_pago === 'efectivo').reduce((s, m) => s + Number(m.total), 0);
    const tarjeta = porMetodo.filter(m => m.metodo_pago === 'tarjeta').reduce((s, m) => s + Number(m.total), 0);
    const nequi = porMetodo.filter(m => m.metodo_pago === 'nequi').reduce((s, m) => s + Number(m.total), 0);
    const daviplata = porMetodo.filter(m => m.metodo_pago === 'daviplata').reduce((s, m) => s + Number(m.total), 0);
    const addi = porMetodo.filter(m => m.metodo_pago === 'addi').reduce((s, m) => s + Number(m.total), 0);
    const transferencias = nequi + daviplata + addi;

    res.json({ mes, resumen, porVendedor, porMetodo, diario, efectivo, tarjeta, nequi, daviplata, addi, transferencias });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Analytics: agrupa ventas de 12 meses en memoria para multiples metricas
router.get('/analytics', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const hoy = hoyLocal();
    const hoyDate = new Date();
    const anio = hoyDate.getFullYear();
    const mes = String(hoyDate.getMonth() + 1).padStart(2, '0');
    const f12m = new Date(hoyDate); f12m.setMonth(f12m.getMonth() - 12);
    const s12m = f12m.toISOString().slice(0, 10);
    const startMes = `${anio}-${mes}-01`;
    const startMesAnt = new Date(anio, hoyDate.getMonth() - 1, 1);
    const endMesAnt = new Date(anio, hoyDate.getMonth(), 0);

    const all = await pool.query(
      `SELECT DATE_FORMAT(v.fecha,'%Y-%m-%d') AS fecha, v.producto, v.cantidad, v.total, v.metodo_pago, v.comentario, v.grupo_id, u.nombre AS vendedor FROM ventas v JOIN usuarios u ON u.id = v.vendedor_id WHERE v.fecha >= ?`, [s12m]
    );
    const rows = all[0];

    const ventasDiarias = agrupar(rows, r => r.fecha, r => ({ cantidad: r.cantidad, total: r.total }));
    const ventasSemanales = agrupar(rows, r => {
      const d = new Date(r.fecha + 'T12:00:00');
      const dia = d.getDay(); const diff = d.getDate() - dia + (dia === 0 ? -6 : 1);
      return new Date(d.setDate(diff)).toISOString().slice(0, 10);
    }, r => ({ cantidad: r.cantidad, total: r.total }));
    const ventasMensuales = agrupar(rows, r => r.fecha.slice(0, 7), r => ({ cantidad: r.cantidad, total: r.total }));
    const ventasMesActual = rows.filter(r => r.fecha >= startMes).reduce((s, r) => ({ cantidad: s.cantidad + r.cantidad, ingresos: s.ingresos + Number(r.total) }), { cantidad: 0, ingresos: 0 });
    const ms = startMesAnt.toISOString().slice(0, 10), me = endMesAnt.toISOString().slice(0, 10);
    const ventasMesAnterior = rows.filter(r => r.fecha >= ms && r.fecha <= me).reduce((s, r) => ({ cantidad: s.cantidad + r.cantidad, ingresos: s.ingresos + Number(r.total) }), { cantidad: 0, ingresos: 0 });
    const startAnio = `${anio}-01-01`, startAnioAnt = `${anio-1}-01-01`, endAnioAnt = `${anio-1}-12-31`;
    const ventasAnioActual = rows.filter(r => r.fecha >= startAnio).reduce((s, r) => ({ cantidad: s.cantidad + r.cantidad, ingresos: s.ingresos + Number(r.total) }), { cantidad: 0, ingresos: 0 });
    const ventasAnioAnterior = rows.filter(r => r.fecha >= startAnioAnt && r.fecha <= endAnioAnt).reduce((s, r) => ({ cantidad: s.cantidad + r.cantidad, ingresos: s.ingresos + Number(r.total) }), { cantidad: 0, ingresos: 0 });
    const crecimiento = ventasMesAnterior.ingresos > 0 ? Number(((ventasMesActual.ingresos - ventasMesAnterior.ingresos) / ventasMesAnterior.ingresos * 100).toFixed(1)) : ventasMesActual.ingresos > 0 ? 100 : 0;
    const ventasHoy = rows.filter(r => r.fecha === hoy);
    const totalDia = ventasHoy.reduce((s, r) => ({ ventas: s.ventas + 1, monto: s.monto + Number(r.total) }), { ventas: 0, monto: 0 });
    const productosVendidosDia = ventasHoy.reduce((s, r) => s + r.cantidad, 0);
    const diasSemana = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    const vds = rows.reduce(function(acc, r) {
      const d = new Date(r.fecha + 'T12:00:00').getDay();
      if (!acc[d]) acc[d] = { dia: diasSemana[d], cantidad: 0, ingresos: 0 };
      acc[d].cantidad += r.cantidad;
      acc[d].ingresos += Number(r.total);
      return acc;
    }, {});
    const ventasDiaSemana = Object.values(vds).sort((a,b) => diasSemana.indexOf(a.dia) - diasSemana.indexOf(b.dia));
    const distribucionMetodos = Object.entries(rows.reduce((map, r) => { map[r.metodo_pago] = (map[r.metodo_pago]||0) + Number(r.total); return map; }, {})).map(([k,v]) => ({ metodo_pago: k, total: v }));
    const prodMap = rows.reduce((m, r) => { m[r.producto] = (m[r.producto]||0) + r.cantidad; return m; }, {});
    const prodTotal = rows.reduce((m, r) => { m[r.producto] = (m[r.producto]||0) + Number(r.total); return m; }, {});
    const topProductos = Object.entries(prodMap).sort((a,b) => b[1]-a[1]).slice(0,10).map(([k,v]) => ({ producto: k, vendidos: v }));
    const bottomProductos = Object.entries(prodMap).sort((a,b) => a[1]-b[1]).slice(0,10).map(([k,v]) => ({ producto: k, vendidos: v }));
    const catData = await pool.query('SELECT nombre, stock FROM categorias ORDER BY nombre');
    const categorias = catData[0];
    const rotacionProductos = categorias.map(c => ({ producto: c.nombre, stock: c.stock, vendidos: prodMap[c.nombre] || 0 }));
    const productosSinMovimiento = rotacionProductos.filter(p => p.vendidos === 0).map(p => p.producto);
    const productosAgotados = categorias.filter(c => c.stock === 0).length;
    const productosProximosAgotar = categorias.filter(c => c.stock > 0 && c.stock <= 3).length;
    const ventasCategorias = Object.entries(prodTotal).sort((a,b) => b[1]-a[1]).map(([k,v]) => ({ categoria: k, total: v }));
    const vendPorVend = rows.reduce((m, r) => { if (!m[r.vendedor]) m[r.vendedor] = { ventas: 0, total: 0, productos: 0 }; m[r.vendedor].ventas++; m[r.vendedor].total += Number(r.total); m[r.vendedor].productos += r.cantidad; return m; }, {});
    const ventasVendedor = Object.entries(vendPorVend).map(([k,v]) => ({ vendedor: k, ...v })).sort((a,b) => b.total - a.total);

    const grupoRows = rows.filter(r => r.grupo_id);
    const grupos = new Map();
    for (const r of grupoRows) {
      if (!grupos.has(r.grupo_id)) grupos.set(r.grupo_id, []);
      grupos.get(r.grupo_id).push(r);
    }
    const pairs = new Map();
    for (const [,items] of grupos) {
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i].producto < items[j].producto ? items[i].producto : items[j].producto;
          const b = items[i].producto < items[j].producto ? items[j].producto : items[i].producto;
          const key = a + '::' + b;
          pairs.set(key, (pairs.get(key) || 0) + 1);
        }
      }
    }
    const productosJuntos = Array.from(pairs.entries()).sort((a,b) => b[1]-a[1]).slice(0,15).map(function(e) {
      const p = e[0].split('::'); return { prod1: p[0], prod2: p[1], veces: e[1] };
    });
    const promArr = Array.from(grupos.values()).map(items => items.reduce((s, r) => s + r.cantidad, 0));
    const cantidadPromedio = promArr.length ? Number((promArr.reduce((s,c) => s + c, 0) / promArr.length).toFixed(1)) : 0;

    const rn = function(arr, key) { return arr.map(d => { var o = {}; o[key] = d.key; o.cantidad = d.cantidad; o.ingresos = d.total; return o; }); };
    res.json({
      ventasDiarias: rn(ventasDiarias, 'fecha'),
      ventasSemanales: rn(ventasSemanales, 'inicio_semana'),
      ventasMensuales: rn(ventasMensuales, 'mes'),
      ventasMesActual, ventasMesAnterior, ventasAnioActual, ventasAnioAnterior,
      crecimiento, totalDia, productosVendidosDia,
      ventasDiaSemana, distribucionMetodos,
      topProductos, bottomProductos, rotacionProductos,
      productosSinMovimiento,
      productosAgotados, productosProximosAgotar,
      ventasCategorias, productosJuntos, ventasVendedor,
      cantidadPromedio,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Agrupa registros por clave y suma cantidad+total
function agrupar(arr, keyFn, valFn) {
  const map = new Map();
  for (const r of arr) {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, { cantidad: 0, total: 0 });
    const v = map.get(k);
    v.cantidad += r.cantidad;
    v.total += Number(r.total);
  }
  return Array.from(map.entries()).map(([k, v]) => ({ ...v, key: k }));
}

//Elimina venta y restaura stock
router.delete('/:id(\\d+)', requireAuth, requireRole('admin', 'vendedor'), async (req, res) => {
  let conn;
  try {
    const id = Number(req.params.id);
    conn = await pool.getConnection();
    const [rows] = await conn.query('SELECT producto, cantidad FROM ventas WHERE id = ?', [id]);
    if (!rows.length) {
      conn.release();
      return res.status(404).json({ error: 'Venta no encontrada' });
    }
    const { producto, cantidad } = rows[0];
    await conn.beginTransaction();
    await conn.query('UPDATE categorias SET stock = stock + ? WHERE nombre = ?', [cantidad, producto]);
    await conn.query('DELETE FROM ventas WHERE id = ?', [id]);
    await conn.commit();
    conn.release();
    res.json({ ok: true });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch {}; conn.release(); }
    res.status(500).json({ error: err.message });
  }
});

//Actualiza venta
router.put('/:id(\\d+)', requireAuth, requireRole('admin', 'vendedor'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { productName, quantity, total, recibido, cambio, paymentMethod, comentario } = req.body;
    await pool.query(
      `UPDATE ventas
       SET producto = ?, cantidad = ?, total = ?, recibido = ?, cambio = ?, metodo_pago = ?, comentario = ?
       WHERE id = ?`,
      [productName ?? '', Number(quantity) ?? 0, Number(total) ?? 0, Number(recibido) ?? 0, Number(cambio) ?? 0, paymentMethod ?? 'efectivo', comentario ?? '', id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
