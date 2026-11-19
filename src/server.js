require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const pool = require('./db');
const authRoutes = require('./routes/auth');
const frontdeskRoutes = require('./routes/frontdesk');
const doctorRoutes = require('./routes/doctor');
const pharmacyRoutes = require('./routes/pharmacy');
const { requireAuth } = require('./middleware/auth');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
}));
app.use(flash());

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.flash = { success: req.flash('success'), error: req.flash('error') };
  next();
});

app.get('/', (req, res) => {
  if (req.session.user) {
    const map = { frontdesk: '/frontdesk', doctor: '/doctor', pharmacy: '/pharmacy' };
    return res.redirect(map[req.session.user.role]);
  }
  res.render('index', { title: 'I&M Hospital' });
});

app.use('/', authRoutes);
app.use('/frontdesk', frontdeskRoutes);
app.use('/doctor', doctorRoutes);
app.use('/pharmacy', pharmacyRoutes);

app.get('/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch { res.status(500).json({ ok: false }); }
});

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', message: 'Page not found.' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Server error', message: 'Something went wrong. Please try again.' });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`I&M Hospital running on http://localhost:${port}`));