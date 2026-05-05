// Idempotent seed for departments, subdepartments, and positions (per company).
// Run after migrations: node scripts/seed-positions.js
// Safe to re-run; uses INSERT IGNORE on unique constraints.

require('../src/config/env');
const { queryWithRetry, pool } = require('../src/config/db');

const HIERARCHY = [
  {
    department: 'ADMINISTRATION',
    subdepts: [
      { name: 'GM Office',              positions: ['Vice President'] },
      { name: 'Finance & Accounting',   positions: ['Finance & Accounting Head', 'Accounting Assistant', 'Cashier Head'] },
      { name: 'Management',             positions: ['Senior Duty Officer', 'Duty Officer'] },
      { name: 'Human Resources',        positions: ['HR Head', 'HR Assistant', 'Company Nurse/HR Staff'] },
      { name: 'Sales & Marketing',      positions: ['Sales & Marketing Head', 'Marketing/Reservation Clerk', 'Graphic Artist'] },
      { name: 'Food & Beverage',        positions: ['Food & Beverage Coordinator'] },
      { name: 'Information Technology', positions: ['System & Network Officer', 'Intern'] },
      { name: 'Logistics',              positions: ['Stockman'] },
    ],
  },
  {
    department: 'OPERATIONS',
    subdepts: [
      { name: 'Front Office',  positions: ['Front Desk Attendant', 'Front Desk Butler', 'Telecom Operator/Cashier'] },
      { name: 'Food & Beverage', positions: ['Waiter'] },
      { name: 'Kitchen',       positions: ['Assistant Chief Cook', 'Cook', 'Kitchen Helper'] },
      { name: 'Housekeeping',  positions: ['Leadman', 'Room Attendant'] },
      { name: 'Maintenance',   positions: ['Maintenance Head', 'Maintenance Man', 'Maintenance Assistant', 'Aircon Technician'] },
      { name: 'Services',      positions: ['Company Driver'] },
      { name: 'Security',      positions: ['Security Guard'] },
    ],
  },
];

async function seedForCompany(companyId) {
  for (const { department, subdepts } of HIERARCHY) {
    await queryWithRetry(
      `INSERT IGNORE INTO tbl_department (company_id, department_name, is_active, created_at)
       VALUES (?, ?, TRUE, NOW())`,
      [companyId, department]
    );

    const [[deptRow]] = await queryWithRetry(
      `SELECT department_id FROM tbl_department WHERE company_id = ? AND department_name = ?`,
      [companyId, department]
    );
    const deptId = deptRow.department_id;

    for (const { name: subdeptName, positions } of subdepts) {
      await queryWithRetry(
        `INSERT IGNORE INTO tbl_subdepartment (department_id, company_id, subdepartment_name, is_active, created_at)
         VALUES (?, ?, ?, TRUE, NOW())`,
        [deptId, companyId, subdeptName]
      );

      const [[subdeptRow]] = await queryWithRetry(
        `SELECT subdepartment_id FROM tbl_subdepartment WHERE department_id = ? AND subdepartment_name = ?`,
        [deptId, subdeptName]
      );
      const subdeptId = subdeptRow.subdepartment_id;

      for (const positionName of positions) {
        await queryWithRetry(
          `INSERT IGNORE INTO tbl_position (subdepartment_id, position_name, is_active, created_at)
           VALUES (?, ?, TRUE, NOW())`,
          [subdeptId, positionName]
        );
      }
    }

    console.log(`  ✅ ${department} seeded`);
  }
}

async function main() {
  console.log('📋 Seeding departments, subdepartments, and positions...\n');

  const [companies] = await queryWithRetry(`SELECT company_id, company_name FROM tbl_company WHERE is_active = TRUE`);

  if (!companies.length) {
    console.error('❌ No active companies found. Run bootstrap-user.js first.');
    process.exit(1);
  }

  for (const { company_id, company_name } of companies) {
    console.log(`🏨 ${company_name} (company_id=${company_id})`);
    await seedForCompany(company_id);
  }

  console.log('\n✅ Done.');
  pool.end();
}

main().catch(err => {
  console.error('❌', err.message);
  pool.end();
  process.exit(1);
});
