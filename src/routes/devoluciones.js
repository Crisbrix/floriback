import { Router } from 'express';
import { pool, hoyLocal } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validaSucursal } from '../lib/sucursal.js';

const router = Router();

function parseProductosNuevo(val) {
  if (!val) return [];
  try {
    const arr = JSON.parse(val);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return val ? [{ name: val, quantity: 1 }] : [];
  }
}

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
    for (const r of rows) {
      r.productosNuevo = parseProductosNuevo(r.productoNuevo);
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Registra una devolución o cambio (soporta múltiples prendas de cambio)
router.post('/', requireAuth, requireRole('admin', 'vendedor'), async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const { ventaId, productoOriginal, productosNuevo = [], cantidad = 1, diferenciaPrecio = 0, motivo = '' } = req.body;
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

    //Si hay prendas de cambio, valida stock y decrementa cada una
    if (productosNuevo.length) {
      for (const p of productosNuevo) {
        const pCant = Number(p.quantity) || 1;
        if (p.name === productoOriginal) continue;
        const [rows] = await conn.query(
          'SELECT stock FROM productos WHERE nombre = ? AND sucursal = ?',
          [p.name, sucursal]
        );
        if (!rows.length) {
          await conn.rollback(); conn.release();
          return res.status(404).json({ error: `Producto ${p.name} no encontrado` });
        }
        if (rows[0].stock < pCant) {
          await conn.rollback(); conn.release();
          return res.status(400).json({ error: `Stock insuficiente de ${p.name} (necesita ${pCant}, hay ${rows[0].stock})` });
        }
        await conn.query(
          'UPDATE productos SET stock = stock - ? WHERE nombre = ? AND sucursal = ?',
          [pCant, p.name, sucursal]
        );
      }
    }

    //Serializa productos de cambio: si hay 1 es string, si hay más es JSON
    let productoNuevoDb = null;
    if (productosNuevo.length === 1) {
      productoNuevoDb = productosNuevo[0].name;
    } else if (productosNuevo.length > 1) {
      productoNuevoDb = JSON.stringify(productosNuevo);
    }

    //Registra la devolución
    const [result] = await conn.query(
      `INSERT INTO devoluciones (venta_id, producto_original, producto_nuevo, cantidad, diferencia_precio, motivo, sucursal, fecha, vendedor_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ventaId || null, productoOriginal, productoNuevoDb, cant, dif, motivo, sucursal, hoyLocal(), req.user.id]
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

    //Restaura stock de cada producto de cambio
    const productosNuevos = parseProductosNuevo(dev.producto_nuevo);
    for (const p of productosNuevos) {
      const pCant = Number(p.quantity) || 1;
      if (p.name === dev.producto_original) continue;
      await conn.query(
        'UPDATE productos SET stock = stock + ? WHERE nombre = ? AND sucursal = ?',
        [pCant, p.name, dev.sucursal]
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
