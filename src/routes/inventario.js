import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, nombre AS name, stock, color FROM categorias ORDER BY nombre'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sell-cart', requireAuth, requireRole('admin', 'vendedor'), async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const { items, metodo_pago, total = 0, recibido = 0 } = req.body;
    if (!items || !items.length) {
      conn.release(); conn = null;
      return res.status(400).json({ error: 'Carrito vacío' });
    }
    if (!['efectivo','tarjeta','transaccion'].includes(metodo_pago)) {
      conn.release(); conn = null;
      return res.status(400).json({ error: 'Método de pago inválido' });
    }
    await conn.beginTransaction();

    const cambio = Math.max(0, Number(recibido) - Number(total));
    for (let i = 0; i < items.length; i++) {
      const { name: nombre, quantity: cantidad } = items[i];
      const [rows] = await conn.query('SELECT stock FROM categorias WHERE nombre = ?', [nombre]);
      if (!rows.length) {
        await conn.rollback(); conn.release();
        return res.status(404).json({ error: `Categoría ${nombre} no encontrada` });
      }
      if (rows[0].stock < cantidad) {
        await conn.rollback(); conn.release();
        return res.status(400).json({ error: `Stock insuficiente para ${nombre}` });
      }
      await conn.query('UPDATE categorias SET stock = stock - ? WHERE nombre = ?', [cantidad, nombre]);
      const t = i === 0 ? total : 0;
      const r = i === 0 ? recibido : 0;
      const c = i === 0 ? cambio : 0;
      await conn.query(
        `INSERT INTO ventas (producto, cliente, cantidad, total, recibido, cambio, metodo_pago, fecha, vendedor_id)
         VALUES (?, 'Cliente', ?, ?, ?, ?, ?, CURDATE(), ?)`,
        [nombre, cantidad, t, r, c, metodo_pago, req.user.id]
      );
    }

    await conn.commit();
    conn.release(); conn = null;
    res.status(201).json({ ok: true, items: items.length });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch {}; conn.release(); }
    console.error('sell-cart error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:nombre', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { stock } = req.body;
    if (stock === undefined || stock < 0) {
      return res.status(400).json({ error: 'Stock inválido' });
    }
    await pool.query('UPDATE categorias SET stock = ? WHERE nombre = ?', [stock, req.params.nombre]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
