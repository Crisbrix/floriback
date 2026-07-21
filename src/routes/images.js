import { Router } from 'express';
import { Readable } from 'stream';

const router = Router();

//Proxy para servir imagenes desde Google Drive
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const driveRes = await fetch(`https://drive.google.com/uc?export=view&id=${encodeURIComponent(id)}`);
    if (!driveRes.ok) {
      return res.status(404).json({ error: 'Imagen no encontrada en Google Drive' });
    }
    res.setHeader('Content-Type', driveRes.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    Readable.fromWeb(driveRes.body).pipe(res);
  } catch {
    res.status(502).json({ error: 'Error al conectar con Google Drive' });
  }
});

export default router;
