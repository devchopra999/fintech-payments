const jwt = require('jsonwebtoken');

function secret() {
  return process.env.JWT_SECRET || 'development-secret';
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'missing bearer token' } });

  try {
    req.user = jwt.verify(token, secret());
    next();
  } catch (err) {
    res.status(401).json({ error: { code: 'INVALID_TOKEN', message: err.message } });
  }
}

module.exports = { requireAuth };
