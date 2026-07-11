import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.nombre AS name, p.categoria AS category, p.imagen AS image, p.color, COALESCE(c.stock, 0) AS stock
       FROM productos p
       LEFT JOIN categorias c ON c.nombre = p.categoria
       ORDER BY p.creado DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requireAuth, requireRole('admin', 'vendedor'), async (req, res) => {
  try {
    const { nombre, categoria, imagen } = req.body;
    if (!nombre || !categoria) {
      return res.status(400).json({ error: 'Nombre y categoría requeridos' });
    }
    const [cat] = await pool.query('SELECT color FROM categorias WHERE nombre = ?', [categoria]);
    const color = cat.length ? cat[0].color : '#FFFFFF';
    const [result] = await pool.query(
      'INSERT INTO productos (nombre, categoria, imagen, color) VALUES (?, ?, ?, ?)',
      [nombre, categoria, imagen || '', color]
    );
    res.status(201).json({ id: result.insertId, nombre, categoria, imagen: imagen || '', color });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', requireAuth, requireRole('admin', 'vendedor'), async (req, res) => {
  try {
    const { nombre, categoria, imagen } = req.body;
    const { id } = req.params;
    const [cat] = await pool.query('SELECT color FROM categorias WHERE nombre = ?', [categoria]);
    const color = cat.length ? cat[0].color : '#FFFFFF';
    await pool.query(
      'UPDATE productos SET nombre = ?, categoria = ?, imagen = ?, color = ? WHERE id = ?',
      [nombre, categoria, imagen || '', color, id]
    );
    res.json({ id: Number(id), nombre, categoria, imagen: imagen || '', color });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM productos WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
