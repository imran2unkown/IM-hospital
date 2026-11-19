const express = require('express');
const pool = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('doctor'));

router.get('/', async (req, res, next) => {
  try {
    const [queue] = await pool.execute(
      `SELECT a.id, a.scheduled_at, a.reason, a.status, p.first_name, p.last_name, p.id AS patient_id
       FROM appointments a JOIN patients p ON p.id = a.patient_id
       WHERE a.doctor_id = ? AND a.status IN ('booked','checked_in')
       ORDER BY FIELD(a.status,'checked_in','booked'), a.scheduled_at LIMIT 50`,
      [req.session.user.id]
    );
    const [upcoming] = await pool.execute(
      `SELECT a.id, a.scheduled_at, a.status, p.first_name, p.last_name
       FROM appointments a JOIN patients p ON p.id = a.patient_id
       WHERE a.doctor_id = ? AND a.scheduled_at >= NOW() - INTERVAL 1 DAY
       ORDER BY a.scheduled_at LIMIT 20`,
      [req.session.user.id]
    );
    res.render('doctor/dashboard', { title: 'Doctor', queue, upcoming });
  } catch (err) { next(err); }
});

router.post('/queue/:appointmentId/start', async (req, res, next) => {
  try {
    const [[appt]] = await pool.execute(
      `SELECT * FROM appointments WHERE id=? AND doctor_id=?`, [req.params.appointmentId, req.session.user.id]
    );
    if (!appt) { req.flash('error', 'Appointment not found.'); return res.redirect('/doctor'); }
    await pool.execute("UPDATE appointments SET status='in_consultation' WHERE id=?", [appt.id]);
    const [r] = await pool.execute(
      `INSERT INTO visits (patient_id, doctor_id, appointment_id, status) VALUES (?, ?, ?, 'open')`,
      [appt.patient_id, req.session.user.id, appt.id]
    );
    res.redirect(`/doctor/visits/${r.insertId}`);
  } catch (err) { next(err); }
});

router.get('/visits/:id', async (req, res, next) => {
  try {
    const [[visit]] = await pool.execute(
      `SELECT v.*, p.first_name, p.last_name, p.dob, p.sex, p.phone, p.id AS patient_id
       FROM visits v JOIN patients p ON p.id = v.patient_id
       WHERE v.id=? AND v.doctor_id=?`, [req.params.id, req.session.user.id]
    );
    if (!visit) return res.status(404).render('error', { title: 'Not found', message: 'Visit not found.' });
    const [history] = await pool.execute(
      `SELECT * FROM visits WHERE patient_id=? AND id<>? ORDER BY started_at DESC LIMIT 10`,
      [visit.patient_id, visit.id]
    );
    const [medicines] = await pool.execute('SELECT id, name, unit, stock_quantity FROM medicines ORDER BY name');
    const [items] = await pool.execute(
      `SELECT pi.*, m.name FROM prescription_items pi JOIN medicines m ON m.id = pi.medicine_id
       WHERE pi.prescription_id IN (SELECT id FROM prescriptions WHERE visit_id=? AND status='sent')`,
      [visit.id]
    );
    res.render('doctor/consultation', { title: 'Consultation', visit, history, medicines, items });
  } catch (err) { next(err); }
});

router.post('/visits/:id/save', async (req, res, next) => {
  try {
    await pool.execute(
      `UPDATE visits SET notes=?, diagnosis=?, treatment_plan=? WHERE id=? AND doctor_id=?`,
      [req.body.notes || null, req.body.diagnosis || null, req.body.treatment_plan || null,
       req.params.id, req.session.user.id]
    );
    req.flash('success', 'Consultation saved.');
    res.redirect(`/doctor/visits/${req.params.id}`);
  } catch (err) { next(err); }
});

router.post('/visits/:id/prescription', async (req, res, next) => {
  const { medicine_id, dosage, quantity } = req.body;
  try {
    const [[visit]] = await pool.execute('SELECT * FROM visits WHERE id=? AND doctor_id=?',
      [req.params.id, req.session.user.id]);
    if (!visit) return res.status(404).render('error', { title: 'Not found', message: 'Visit not found.' });

    let [[rx]] = await pool.execute(
      "SELECT * FROM prescriptions WHERE visit_id=? AND status='sent' LIMIT 1", [visit.id]
    );
    if (!rx) {
      const [r] = await pool.execute(
        `INSERT INTO prescriptions (visit_id, patient_id, doctor_id, status) VALUES (?, ?, ?, 'sent')`,
        [visit.id, visit.patient_id, req.session.user.id]
      );
      rx = { id: r.insertId };
    }
    await pool.execute(
      `INSERT INTO prescription_items (prescription_id, medicine_id, dosage, quantity) VALUES (?, ?, ?, ?)`,
      [rx.id, medicine_id, dosage, quantity]
    );
    req.flash('success', 'Prescription item added and sent to pharmacy.');
    res.redirect(`/doctor/visits/${req.params.id}`);
  } catch (err) { next(err); }
});

router.post('/visits/:id/complete', async (req, res, next) => {
  try {
    const [[visit]] = await pool.execute('SELECT * FROM visits WHERE id=? AND doctor_id=?',
      [req.params.id, req.session.user.id]);
    if (!visit) return res.status(404).render('error', { title: 'Not found', message: 'Visit not found.' });
    await pool.execute("UPDATE visits SET status='completed', completed_at=NOW() WHERE id=?", [visit.id]);
    if (visit.appointment_id) {
      await pool.execute("UPDATE appointments SET status='completed' WHERE id=?", [visit.appointment_id]);
    }
    req.flash('success', 'Visit marked complete.');
    res.redirect('/doctor');
  } catch (err) { next(err); }
});

module.exports = router;