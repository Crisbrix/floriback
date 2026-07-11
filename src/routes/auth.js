import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { generateToken, requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }
    const [rows] = await pool.query('SELECT * FROM usuarios WHERE email = ?', [email]);
    if (!rows.length) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    const token = generateToken(user);
    res.json({ token, user: { id: user.id, email: user.email, nombre: user.nombre, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/register', async (req, res) => {
  try {
    const { email, nombre, password } = req.body;
    if (!email || !nombre || !password) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }
    const [existing] = await pool.query('SELECT id FROM usuarios WHERE email = ?', [email]);
    if (existing.length) {
      return res.status(409).json({ error: 'Este correo ya está registrado' });
    }
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO usuarios (email, nombre, password, role) VALUES (?, ?, ?, ?)',
      [email, nombre, hash, 'cliente']
    );
    res.status(201).json({ id: result.insertId, email, nombre, role: 'cliente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/register-admin', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { email, nombre, password, role } = req.body;
    if (!email || !nombre || !password || !role) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }
    if (!['vendedor', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }
    const [existing] = await pool.query('SELECT id FROM usuarios WHERE email = ?', [email]);
    if (existing.length) {
      return res.status(409).json({ error: 'Este correo ya existe' });
    }
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO usuarios (email, nombre, password, role) VALUES (?, ?, ?, ?)',
      [email, nombre, hash, role]
    );
    res.status(201).json({ id: result.insertId, email, nombre, role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/perfil', requireAuth, async (req, res) => {
  try {
    const { nombre, password } = req.body;
    if (!nombre) {
      return res.status(400).json({ error: 'El nombre es obligatorio' });
    }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await pool.query('UPDATE usuarios SET nombre = ?, password = ? WHERE id = ?', [nombre, hash, req.user.id]);
    } else {
      await pool.query('UPDATE usuarios SET nombre = ? WHERE id = ?', [nombre, req.user.id]);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
