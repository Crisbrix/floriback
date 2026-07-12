import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, requireRole('admin', 'vendedor'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT v.id, v.producto AS productName, v.cliente AS customer,
              v.cantidad AS quantity, v.total, v.recibido, v.cambio,
              v.metodo_pago AS paymentMethod, v.fecha AS date, u.nombre AS vendedor,
              v.comentario
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
       FROM ventas WHERE fecha = CURDATE()`
    );

    const [ventasPorVendedor] = await pool.query(
      `SELECT u.nombre AS vendedor, COUNT(*) AS ventas, COALESCE(SUM(v.total),0) AS total
       FROM ventas v
       JOIN usuarios u ON u.id = v.vendedor_id
       GROUP BY v.vendedor_id, u.nombre
       ORDER BY total DESC`
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

router.get('/cierre', requireAuth, requireRole('admin', 'vendedor'), async (req, res) => {
  try {
    const esAdmin = req.user.role === 'admin';
    const filtroUsuario = esAdmin ? '' : 'AND vendedor_id = ?';
    const params = esAdmin ? [] : [req.user.id];

    const [[confirmado]] = await pool.query(
      'SELECT id, confirmado_por, confirmado_en FROM cierres WHERE fecha = CURDATE()'
    );

    const [ventas] = await pool.query(
      `SELECT v.id, v.producto AS productName, v.cliente AS customer,
              v.cantidad AS quantity, v.total, v.recibido, v.cambio,
              v.metodo_pago AS paymentMethod, v.fecha AS date, u.nombre AS vendedor,
              v.comentario
       FROM ventas v
       JOIN usuarios u ON u.id = v.vendedor_id
       WHERE v.fecha = CURDATE() ${esAdmin ? '' : 'AND v.vendedor_id = ?'}
       ORDER BY v.id ASC`,
      params
    );

    const [resumen] = await pool.query(
      `SELECT COUNT(*) AS transacciones, COALESCE(SUM(cantidad),0) AS articulos, COALESCE(SUM(total),0) AS total
       FROM ventas WHERE fecha = CURDATE() ${filtroUsuario}`,
      params
    );

    const [metodos] = await pool.query(
      `SELECT metodo_pago, COUNT(*) AS cantidad, COALESCE(SUM(total),0) AS total
       FROM ventas WHERE fecha = CURDATE() ${filtroUsuario} GROUP BY metodo_pago ORDER BY total DESC`,
      params
    );

    res.json({
      fecha: new Date().toISOString().slice(0, 10),
      usuario: req.user.nombre,
      rol: req.user.role,
      confirmado: !!confirmado,
      confirmadoPor: confirmado?.confirmado_por || null,
      confirmadoEn: confirmado?.confirmado_en || null,
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
    await pool.query(
      'INSERT INTO cierres (fecha, confirmado_por) VALUES (CURDATE(), ?) ON DUPLICATE KEY UPDATE confirmado_por = VALUES(confirmado_por), confirmado_en = CURRENT_TIMESTAMP',
      [req.user.id]
    );
    res.json({ ok: true, fecha: new Date().toISOString().slice(0, 10) });
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
