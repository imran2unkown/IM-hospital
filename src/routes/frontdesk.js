const express = require('express');
const pool = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('frontdesk'));

router.get('/', async (req, res, next) => {
  try {
    const [today] = await pool.execute(
      `SELECT a.id, a.scheduled_at, a.status, p.first_name, p.last_name
       FROM appointments a JOIN patients p ON p.id = a.patient_id
       WHERE DATE(a.scheduled_at) = CURDATE() ORDER BY a.scheduled_at`
    );
    const [[{ totalPatients }]] = await pool.query('SELECT COUNT(*) AS totalPatients FROM patients');
    const [[{ waiting }]] = await pool.query(
      "SELECT COUNT(*) AS waiting FROM appointments WHERE status = 'checked_in'"
    );
    res.render('frontdesk/dashboard', { title: 'Front Desk', today, totalPatients, waiting });
  } catch (err) { next(err); }
});

router.get('/patients', async (req, res, next) => {
  const q = (req.query.q || '').trim();
  try {
    let rows;
    if (q) {
      const like = `%${q}%`;
      [rows] = await pool.execute(
        `SELECT * FROM patients
         WHERE first_name LIKE ? OR last_name LIKE ? OR phone LIKE ? OR email LIKE ?
         ORDER BY last_name, first_name LIMIT 50`,
        [like, like, like, like]
      );
    } else {
      [rows] = await pool.execute('SELECT * FROM patients ORDER BY created_at DESC LIMIT 50');
    }
    res.render('frontdesk/patients', { title: 'Patients', patients: rows, q, errors: null, values: {} });
  } catch (err) { next(err); }
});

router.post('/patients', async (req, res, next) => {
  const v = req.body;
  const errors = [];
  if (!v.first_name?.trim()) errors.push('First name is required.');
  if (!v.last_name?.trim()) errors.push('Last name is required.');
  if (!v.dob) errors.push('Date of birth is required.');
  if (!['M','F','O'].includes(v.sex)) errors.push('Sex is required.');
  if (!v.phone?.trim()) errors.push('Phone is required.');

  if (errors.length) {
    const [rows] = await pool.query('SELECT * FROM patients ORDER BY created_at DESC LIMIT 50');
    return res.status(400).render('frontdesk/patients', { title: 'Patients', patients: rows, q: '', errors, values: v });
  }
  try {
    await pool.execute(
      `INSERT INTO patients (first_name, last_name, dob, sex, phone, email, address, weight, height, age, blood_pressure, allergies)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [v.first_name.trim(), v.last_name.trim(), v.dob, v.sex, v.phone.trim(),
       v.email?.trim() || null, v.address?.trim() || null, 
       v.weight || null, v.height || null, v.age || null, v.blood_pressure || null, v.allergies || null]
    );
    req.flash('success', 'Patient registered.');
    res.redirect('/frontdesk/patients');
  } catch (err) { next(err); }
});

router.post('/patients/:id', async (req, res, next) => {
  const v = req.body;
  try {
    await pool.execute(
      `UPDATE patients SET first_name=?, last_name=?, dob=?, sex=?, phone=?, email=?, address=?, weight=?, height=?, age=?, blood_pressure=?, allergies=? WHERE id=?`,
      [v.first_name, v.last_name, v.dob, v.sex, v.phone, v.email || null, v.address || null, 
       v.weight || null, v.height || null, v.age || null, v.blood_pressure || null, v.allergies || null, req.params.id]
    );
    req.flash('success', 'Patient updated.');
    res.redirect(`/frontdesk/patients?q=${encodeURIComponent(v.last_name)}`);
  } catch (err) { next(err); }
});

router.get('/patients/:id/history', async (req, res, next) => {
  try {
    const [patRows] = await pool.execute('SELECT * FROM patients WHERE id = ?', [req.params.id]);
    if (!patRows[0]) return res.status(404).render('error', { title: 'Not found', message: 'Patient not found.' });
    const [visits] = await pool.execute(
      `SELECT v.*, u.full_name AS doctor_name FROM visits v JOIN users u ON u.id = v.doctor_id
       WHERE v.patient_id = ? ORDER BY v.started_at DESC`, [req.params.id]
    );
    const [appts] = await pool.execute(
      `SELECT a.*, u.full_name AS doctor_name FROM appointments a JOIN users u ON u.id = a.doctor_id
       WHERE a.patient_id = ? ORDER BY a.scheduled_at DESC`, [req.params.id]
    );
    res.render('frontdesk/patient_history', { title: 'Patient history', patient: patRows[0], visits, appts });
  } catch (err) { next(err); }
});

router.get('/appointments', async (req, res, next) => {
  try {
    const [doctors] = await pool.execute("SELECT id, full_name FROM users WHERE role='doctor' ORDER BY full_name");
    const [appts] = await pool.execute(
      `SELECT a.*, p.first_name, p.last_name, u.full_name AS doctor_name
       FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN users u ON u.id = a.doctor_id
       ORDER BY a.scheduled_at DESC LIMIT 100`
    );
    const [patients] = await pool.execute('SELECT id, first_name, last_name FROM patients ORDER BY last_name LIMIT 200');
    res.render('frontdesk/appointments', { title: 'Appointments', appts, doctors, patients, errors: null, values: {} });
  } catch (err) { next(err); }
});

router.post('/appointments', async (req, res, next) => {
  const v = req.body;
  const errors = [];
  if (!v.patient_id) errors.push('Patient is required.');
  if (!v.doctor_id) errors.push('Doctor is required.');
  if (!v.scheduled_at) errors.push('Date & time is required.');
  if (errors.length) {
    req.flash('error', errors.join(' '));
    return res.redirect('/frontdesk/appointments');
  }
  try {
    await pool.execute(
      `INSERT INTO appointments (patient_id, doctor_id, scheduled_at, reason) VALUES (?, ?, ?, ?)`,
      [v.patient_id, v.doctor_id, v.scheduled_at.replace('T', ' '), v.reason || null]
    );
    req.flash('success', 'Appointment booked.');
    res.redirect('/frontdesk/appointments');
  } catch (err) { next(err); }
});

router.post('/appointments/:id/reschedule', async (req, res, next) => {
  try {
    await pool.execute('UPDATE appointments SET scheduled_at=?, status=? WHERE id=?',
      [req.body.scheduled_at.replace('T', ' '), 'booked', req.params.id]);
    req.flash('success', 'Appointment rescheduled.');
    res.redirect('/frontdesk/appointments');
  } catch (err) { next(err); }
});

router.post('/appointments/:id/cancel', async (req, res, next) => {
  try {
    await pool.execute("UPDATE appointments SET status='cancelled' WHERE id=?", [req.params.id]);
    req.flash('success', 'Appointment cancelled.');
    res.redirect('/frontdesk/appointments');
  } catch (err) { next(err); }
});

router.post('/appointments/:id/checkin', async (req, res, next) => {
  try {
    await pool.execute("UPDATE appointments SET status='checked_in' WHERE id=? AND status='booked'", [req.params.id]);
    req.flash('success', 'Patient checked in and added to the doctor queue.');
    res.redirect('/frontdesk/appointments');
  } catch (err) { next(err); }
});

module.exports = router;