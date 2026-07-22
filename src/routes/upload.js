import { Router } from 'express';
import { put } from '@vercel/blob';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

//Sube imagen a Vercel Blob y devuelve URL publica
router.post('/', requireAuth, async (req, res) => {
  try {
    const { data, filename } = req.body;
    if (!data || !filename) {
      return res.status(400).json({ error: 'data (base64) y filename requeridos' });
    }
    const buffer = Buffer.from(data, 'base64');
    const blob = await put(filename, buffer, { access: 'public' });
    res.json({ url: blob.url });
  } catch (err) {
    res.status(500).json({ error: 'Error al subir imagen: ' + err.message });
  }
});

export default router;
