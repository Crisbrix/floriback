import express from 'express';
import cors from 'cors';
import 'dotenv/config';

import authRoutes from './routes/auth.js';
import usuarioRoutes from './routes/usuarios.js';
import productoRoutes from './routes/productos.js';
import inventarioRoutes from './routes/inventario.js';
import ventaRoutes from './routes/ventas.js';
import categoriaRoutes from './routes/categorias.js';
import apartadoRoutes from './routes/apartados.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.options('*', (_req, res) => res.sendStatus(204));
app.use(express.json());
app.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/usuarios', usuarioRoutes);
app.use('/api/productos', productoRoutes);
app.use('/api/inventario', inventarioRoutes);
app.use('/api/ventas', ventaRoutes);
app.use('/api/categorias', categoriaRoutes);
app.use('/api/apartados', apartadoRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Vercel serverless export
export default app;

// Local development
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Floriback corriendo en http://localhost:${PORT}`);
  });
}
