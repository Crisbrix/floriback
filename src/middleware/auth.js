import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'floripondia_secret_cambiar_en_produccion';

export function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, nombre: user.nombre, role: user.role },
    SECRET,
    { expiresIn: '24h' }
  );
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }
  try {
    req.user = jwt.verify(header.slice(7), SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    next();
  };
}
