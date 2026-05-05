// Run ONCE after migrations: creates the first super_admin account
// Company rows (UTH/SSH) are seeded by migration 003 — this script skips that step.
// Usage: node scripts/bootstrap-user.js

require('../src/config/env');
const bcrypt = require('bcryptjs');
const { queryWithRetry, pool } = require('../src/config/db');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

async function main() {
  console.log('📋 MINERVA Bootstrap\n');

  // Seed device sync cursors from tbl_device rows
  const [devices] = await queryWithRetry(
    `SELECT serial_number FROM tbl_device WHERE serial_number NOT IN (SELECT serial_number FROM tbl_device_sync)`
  );
  for (const d of devices) {
    await queryWithRetry(
      `INSERT INTO tbl_device_sync (serial_number, last_stamp) VALUES (?, 0)`,
      [d.serial_number]
    );
  }
  if (devices.length) console.log(`✅ Sync cursors seeded for ${devices.length} device(s)`);

  // Create super_admin
  const [admins] = await queryWithRetry(
    `SELECT COUNT(*) AS cnt FROM tbl_user_account WHERE role = 'super_admin' AND is_active = TRUE`
  );
  if (admins[0].cnt > 0) {
    console.log('ℹ️  Super admin already exists — skipping user creation');
    rl.close();
    await pool.end();
    return;
  }

  const username = await ask('Super admin username: ');
  const password = await ask('Super admin password: ');
  const companyId = await ask('Company ID (1=UTH, 2=SSH, or leave blank for both): ');

  if (!username || !password) {
    console.error('❌ Username and password required');
    rl.close();
    await pool.end();
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  const [result] = await queryWithRetry(
    `INSERT INTO tbl_user_account
       (username, password_hash, role, company_id, is_active, is_bootstrap, created_at)
     VALUES (?, ?, 'super_admin', ?, TRUE, FALSE, NOW())`,
    [username, hash, companyId ? parseInt(companyId, 10) : null]
  );

  console.log(`\n✅ Super admin created — user_id=${result.insertId}`);
  console.log('📋 Ensure migrations 001 → 002 → 003 → 004 → 005 → 006 → 007 have been applied before starting the server');

  rl.close();
  await pool.end();
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
