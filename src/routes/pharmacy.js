const express = require('express');
const pool = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('pharmacy'));

router.get('/', async (req, res, next) => {
  try {
    const [rx] = await pool.execute(
      `SELECT pr.id, pr.status, pr.created_at, p.first_name, p.last_name, u.full_name AS doctor_name,
              (SELECT COUNT(*) FROM prescription_items WHERE prescription_id = pr.id) AS item_count
       FROM prescriptions pr
       JOIN patients p ON p.id = pr.patient_id
       JOIN users u ON u.id = pr.doctor_id
       WHERE pr.status = 'sent'
       ORDER BY pr.created_at`
    );
    const [lowStock] = await pool.execute(
      `SELECT * FROM medicines
       WHERE stock_quantity <= low_stock_threshold OR stock_quantity = 0
       ORDER BY stock_quantity ASC LIMIT 20`
    );
    res.render('pharmacy/dashboard', { title: 'Pharmacy', rx, lowStock });
  } catch (err) { next(err); }
});

router.get('/prescriptions/:id', async (req, res, next) => {
  try {
    const [[rx]] = await pool.execute(
      `SELECT pr.*, p.first_name, p.last_name, u.full_name AS doctor_name
       FROM prescriptions pr JOIN patients p ON p.id = pr.patient_id
       JOIN users u ON u.id = pr.doctor_id WHERE pr.id=?`, [req.params.id]
    );
    if (!rx) return res.status(404).render('error', { title: 'Not found', message: 'Prescription not found.' });
    const [items] = await pool.execute(
      `SELECT pi.*, m.name, m.stock_quantity, m.expiry_date, m.unit
       FROM prescription_items pi JOIN medicines m ON m.id = pi.medicine_id
       WHERE pi.prescription_id=?`, [rx.id]
    );
    res.render('pharmacy/prescription', { title: 'Prescription', rx, items });
  } catch (err) { next(err); }
});

router.post('/prescriptions/:id/dispense', async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[rx]] = await conn.execute("SELECT * FROM prescriptions WHERE id=? AND status='sent' FOR UPDATE",
      [req.params.id]);
    if (!rx) {
      await conn.rollback();
      req.flash('error', 'Prescription is not pending.');
      return res.redirect('/pharmacy');
    }
    const [items] = await conn.execute(
      `SELECT pi.*, m.stock_quantity, m.name FROM prescription_items pi
       JOIN medicines m ON m.id = pi.medicine_id WHERE pi.prescription_id=?`, [rx.id]
    );
    for (const it of items) {
      if (it.stock_quantity < it.quantity) {
        await conn.rollback();
        req.flash('error', `Insufficient stock for ${it.name}.`);
        return res.redirect(`/pharmacy/prescriptions/${rx.id}`);
      }
      await conn.execute('UPDATE medicines SET stock_quantity = stock_quantity - ? WHERE id = ?',
        [it.quantity, it.medicine_id]);
    }
    await conn.execute(
      "UPDATE prescriptions SET status='dispensed', dispensed_at=NOW(), dispensed_by=? WHERE id=?",
      [req.session.user.id, rx.id]
    );
    await conn.commit();
    req.flash('success', 'Prescription dispensed and stock updated.');
    res.redirect('/pharmacy');
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

router.get('/stock', async (req, res, next) => {
  try {
    const [meds] = await pool.execute('SELECT * FROM medicines ORDER BY name');
    res.render('pharmacy/stock', { title: 'Medicine stock', meds });
  } catch (err) { next(err); }
});

router.post('/stock', async (req, res, next) => {
  const v = req.body;
  try {
    await pool.execute(
      `INSERT INTO medicines (name, unit, stock_quantity, expiry_date, low_stock_threshold)
       VALUES (?, ?, ?, ?, ?)`,
      [v.name, v.unit || 'tablets', Number(v.stock_quantity) || 0, v.expiry_date,
       Number(v.low_stock_threshold) || 20]
    );
    req.flash('success', 'Medicine added.');
    res.redirect('/pharmacy/stock');
  } catch (err) { next(err); }
});

router.post('/stock/:id', async (req, res, next) => {
  const v = req.body;
  try {
    await pool.execute(
      `UPDATE medicines SET name=?, unit=?, stock_quantity=?, expiry_date=?, low_stock_threshold=? WHERE id=?`,
      [v.name, v.unit, Number(v.stock_quantity), v.expiry_date, Number(v.low_stock_threshold), req.params.id]
    );
    req.flash('success', 'Medicine updated.');
    res.redirect('/pharmacy/stock');
  } catch (err) { next(err); }
});

module.exports = router;