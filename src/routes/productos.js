import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validaSucursal } from '../lib/sucursal.js';

const router = Router();

//Lista productos con su propio stock y descripcion (por local)
router.get('/', async (req, res) => {
  try {
    const sucursal = validaSucursal(req.query.sucursal);
    const [rows] = await pool.query(
      `SELECT p.id, p.nombre AS name, p.categoria AS category, p.imagen AS image, p.color,
              p.stock, p.descripcion
       FROM productos p
       WHERE p.sucursal = ?
       ORDER BY p.creado DESC`,
      [sucursal]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Crea producto (con stock propio; ya no depende de categorias)
router.post('/', requireAuth, requireRole('admin', 'vendedor'), async (req, res) => {
  try {
    const { nombre, imagen, color, stock, descripcion } = req.body;
    const sucursal = validaSucursal(req.body.sucursal);
    if (!nombre) {
      return res.status(400).json({ error: 'Nombre requerido' });
    }
    const [result] = await pool.query(
      'INSERT INTO productos (nombre, categoria, imagen, color, stock, descripcion, sucursal) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [nombre, nombre, imagen || '', color || '#FFFFFF', Number(stock) || 0, descripcion || '', sucursal]
    );
    res.status(201).json({ id: result.insertId, nombre, imagen: imagen || '', color: color || '#FFFFFF', stock: Number(stock) || 0, descripcion: descripcion || '', sucursal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Actualiza producto (nombre, imagen, color, stock y descripcion)
router.put('/:id', requireAuth, requireRole('admin', 'vendedor'), async (req, res) => {
  try {
    const { nombre, imagen, color, stock, descripcion } = req.body;
    const sucursal = validaSucursal(req.body.sucursal);
    const { id } = req.params;
    await pool.query(
      'UPDATE productos SET nombre = ?, categoria = ?, imagen = ?, color = ?, stock = ?, descripcion = ?, sucursal = ? WHERE id = ?',
      [nombre, nombre, imagen || '', color || '#FFFFFF', Number(stock) || 0, descripcion || '', sucursal, id]
    );
    res.json({ id: Number(id), nombre, imagen: imagen || '', color: color || '#FFFFFF', stock: Number(stock) || 0, descripcion: descripcion || '', sucursal });
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
