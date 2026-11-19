const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db');
const { redirectToDashboard } = require('../middleware/auth');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect(redirectToDashboard(req.session.user.role));
  res.render('login', { title: 'Staff login', error: null, role: req.query.role || '' });
});

router.post('/login', async (req, res, next) => {
  const { email, password, role } = req.body;
  try {
    if (!email || !password || !role) {
      return res.status(400).render('login', { title: 'Staff login', error: 'All fields are required.', role });
    }
    const [rows] = await pool.execute('SELECT * FROM users WHERE email = ? LIMIT 1', [email.trim().toLowerCase()]);
    const user = rows[0];
    if (!user || user.role !== role) {
      return res.status(401).render('login', { title: 'Staff login', error: 'Invalid credentials for this portal.', role });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).render('login', { title: 'Staff login', error: 'Invalid credentials for this portal.', role });
    }
    req.session.user = { id: user.id, name: user.full_name, email: user.email, role: user.role };
    req.session.save(() => res.redirect(redirectToDashboard(user.role)));
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
});

module.exports = router;