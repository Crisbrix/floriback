import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

//Crea tabla si no existe
pool.query(`
  CREATE TABLE IF NOT EXISTS melsus_ventas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    producto VARCHAR(255) NOT NULL,
    metodo_pago VARCHAR(50) NOT NULL DEFAULT 'efectivo',
    total DECIMAL(12,2) NOT NULL DEFAULT 0,
    comentario TEXT,
    vendedor VARCHAR(255) NOT NULL DEFAULT '',
    fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`).catch(() => {});

//Lista ventas Melsus
router.get('/', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, producto, metodo_pago AS metodoPago, total, comentario, vendedor, fecha FROM melsus_ventas ORDER BY fecha DESC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Registra venta
router.post('/', requireAuth, async (req, res) => {
  try {
    const { producto, metodo_pago, total, comentario } = req.body;
    if (!producto) return res.status(400).json({ error: 'Producto requerido' });
    const [result] = await pool.query(
      'INSERT INTO melsus_ventas (producto, metodo_pago, total, comentario, vendedor) VALUES (?, ?, ?, ?, ?)',
      [producto, metodo_pago || 'efectivo', total || 0, comentario || '', req.user?.nombre || '']
    );
    res.status(201).json({ id: result.insertId, producto, metodo_pago, total, comentario });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Elimina venta
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM melsus_ventas WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
