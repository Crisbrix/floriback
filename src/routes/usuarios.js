import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

//Lista todos los usuarios (solo admin)
router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, email, nombre, role, creado FROM usuarios ORDER BY creado DESC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
