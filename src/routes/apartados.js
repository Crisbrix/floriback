import { Router } from 'express';
import { pool, hoyLocal } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validaSucursal } from '../lib/sucursal.js';

const router = Router();

const METODOS = ['efectivo', 'tarjeta', 'nequi', 'daviplata', 'addi'];

function metodoValido(m) {
  return METODOS.includes(m) ? m : 'efectivo';
}

//Agrega a la proyeccion el metodo del ultimo abono registrado
const COLUMNAS = `a.id, a.cliente_nombre AS clienteNombre, a.cliente_celular AS clienteCelular,
                a.cliente_correo AS clienteCorreo, a.producto, a.abono, a.saldo, a.fecha AS date,
                a.estado, a.comentario, u.nombre AS vendedor,
                (SELECT b.metodo_pago FROM apartados_abono b
                 WHERE b.apartado_id = a.id ORDER BY b.id DESC LIMIT 1) AS metodoPago`;

//Lista apartados (admin ve todos los del local, vendedor solo los suyos del local)
router.get('/', requireAuth, requireRole('admin', 'vendedor'), async (req, res) => {
  try {
    const esAdmin = req.user.role === 'admin';
    const sucursal = validaSucursal(req.query.sucursal);
    const query = esAdmin
      ? `SELECT ${COLUMNAS}
         FROM apartados a
         JOIN usuarios u ON u.id = a.vendedor_id
         WHERE a.sucursal = ?
         ORDER BY a.estado ASC, a.fecha DESC`
      : `SELECT ${COLUMNAS}
         FROM apartados a
         JOIN usuarios u ON u.id = a.vendedor_id
         WHERE a.sucursal = ? AND a.vendedor_id = ?
         ORDER BY a.estado ASC, a.fecha DESC`;
    const params = esAdmin ? [sucursal] : [sucursal, req.user.id];
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Crea apartado y registra el abono inicial con su metodo de pago
router.post('/', requireAuth, requireRole('admin', 'vendedor'), async (req, res) => {
  let conn;
  try {
    const { clienteNombre, clienteCelular, clienteCorreo, producto, abono, saldo, comentario, metodoPago } = req.body;
    const sucursal = validaSucursal(req.body.sucursal);
    const metodo = metodoValido(metodoPago);
    if (!clienteNombre || !producto) return res.status(400).json({ error: 'Nombre del cliente y producto requeridos' });
    const abonoN = Number(abono) || 0;
    const saldoN = Number(saldo) || 0;
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO apartados (cliente_nombre, cliente_celular, cliente_correo, producto, abono, saldo, fecha, vendedor_id, estado, comentario, sucursal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?)`,
      [clienteNombre, clienteCelular || '', clienteCorreo || '', producto, abonoN, saldoN, hoyLocal(), req.user.id, comentario || '', sucursal]
    );
    if (abonoN > 0) {
      await conn.query(
        `INSERT INTO apartados_abono (apartado_id, monto, metodo_pago, fecha, vendedor_id, sucursal)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [result.insertId, abonoN, metodo, hoyLocal(), req.user.id, sucursal]
      );
    }
    await conn.commit();
    conn.release(); conn = null;
    res.status(201).json({ id: result.insertId, ok: true });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch {}; conn.release(); }
    res.status(500).json({ error: err.message });
  }
});

//Actualiza apartado; si el abono aumentó, registra la diferencia como nuevo abono con su metodo
router.put('/:id', requireAuth, requireRole('admin', 'vendedor'), async (req, res) => {
  let conn;
  try {
    const id = Number(req.params.id);
    const esAdmin = req.user.role === 'admin';
    const { clienteNombre, clienteCelular, clienteCorreo, producto, abono, saldo, estado, comentario, metodoPago } = req.body;
    const metodo = metodoValido(metodoPago);
    const abonoN = Number(abono) || 0;
    const saldoN = Number(saldo) || 0;
    const where = esAdmin ? 'WHERE id = ?' : 'WHERE id = ? AND vendedor_id = ?';
    const idParams = esAdmin ? [id] : [id, req.user.id];

    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[viejo]] = await conn.query(`SELECT abono FROM apartados ${where}`, idParams);
    if (!viejo) {
      await conn.rollback(); conn.release();
      return res.status(404).json({ error: 'Apartado no encontrado' });
    }
    //Pago nuevo = cuanto creció el abono total vs lo registrado antes
    const diferencia = abonoN - Number(viejo.abono);
    if (diferencia > 0) {
      const sucursal = validaSucursal(req.body.sucursal);
      await conn.query(
        `INSERT INTO apartados_abono (apartado_id, monto, metodo_pago, fecha, vendedor_id, sucursal)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, diferencia, metodo, hoyLocal(), req.user.id, sucursal]
      );
    }

    const params = esAdmin
      ? [clienteNombre, clienteCelular || '', clienteCorreo || '', producto,
         abonoN, saldoN, estado || 'pendiente', comentario || '', id]
      : [clienteNombre, clienteCelular || '', clienteCorreo || '', producto,
         abonoN, saldoN, estado || 'pendiente', comentario || '', id, req.user.id];
    await conn.query(
      `UPDATE apartados
       SET cliente_nombre = ?, cliente_celular = ?, cliente_correo = ?, producto = ?,
           abono = ?, saldo = ?, estado = ?, comentario = ?
       ${where}`,
      params
    );
    await conn.commit();
    conn.release(); conn = null;
    res.json({ ok: true });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch {}; conn.release(); }
    res.status(500).json({ error: err.message });
  }
});

//Elimina apartado y sus abonos (solo admin)
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  let conn;
  try {
    const id = Number(req.params.id);
    conn = await pool.getConnection();
    await conn.beginTransaction();
    await conn.query('DELETE FROM apartados_abono WHERE apartado_id = ?', [id]);
    const [result] = await conn.query('DELETE FROM apartados WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      await conn.rollback(); conn.release();
      return res.status(404).json({ error: 'Apartado no encontrado' });
    }
    await conn.commit();
    conn.release(); conn = null;
    res.json({ ok: true });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch {}; conn.release(); }
    res.status(500).json({ error: err.message });
  }
});

export default router;