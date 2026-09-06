import { Router } from 'express';
import { pool, hoyLocal } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validaSucursal } from '../lib/sucursal.js';

const router = Router();

//Lista devoluciones, opcionalmente filtradas por fecha y sucursal
router.get('/', requireAuth, requireRole('admin', 'vendedor'), async (req, res) => {
  try {
    const sucursal = validaSucursal(req.query.sucursal);
    const { fecha } = req.query;
    let query = `SELECT d.*, u.nombre AS vendedor,
                        d.producto_original AS productoOriginal,
                        d.producto_nuevo AS productoNuevo,
                        d.diferencia_precio AS diferenciaPrecio
                 FROM devoluciones d
                 JOIN usuarios u ON u.id = d.vendedor_id
                 WHERE d.sucursal = ?`;
    const params = [sucursal];
    if (fecha) {
      query += ' AND d.fecha = ?';
      params.push(fecha);
    }
    query += ' ORDER BY d.id DESC LIMIT 100';
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Registra una devolución o cambio
router.post('/', requireAuth, requireRole('admin', 'vendedor'), async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const { ventaId, productoOriginal, productoNuevo, cantidad = 1, diferenciaPrecio = 0, motivo = '' } = req.body;
    const sucursal = validaSucursal(req.body.sucursal);
    if (!productoOriginal) {
      conn.release();
      return res.status(400).json({ error: 'Producto original requerido' });
    }
    const cant = Number(cantidad) || 1;
    const dif = Number(diferenciaPrecio) || 0;

    await conn.beginTransaction();

    //Restaura stock del producto original
    await conn.query(
      'UPDATE productos SET stock = stock + ? WHERE nombre = ? AND sucursal = ?',
      [cant, productoOriginal, sucursal]
    );

    //Si hay cambio por otro producto, decrementa stock del nuevo
    if (productoNuevo && productoNuevo !== productoOriginal) {
      const [rows] = await conn.query(
        'SELECT stock FROM productos WHERE nombre = ? AND sucursal = ?',
        [productoNuevo, sucursal]
      );
      if (!rows.length) {
        await conn.rollback(); conn.release();
        return res.status(404).json({ error: `Producto ${productoNuevo} no encontrado` });
      }
      if (rows[0].stock < cant) {
        await conn.rollback(); conn.release();
        return res.status(400).json({ error: `Stock insuficiente de ${productoNuevo}` });
      }
      await conn.query(
        'UPDATE productos SET stock = stock - ? WHERE nombre = ? AND sucursal = ?',
        [cant, productoNuevo, sucursal]
      );
    }

    //Registra la devolución
    const [result] = await conn.query(
      `INSERT INTO devoluciones (venta_id, producto_original, producto_nuevo, cantidad, diferencia_precio, motivo, sucursal, fecha, vendedor_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ventaId || null, productoOriginal, productoNuevo || null, cant, dif, motivo, sucursal, hoyLocal(), req.user.id]
    );

    await conn.commit();
    conn.release(); conn = null;
    res.status(201).json({ ok: true, id: result.insertId });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch {}; conn.release(); }
    res.status(500).json({ error: err.message });
  }
});

//Elimina una devolución y revierte sus efectos
router.delete('/:id(\\d+)', requireAuth, requireRole('admin'), async (req, res) => {
  let conn;
  try {
    const id = Number(req.params.id);
    conn = await pool.getConnection();
    const [rows] = await conn.query('SELECT * FROM devoluciones WHERE id = ?', [id]);
    if (!rows.length) {
      conn.release();
      return res.status(404).json({ error: 'Devolución no encontrada' });
    }
    const dev = rows[0];

    await conn.beginTransaction();

    //Revierte stock: quita lo que se devolvió del producto original
    await conn.query(
      'UPDATE productos SET stock = stock - ? WHERE nombre = ? AND sucursal = ?',
      [dev.cantidad, dev.producto_original, dev.sucursal]
    );

    //Si había producto de cambio, restaura stock del nuevo
    if (dev.producto_nuevo && dev.producto_nuevo !== dev.producto_original) {
      await conn.query(
        'UPDATE productos SET stock = stock + ? WHERE nombre = ? AND sucursal = ?',
        [dev.cantidad, dev.producto_nuevo, dev.sucursal]
      );
    }

    await conn.query('DELETE FROM devoluciones WHERE id = ?', [id]);
    await conn.commit();
    conn.release(); conn = null;
    res.json({ ok: true });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch {}; conn.release(); }
    res.status(500).json({ error: err.message });
  }
});

export default router;
