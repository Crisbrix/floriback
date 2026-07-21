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
import imageRoutes from './routes/images.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
//Cache-control para evitar datos obsoletos
app.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

//Rutas agrupadas por recurso
app.use('/api/auth', authRoutes);
app.use('/api/usuarios', usuarioRoutes);
app.use('/api/productos', productoRoutes);
app.use('/api/inventario', inventarioRoutes);
app.use('/api/ventas', ventaRoutes);
app.use('/api/categorias', categoriaRoutes);
app.use('/api/apartados', apartadoRoutes);
app.use('/api/images', imageRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

//Export para serverless Vercel
export default app;
//Local development
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Floriback corriendo en http://localhost:${PORT}`);
  });
}
