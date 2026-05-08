// Seed tbl_cutoff_period for both companies (UTH=1, SSH=2)
// Philippine standard: Period 1 = 11th–25th, Period 2 = 26th–10th next month
// Seeds Jan 2026 – Jun 2026 cutoffs for both companies
// Safe to re-run (uses INSERT IGNORE on unique constraint)
// Run: node scripts/seed-cutoff.js

require('../src/config/env');
const { queryWithRetry, pool } = require('../src/config/db');

/* Generate all cutoff periods for a year range */
function generateCutoffs(startYear, startMonth, count) {
  const cutoffs = [];
  let year  = startYear;
  let month = startMonth; // 0-indexed

  for (let i = 0; i < count; i++) {
    /* Period A: 11th – 25th */
    const aStart = new Date(year, month, 11);
    const aEnd   = new Date(year, month, 25);
    cutoffs.push({
      label: `${aStart.toLocaleString('en-PH', { month: 'long' })} 11–25, ${year}`,
      start: fmt(aStart),
      end:   fmt(aEnd),
    });

    /* Period B: 26th – 10th of next month */
    const bStart  = new Date(year, month, 26);
    const bEndRaw = new Date(year, month + 1, 10);
    cutoffs.push({
      label: `${bStart.toLocaleString('en-PH', { month: 'long' })} 26 – ${bEndRaw.toLocaleString('en-PH', { month: 'long' })} 10, ${bEndRaw.getFullYear()}`,
      start: fmt(bStart),
      end:   fmt(bEndRaw),
    });

    month++;
    if (month > 11) { month = 0; year++; }
  }
  return cutoffs;
}

function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isActive(start, end) {
  const today = new Date();
  return new Date(start) <= today && today <= new Date(end);
}

async function run() {
  console.log('📋 Seeding tbl_cutoff_period...');

  /* Generate Jan 2026 – Jun 2026 (6 months = 12 cutoff pairs) */
  const cutoffs = generateCutoffs(2026, 0, 6); /* month 0 = January */

  const companies = [1, 2];
  let inserted = 0;
  let skipped  = 0;

  for (const companyId of companies) {
    for (const co of cutoffs) {
      try {
        const [res] = await queryWithRetry(
          `INSERT IGNORE INTO tbl_cutoff_period
             (company_id, cutoff_name, start_date, end_date, is_locked, is_closed, created_at)
           VALUES (?, ?, ?, ?, FALSE, FALSE, NOW())`,
          [companyId, co.label, co.start, co.end]
        );
        if (res.affectedRows > 0) {
          console.log(`  ✅ [company ${companyId}] ${co.label}`);
          inserted++;
        } else {
          skipped++;
        }
      } catch (err) {
        console.warn(`  ⚠️  [company ${companyId}] ${co.label} — ${err.message}`);
      }
    }
  }

  console.log(`\nDone. Inserted: ${inserted}, Skipped (already exist): ${skipped}`);
  await pool.end();
  process.exit(0);
}

run().catch(err => { console.error('❌', err.message); process.exit(1); });
