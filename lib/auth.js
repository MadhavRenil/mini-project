function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
}

function optionalAuth() {
  return (req, res, next) => {
    req.userId = req.session && req.session.userId ? req.session.userId : null;
    next();
  };
}

module.exports = { requireAuth, optionalAuth };
