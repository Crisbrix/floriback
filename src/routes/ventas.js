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
    const filtroUsuario = esAdmin ? '' : 'AND v.vendedor_id = ?';
    const params = esAdmin ? [] : [req.user.id];

    const [ventas] = await pool.query(
      `SELECT v.id, v.producto AS productName, v.cliente AS customer,
              v.cantidad AS quantity, v.total, v.recibido, v.cambio,
              v.metodo_pago AS paymentMethod, v.fecha AS date, u.nombre AS vendedor,
              v.comentario
       FROM ventas v
       JOIN usuarios u ON u.id = v.vendedor_id
       WHERE v.fecha = CURDATE() ${filtroUsuario}
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
      resumen: resumen[0],
      metodos,
      ventas,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
