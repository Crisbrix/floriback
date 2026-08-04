import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validaSucursal } from '../lib/sucursal.js';

const router = Router();

//Lista categorias con stock (por local)
router.get('/', requireAuth, requireRole('admin', 'vendedor'), async (req, res) => {
  try {
    const sucursal = validaSucursal(req.query.sucursal);
    const [rows] = await pool.query(
      'SELECT id, nombre AS name, stock, color, descripcion FROM categorias WHERE sucursal = ? ORDER BY nombre',
      [sucursal]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Crea categoria (pertenece a un local)
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { nombre, stock = 0, color = '#FFFFFF', descripcion = '' } = req.body;
    const sucursal = validaSucursal(req.body.sucursal);
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const [result] = await pool.query(
      'INSERT INTO categorias (nombre, stock, color, descripcion, sucursal) VALUES (?, ?, ?, ?, ?)',
      [nombre, Number(stock), color, descripcion, sucursal]
    );
    res.status(201).json({ id: result.insertId, name: nombre, stock, color, descripcion, sucursal });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Ya existe una categoría con ese nombre en este local' });
    res.status(500).json({ error: err.message });
  }
});

//Actualiza categoria (renombra y cascadea a sus productos del mismo local)
router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { nombre, color, descripcion } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const [[cat]] = await pool.query('SELECT nombre, sucursal FROM categorias WHERE id = ?', [id]);
    if (!cat) return res.status(404).json({ error: 'Categoría no encontrada' });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        'UPDATE categorias SET nombre = ?, color = ?, descripcion = ? WHERE id = ?',
        [nombre, color || '#FFFFFF', descripcion || '', id]
      );
      if (cat.nombre !== nombre) {
        await conn.query('UPDATE productos SET categoria = ? WHERE categoria = ? AND sucursal = ?', [nombre, cat.nombre, cat.sucursal]);
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Ya existe una categoría con ese nombre en este local' });
    res.status(500).json({ error: err.message });
  }
});

//Elimina categoria y sus productos asociados (solo de su local)
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  let conn;
  try {
    const id = Number(req.params.id);
    conn = await pool.getConnection();
    const [[cat]] = await conn.query('SELECT nombre, sucursal FROM categorias WHERE id = ?', [id]);
    if (!cat) { conn.release(); return res.status(404).json({ error: 'Categoría no encontrada' }); }
    await conn.beginTransaction();
    await conn.query('DELETE FROM productos WHERE categoria = ? AND sucursal = ?', [cat.nombre, cat.sucursal]);
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
