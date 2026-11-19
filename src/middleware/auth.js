function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).render('error', {
        title: 'Access denied',
        message: 'You do not have permission to view this page.',
      });
    }
    next();
  };
}

function redirectToDashboard(role) {
  if (role === 'frontdesk') return '/frontdesk';
  if (role === 'doctor') return '/doctor';
  if (role === 'pharmacy') return '/pharmacy';
  return '/';
}

module.exports = { requireAuth, requireRole, redirectToDashboard };