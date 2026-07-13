import { Router } from 'express';
import { pool, hoyLocal } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, requireRole('admin', 'vendedor'), async (req, res) => {
  try {
    const esAdmin = req.user.role === 'admin';
    const query = esAdmin
      ? `SELECT a.id, a.cliente_nombre AS clienteNombre, a.cliente_celular AS clienteCelular,
                a.cliente_correo AS clienteCorreo, a.producto, a.abono, a.saldo, a.fecha AS date,
                a.estado, a.comentario, u.nombre AS vendedor
         FROM apartados a
         JOIN usuarios u ON u.id = a.vendedor_id
         ORDER BY a.estado ASC, a.fecha DESC`
      : `SELECT a.id, a.cliente_nombre AS clienteNombre, a.cliente_celular AS clienteCelular,
                a.cliente_correo AS clienteCorreo, a.producto, a.abono, a.saldo, a.fecha AS date,
                a.estado, a.comentario, u.nombre AS vendedor
         FROM apartados a
         JOIN usuarios u ON u.id = a.vendedor_id
         WHERE a.vendedor_id = ?
         ORDER BY a.estado ASC, a.fecha DESC`;
    const params = esAdmin ? [] : [req.user.id];
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requireAuth, requireRole('admin', 'vendedor'), async (req, res) => {
  try {
    const { clienteNombre, clienteCelular, clienteCorreo, producto, abono, saldo, comentario } = req.body;
    if (!clienteNombre || !producto) return res.status(400).json({ error: 'Nombre del cliente y producto requeridos' });
    const [result] = await pool.query(
      `INSERT INTO apartados (cliente_nombre, cliente_celular, cliente_correo, producto, abono, saldo, fecha, vendedor_id, estado, comentario)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?)`,
      [clienteNombre, clienteCelular || '', clienteCorreo || '', producto, Number(abono) || 0, Number(saldo) || 0, hoyLocal(), req.user.id, comentario || '']
    );
    res.status(201).json({ id: result.insertId, ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', requireAuth, requireRole('admin', 'vendedor'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const esAdmin = req.user.role === 'admin';
    const { clienteNombre, clienteCelular, clienteCorreo, producto, abono, saldo, estado, comentario } = req.body;
    const where = esAdmin ? 'WHERE id = ?' : 'WHERE id = ? AND vendedor_id = ?';
    const params = esAdmin
      ? [clienteNombre, clienteCelular || '', clienteCorreo || '', producto,
         Number(abono) || 0, Number(saldo) || 0, estado || 'pendiente', comentario || '', id]
      : [clienteNombre, clienteCelular || '', clienteCorreo || '', producto,
         Number(abono) || 0, Number(saldo) || 0, estado || 'pendiente', comentario || '', id, req.user.id];
    const [result] = await pool.query(
      `UPDATE apartados
       SET cliente_nombre = ?, cliente_celular = ?, cliente_correo = ?, producto = ?,
           abono = ?, saldo = ?, estado = ?, comentario = ?
       ${where}`,
      params
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Apartado no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [result] = await pool.query('DELETE FROM apartados WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Apartado no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
