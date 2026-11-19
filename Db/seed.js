require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('../src/db');

async function upsertStaff(fullName, email, password, role) {
  const hash = await bcrypt.hash(password, 12);
  await pool.execute(
    `INSERT INTO users (full_name, email, password_hash, role)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), password_hash = VALUES(password_hash), role = VALUES(role)`,
    [fullName, email, hash, role]
  );
  console.log(`Seeded ${role}: ${email}`);
}

(async () => {
  try {
    await upsertStaff('Front Desk Demo', 'frontdesk@im-hospital.local', 'FrontDesk#2024', 'frontdesk');
    await upsertStaff('Dr. Ada Mensah', 'doctor@im-hospital.local', 'Doctor#2024', 'doctor');
    await upsertStaff('Pharmacy Demo', 'pharmacy@im-hospital.local', 'Pharmacy#2024', 'pharmacy');

    const meds = [
      ['Paracetamol 500mg', 'tablets', 250, '2027-06-30', 40],
      ['Amoxicillin 500mg', 'capsules', 120, '2026-12-31', 30],
      ['Ibuprofen 400mg', 'tablets', 80, '2026-03-31', 30],
      ['Salbutamol Inhaler', 'inhalers', 15, '2026-09-30', 10],
      ['Oral Rehydration Salts', 'sachets', 8, '2025-12-31', 20],
    ];
    for (const m of meds) {
      await pool.execute(
        `INSERT INTO medicines (name, unit, stock_quantity, expiry_date, low_stock_threshold)
         SELECT ?, ?, ?, ?, ? FROM DUAL
         WHERE NOT EXISTS (SELECT 1 FROM medicines WHERE name = ?)`,
        [...m, m[0]]
      );
    }
    console.log('Medicines seeded.');
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  }
})();