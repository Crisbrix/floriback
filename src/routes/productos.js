import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validaSucursal } from '../lib/sucursal.js';

const router = Router();

//Lista productos con stock y descripcion desde categorias (por local)
router.get('/', async (req, res) => {
  try {
    const sucursal = validaSucursal(req.query.sucursal);
    const [rows] = await pool.query(
      `SELECT p.id, p.nombre AS name, p.categoria AS category, p.imagen AS image, p.color, COALESCE(c.stock, 0) AS stock, c.descripcion
       FROM productos p
       LEFT JOIN categorias c ON c.nombre = p.categoria AND c.sucursal = ?
       WHERE p.sucursal = ?
       ORDER BY p.creado DESC`,
      [sucursal, sucursal]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Crea producto
router.post('/', requireAuth, requireRole('admin', 'vendedor'), async (req, res) => {
  try {
    const { nombre, categoria, imagen } = req.body;
    const sucursal = validaSucursal(req.body.sucursal);
    if (!nombre || !categoria) {
      return res.status(400).json({ error: 'Nombre y categoría requeridos' });
    }
    const [cat] = await pool.query('SELECT color FROM categorias WHERE nombre = ? AND sucursal = ?', [categoria, sucursal]);
    const color = cat.length ? cat[0].color : '#FFFFFF';
    const [result] = await pool.query(
      'INSERT INTO productos (nombre, categoria, imagen, color, sucursal) VALUES (?, ?, ?, ?, ?)',
      [nombre, categoria, imagen || '', color, sucursal]
    );
    res.status(201).json({ id: result.insertId, nombre, categoria, imagen: imagen || '', color, sucursal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Actualiza producto
router.put('/:id', requireAuth, requireRole('admin', 'vendedor'), async (req, res) => {
  try {
    const { nombre, categoria, imagen } = req.body;
    const sucursal = validaSucursal(req.body.sucursal);
    const { id } = req.params;
    const [cat] = await pool.query('SELECT color FROM categorias WHERE nombre = ? AND sucursal = ?', [categoria, sucursal]);
    const color = cat.length ? cat[0].color : '#FFFFFF';
    await pool.query(
      'UPDATE productos SET nombre = ?, categoria = ?, imagen = ?, color = ?, sucursal = ? WHERE id = ?',
      [nombre, categoria, imagen || '', color, sucursal, id]
    );
    res.json({ id: Number(id), nombre, categoria, imagen: imagen || '', color, sucursal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Elimina producto
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM productos WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
