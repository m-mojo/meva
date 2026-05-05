// One-off admin script: recomputes C/In / C/Out for all raw logs in chronological order.
// Use after a direction engine bug fix or after TRUNCATE tbl_raw_device_logs + re-import.
// DOES NOT modify existing new_state values in place — it previews the correct direction
// and writes to a temporary column or runs in dry-run mode unless --apply is passed.
//
// Usage:
//   node scripts/recompute-direction.js              -- dry run (prints to console)
//   node scripts/recompute-direction.js --apply      -- writes corrected new_state to DB

require('../src/config/env');
const { queryWithRetry, pool } = require('../src/config/db');
const { resolveLogType }       = require('../src/device/direction');

const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(`🔢 Recompute direction — mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  // Clear direction state so algorithm starts fresh
  if (APPLY) {
    await queryWithRetry(`UPDATE tbl_raw_device_logs SET new_state = NULL, shift_date = NULL`);
    console.log('⚠️  Cleared new_state and shift_date on all rows');
  }

  const [devices] = await queryWithRetry(
    `SELECT d.device_id, d.serial_number, d.company_id FROM tbl_device d WHERE d.is_active = TRUE`
  );

  for (const device of devices) {
    console.log(`📡 Processing device: ${device.serial_number} (company_id=${device.company_id})`);

    const [logs] = await queryWithRetry(
      `SELECT log_id, device_user_id, record_time, state FROM tbl_raw_device_logs
       WHERE device_id = ? ORDER BY record_time ASC`,
      [device.device_id]
    );

    console.log(`   ${logs.length} logs to process`);

    let corrected = 0, skipped = 0;

    for (const log of logs) {
      const { direction, shiftDate } = await resolveLogType(
        log.device_user_id,
        log.record_time,
        device.company_id
      );

      if (direction === null) {
        if (APPLY) {
          // Remove duplicate — this log would be skipped in live sync
          await queryWithRetry(
            `UPDATE tbl_raw_device_logs SET new_state = 'SKIP', shift_date = NULL WHERE log_id = ?`,
            [log.log_id]
          );
        } else {
          console.log(`   ⚠️  Would skip duplicate: log_id=${log.log_id} device_user=${log.device_user_id}`);
        }
        skipped++;
        continue;
      }

      if (APPLY) {
        await queryWithRetry(
          `UPDATE tbl_raw_device_logs SET new_state = ?, shift_date = ? WHERE log_id = ?`,
          [direction, shiftDate, log.log_id]
        );
      } else {
        console.log(`   ${direction} — log_id=${log.log_id} user=${log.device_user_id} shift_date=${shiftDate}`);
      }
      corrected++;
    }

    console.log(`   ✅ corrected=${corrected} skipped(dup)=${skipped}\n`);
  }

  if (APPLY) {
    // Remove rows marked as SKIP (within-window duplicates)
    const [del] = await queryWithRetry(`DELETE FROM tbl_raw_device_logs WHERE new_state = 'SKIP'`);
    console.log(`🗑️  Removed ${del.affectedRows} duplicate-window rows`);
  }

  console.log('\n✅ Done');
  await pool.end();
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
