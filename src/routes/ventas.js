import { Router } from 'express';
import { pool, hoyLocal } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, requireRole('admin', 'vendedor'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT v.id, v.producto AS productName, v.cliente AS customer,
               v.cantidad AS quantity, v.total, v.recibido, v.cambio,
               v.metodo_pago AS paymentMethod, v.fecha AS date, u.nombre AS vendedor,
               v.comentario, v.grupo_id AS grupoId
        FROM ventas v
        JOIN usuarios u ON u.id = v.vendedor_id
        ORDER BY v.fecha DESC, v.id DESC
        LIMIT 100`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

router.post('/caja/abrir', requireAuth, requireRole('admin', 'vendedor'), async (req, res) => {
  try {
    const hoy = hoyLocal();
    await pool.query('INSERT INTO aperturas_caja (fecha, abierto_por) VALUES (?, ?)', [hoy, req.user.id]);
    res.json({ ok: true, fecha: hoy });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

    const paramsResumen = esAdmin ? [hoy] : [hoy, req.user.id];
    const [resumen] = await pool.query(
      `SELECT COUNT(*) AS transacciones, COALESCE(SUM(cantidad),0) AS articulos, COALESCE(SUM(total),0) AS total
       FROM ventas WHERE fecha = ? ${filtroUsuario}`,
      paramsResumen
    );

    const paramsMetodos = esAdmin ? [hoy] : [hoy, req.user.id];
    const [metodos] = await pool.query(
      `SELECT metodo_pago, COUNT(*) AS cantidad, COALESCE(SUM(total),0) AS total
       FROM ventas WHERE fecha = ? ${filtroUsuario} GROUP BY metodo_pago ORDER BY total DESC`,
      paramsMetodos
    );

    res.json({
      fecha: new Date().toISOString().slice(0, 10),
      usuario: req.user.nombre,
      rol: req.user.role,
      confirmado: !!confirmado,
      confirmadoPor: confirmado?.confirmado_por || null,
      confirmadoEn: confirmado?.confirmado_en || null,
      cajaAbierta: !!apertura,
      aperturaPor: apertura?.abierto_por || null,
      aperturaEn: apertura?.abierto_en || null,
      resumen: resumen[0],
      metodos,
      ventas,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
       FROM ventas v
       JOIN usuarios u ON u.id = v.vendedor_id
       WHERE v.fecha >= ? AND v.fecha <= ?
       GROUP BY v.vendedor_id, u.nombre
       ORDER BY total DESC`,
      [inicio, fin]
    );

    const [porMetodo] = await pool.query(
      `SELECT metodo_pago, COUNT(*) AS cantidad, COALESCE(SUM(total),0) AS total
       FROM ventas WHERE fecha >= ? AND fecha <= ?
       GROUP BY metodo_pago
       ORDER BY total DESC`,
      [inicio, fin]
    );

    const [diario] = await pool.query(
      `SELECT fecha, COUNT(*) AS cantidad, COALESCE(SUM(total),0) AS ingresos
       FROM ventas WHERE fecha >= ? AND fecha <= ?
       GROUP BY fecha ORDER BY fecha ASC`,
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

router.get('/analytics', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const hoy = hoyLocal();
    const hoyDate = new Date();
    const hace30 = new Date(hoyDate); hace30.setDate(hace30.getDate() - 30);
    const hace12m = new Date(hoyDate); hace12m.setMonth(hace12m.getMonth() - 12);
    const hace1a = new Date(hoyDate); hace1a.setFullYear(hace1a.getFullYear() - 1);
    const f30 = hace30.toISOString().slice(0, 10);
    const f12m = hace12m.toISOString().slice(0, 10);
    const f1a = hace1a.toISOString().slice(0, 10);

    const startMes = `${hoyDate.getFullYear()}-${String(hoyDate.getMonth() + 1).padStart(2, '0')}-01`;
    const startMesAnt = new Date(hoyDate.getFullYear(), hoyDate.getMonth() - 1, 1);
    const endMesAnt = new Date(hoyDate.getFullYear(), hoyDate.getMonth(), 0);
    const fMA = startMesAnt.toISOString().slice(0, 10);
    const fMAEnd = endMesAnt.toISOString().slice(0, 10);

    const startAnio = `${hoyDate.getFullYear()}-01-01`;
    const startAnioAnt = `${hoyDate.getFullYear() - 1}-01-01`;
    const endAnioAnt = `${hoyDate.getFullYear() - 1}-12-31`;

    const [ventasDiarias] = await pool.query(
      `SELECT fecha, COUNT(*) AS cantidad, COALESCE(SUM(total),0) AS ingresos
       FROM ventas WHERE fecha >= ? GROUP BY fecha ORDER BY fecha ASC`, [f30]
    );

    const [ventasSemanales] = await pool.query(
      `SELECT YEARWEEK(fecha,1) AS semana, MIN(fecha) AS inicio_semana,
              COUNT(*) AS cantidad, COALESCE(SUM(total),0) AS ingresos
       FROM ventas WHERE fecha >= ? GROUP BY YEARWEEK(fecha,1) ORDER BY semana ASC`, [f30]
    );

    const [ventasMensuales] = await pool.query(
      `SELECT DATE_FORMAT(fecha,'%Y-%m') AS mes, COUNT(*) AS cantidad, COALESCE(SUM(total),0) AS ingresos
       FROM ventas WHERE fecha >= ? GROUP BY DATE_FORMAT(fecha,'%Y-%m') ORDER BY mes ASC`, [f12m]
    );

    const [ventasMesActual] = await pool.query(
      `SELECT COUNT(*) AS cantidad, COALESCE(SUM(total),0) AS ingresos FROM ventas WHERE fecha >= ?`, [startMes]
    );

    const [ventasMesAnterior] = await pool.query(
      `SELECT COUNT(*) AS cantidad, COALESCE(SUM(total),0) AS ingresos FROM ventas WHERE fecha >= ? AND fecha <= ?`,
      [fMA, fMAEnd]
    );

    const [ventasAnioActual] = await pool.query(
      `SELECT COUNT(*) AS cantidad, COALESCE(SUM(total),0) AS ingresos FROM ventas WHERE fecha >= ?`, [startAnio]
    );

    const [ventasAnioAnterior] = await pool.query(
      `SELECT COUNT(*) AS cantidad, COALESCE(SUM(total),0) AS ingresos FROM ventas WHERE fecha >= ? AND fecha <= ?`,
      [startAnioAnt, endAnioAnt]
    );

    const crecimiento = ventasMesAnterior[0].ingresos > 0
      ? ((ventasMesActual[0].ingresos - ventasMesAnterior[0].ingresos) / ventasMesAnterior[0].ingresos * 100).toFixed(1)
      : ventasMesActual[0].ingresos > 0 ? 100 : 0;

    const [totalDia] = await pool.query(
      `SELECT COUNT(*) AS ventas, COALESCE(SUM(total),0) AS monto FROM ventas WHERE fecha = ?`, [hoy]
    );

    const [productosVendidosDia] = await pool.query(
      `SELECT COALESCE(SUM(cantidad),0) AS total FROM ventas WHERE fecha = ?`, [hoy]
    );

    const [ventasDiaSemana] = await pool.query(
      `SELECT DAYOFWEEK(fecha) AS dia_num,
              CASE DAYOFWEEK(fecha)
                WHEN 1 THEN 'Domingo' WHEN 2 THEN 'Lunes' WHEN 3 THEN 'Martes'
                WHEN 4 THEN 'Miércoles' WHEN 5 THEN 'Jueves' WHEN 6 THEN 'Viernes'
                WHEN 7 THEN 'Sábado'
              END AS dia,
              COUNT(*) AS cantidad, COALESCE(SUM(total),0) AS ingresos
       FROM ventas WHERE fecha >= ?
       GROUP BY DAYOFWEEK(fecha) ORDER BY dia_num`, [f12m]
    );

    const [distribucionMetodos] = await pool.query(
      `SELECT metodo_pago, COUNT(*) AS cantidad, COALESCE(SUM(total),0) AS total
       FROM ventas GROUP BY metodo_pago ORDER BY total DESC`
    );

    const [topProductos] = await pool.query(
      `SELECT producto, SUM(cantidad) AS vendidos, COALESCE(SUM(total),0) AS total
       FROM ventas GROUP BY producto ORDER BY vendidos DESC LIMIT 10`
    );

    const [bottomProductos] = await pool.query(
      `SELECT producto, SUM(cantidad) AS vendidos, COALESCE(SUM(total),0) AS total
       FROM ventas GROUP BY producto ORDER BY vendidos ASC LIMIT 10`
    );

    const [rotacionProductos] = await pool.query(
      `SELECT c.nombre AS producto, c.stock,
              COALESCE((SELECT SUM(v.cantidad) FROM ventas v WHERE v.producto = c.nombre), 0) AS vendidos
       FROM categorias c ORDER BY vendidos DESC`
    );

    const productosSinMovimiento = rotacionProductos.filter((p: any) => p.vendidos === 0).map((p: any) => p.producto);

    const [inventarioCategorias] = await pool.query(
      `SELECT nombre, stock FROM categorias ORDER BY nombre`
    );

    const productosAgotados = inventarioCategorias.filter((p: any) => p.stock === 0).length;
    const productosProximosAgotar = inventarioCategorias.filter((p: any) => p.stock > 0 && p.stock <= 3).length;

    const [ventasCategorias] = await pool.query(
      `SELECT v.producto AS categoria, SUM(v.cantidad) AS cantidad, COALESCE(SUM(v.total),0) AS total
       FROM ventas v GROUP BY v.producto ORDER BY total DESC`
    );

    const [productosJuntos] = await pool.query(
      `SELECT a.producto AS prod1, b.producto AS prod2, COUNT(*) AS veces
       FROM ventas a
       JOIN ventas b ON a.grupo_id = b.grupo_id AND a.grupo_id IS NOT NULL AND a.producto < b.producto
       GROUP BY a.producto, b.producto
       ORDER BY veces DESC LIMIT 15`
    );

    const [ventasVendedor] = await pool.query(
      `SELECT u.nombre AS vendedor, COUNT(*) AS ventas,
              COALESCE(SUM(v.total),0) AS total, COALESCE(SUM(v.cantidad),0) AS productos
       FROM ventas v
       JOIN usuarios u ON u.id = v.vendedor_id
       WHERE v.fecha >= ?
       GROUP BY v.vendedor_id, u.nombre
       ORDER BY total DESC`, [f12m]
    );

    const [cantidadPromedio] = await pool.query(
      `SELECT AVG(sub.cant) AS promedio FROM (
         SELECT grupo_id, SUM(cantidad) AS cant FROM ventas WHERE grupo_id IS NOT NULL GROUP BY grupo_id
       ) sub`
    );

    res.json({
      ventasDiarias, ventasSemanales, ventasMensuales,
      ventasMesActual: ventasMesActual[0], ventasMesAnterior: ventasMesAnterior[0],
      ventasAnioActual: ventasAnioActual[0], ventasAnioAnterior: ventasAnioAnterior[0],
      crecimiento: Number(crecimiento),
      totalDia: totalDia[0],
      productosVendidosDia: productosVendidosDia[0].total,
      ventasDiaSemana, distribucionMetodos,
      topProductos, bottomProductos, rotacionProductos,
      productosSinMovimiento, inventarioCategorias,
      productosAgotados, productosProximosAgotar,
      ventasCategorias, productosJuntos, ventasVendedor,
      cantidadPromedio: cantidadPromedio[0]?.promedio || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

router.put('/:id(\\d+)', requireAuth, requireRole('admin', 'vendedor'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { productName, quantity, total, recibido, cambio, paymentMethod, comentario } = req.body;
    const [rows] = await pool.query(
      `UPDATE ventas
       SET producto = ?, cantidad = ?, total = ?, recibido = ?, cambio = ?, metodo_pago = ?, comentario = ?
       WHERE id = ?`,
      [productName ?? '', Number(quantity) ?? 0, Number(total) ?? 0, Number(recibido) ?? 0, Number(cambio) ?? 0, paymentMethod ?? 'efectivo', comentario ?? '', id]
    );
    if (rows.affectedRows === 0) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
