import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, requireRole('admin', 'vendedor'), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, nombre AS name, stock, color, descripcion FROM categorias ORDER BY nombre');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { nombre, stock = 0, color = '#FFFFFF', descripcion = '' } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const [result] = await pool.query(
      'INSERT INTO categorias (nombre, stock, color, descripcion) VALUES (?, ?, ?, ?)',
      [nombre, Number(stock), color, descripcion]
    );
    res.status(201).json({ id: result.insertId, name: nombre, stock, color, descripcion });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Ya existe una categoría con ese nombre' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { nombre, color, descripcion } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    await pool.query(
      'UPDATE categorias SET nombre = ?, color = ?, descripcion = ? WHERE id = ?',
      [nombre, color || '#FFFFFF', descripcion || '', id]
    );
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Ya existe una categoría con ese nombre' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  let conn;
  try {
    const id = Number(req.params.id);
    conn = await pool.getConnection();
    const [[cat]] = await conn.query('SELECT nombre FROM categorias WHERE id = ?', [id]);
    if (!cat) { conn.release(); return res.status(404).json({ error: 'Categoría no encontrada' }); }
    await conn.beginTransaction();
    await conn.query('DELETE FROM productos WHERE categoria = ?', [cat.nombre]);
    await conn.query('DELETE FROM categorias WHERE id = ?', [id]);
    await conn.commit();
    conn.release();
    res.json({ ok: true });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch {}; conn.release(); }
    res.status(500).json({ error: err.message });
  }
});

export default router;
