// Creates user accounts for all system users and links them to employee records.
// Run AFTER employees are inserted: node scripts/seed-users.js
// All accounts are created with a shared default password you set at the prompt.
// must_change_password = TRUE — each user will be forced to reset on first login.

require('../src/config/env');
const bcrypt = require('bcryptjs');
const { queryWithRetry, pool } = require('../src/config/db');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

// Map each employee to their system account.
// username = login credential (must be unique); matches tbl_user_account.username
// role     = super_admin | hr | coord | it | admin
// can_access_system_config = true for super_admin only
const USERS = [
  {
    employee_number: '1120924306',
    username: 'JINKIE',
    role: 'hr',
    company_id: 1,
    can_access_system_config: false,
  },
  {
    employee_number: '1120104108',
    username: 'BONG',
    role: 'coord',
    company_id: 1,
    can_access_system_config: false,
  },
  {
    employee_number: '11001071',
    username: 'MARK',
    role: 'it',
    company_id: 1,
    can_access_system_config: false,
  },
  {
    employee_number: '111111323',
    username: 'ANNIE',
    role: 'coord',
    company_id: 1,
    can_access_system_config: false,
  },
];

async function main() {
  console.log('📋 MINERVA — User Account Seeder\n');
  console.log('Users to create:');
  USERS.forEach(u => console.log(`  ${u.role.padEnd(12)} ${u.username}  (emp# ${u.employee_number})`));
  console.log();

  const defaultPassword = await ask('Default password for all accounts: ');
  if (!defaultPassword || defaultPassword.length < 8) {
    console.error('❌ Password must be at least 8 characters');
    rl.close();
    await pool.end();
    process.exit(1);
  }

  const confirm = await ask(`\nCreate ${USERS.length} accounts with this password? (yes/no): `);
  if (confirm.trim().toLowerCase() !== 'yes') {
    console.log('⚠️  Aborted');
    rl.close();
    await pool.end();
    return;
  }

  const hash = await bcrypt.hash(defaultPassword, 12);
  let created = 0;
  let skipped = 0;

  for (const u of USERS) {
    // Resolve employee_id
    const [empRows] = await queryWithRetry(
      `SELECT employee_id FROM tbl_employees WHERE employee_number = ? LIMIT 1`,
      [u.employee_number]
    );

    if (!empRows.length) {
      console.log(`⚠️  Skipped ${u.username} — employee# ${u.employee_number} not found in tbl_employees`);
      skipped++;
      continue;
    }

    const employeeId = empRows[0].employee_id;

    // Check if account already exists
    const [existing] = await queryWithRetry(
      `SELECT user_acc_id FROM tbl_user_account WHERE username = ? OR employee_id = ? LIMIT 1`,
      [u.username, employeeId]
    );

    if (existing.length) {
      console.log(`⚠️  Skipped ${u.username} — account already exists`);
      skipped++;
      continue;
    }

    await queryWithRetry(
      `INSERT INTO tbl_user_account
         (employee_id, username, password_hash, role, company_id, is_active,
          must_change_password, can_access_system_config, created_at)
       VALUES (?, ?, ?, ?, ?, TRUE, TRUE, ?, NOW())`,
      [employeeId, u.username, hash, u.role, u.company_id, u.can_access_system_config]
    );

    console.log(`✅ Created  ${u.role.padEnd(12)} ${u.username}`);
    created++;
  }

  console.log(`\n📋 Done — ${created} created, ${skipped} skipped`);
  console.log('📋 All accounts have must_change_password = TRUE');
  console.log('📋 Users must reset their password on first login');

  rl.close();
  await pool.end();
}

main().catch(err => {
  console.error('❌', err.message);
  rl.close();
  process.exit(1);
});