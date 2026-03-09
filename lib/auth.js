function hasRegisteredUserSession(req) {
  return Boolean(req.session && req.session.userId && !req.session.isGuest);
}

function hasAppSession(req) {
  return Boolean(req.session && (req.session.isGuest || req.session.userId));
}

function requireAuth(req, res, next) {
  if (hasRegisteredUserSession(req)) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
}

function optionalAuth() {
  return (req, res, next) => {
    req.userId = hasRegisteredUserSession(req) ? req.session.userId : null;
    req.isGuest = Boolean(req.session && req.session.isGuest);
    next();
  };
}

module.exports = { requireAuth, optionalAuth, hasAppSession, hasRegisteredUserSession };
