// One-off: seed tbl_device_adapter + tbl_device + tbl_device_sync + tbl_punch_config
// The physical device (KMY2260500024) is shared between UTH and SSH.
// One device row is enough — reconciliation resolves each punch to the correct company.
// Run once: node scripts/seed-device.js
const { queryWithRetry } = require('../src/config/db');

async function run() {
  // 1. Insert adapter if not already present
  const [existingAdapter] = await queryWithRetry(
    `SELECT adapter_id FROM tbl_device_adapter WHERE adapter_key = 'zkteco_uf100' LIMIT 1`
  );
  let adapterId;
  if (existingAdapter.length) {
    adapterId = existingAdapter[0].adapter_id;
    console.log(`📋 Adapter already exists (adapter_id=${adapterId})`);
  } else {
    const [result] = await queryWithRetry(
      `INSERT INTO tbl_device_adapter (adapter_name, adapter_key, protocol, notes)
       VALUES ('ZKTeco UF100', 'zkteco_uf100', 'tcp_ip', 'ZKLib TCP; node-zklib')`
    );
    adapterId = result.insertId;
    console.log(`✅ Inserted adapter (adapter_id=${adapterId})`);
  }

  // 2. Insert UTH device if not already present
  const [existingDevice] = await queryWithRetry(
    `SELECT device_id FROM tbl_device WHERE serial_number = 'KMY2260500024' LIMIT 1`
  );
  let deviceId;
  if (existingDevice.length) {
    deviceId = existingDevice[0].device_id;
    console.log(`📋 UTH device already exists (device_id=${deviceId})`);
  } else {
    const [result] = await queryWithRetry(
      `INSERT INTO tbl_device
         (company_id, adapter_id, device_code, device_name, device_type, location,
          ip_address, serial_number, sync_interval, status, is_active)
       VALUES (1, ?, 'UTH-BIO-01', 'UTH Biometric Device', 'ZKTeco UF100',
               'UTH Main Entrance', '192.168.1.110', 'KMY2260500024', 10, 'online', TRUE)`,
      [adapterId]
    );
    deviceId = result.insertId;
    console.log(`✅ Inserted UTH device (device_id=${deviceId})`);
  }

  // 3. Seed sync cursor row if not present
  const [existingSync] = await queryWithRetry(
    `SELECT sync_state_id FROM tbl_device_sync WHERE serial_number = 'KMY2260500024' LIMIT 1`
  );
  if (existingSync.length) {
    console.log(`📋 Sync cursor already exists`);
  } else {
    await queryWithRetry(
      `INSERT INTO tbl_device_sync (device_id, serial_number, last_stamp)
       VALUES (?, 'KMY2260500024', 0)`,
      [deviceId]
    );
    console.log(`✅ Inserted sync cursor (last_stamp=0)`);
  }

  // 4. Seed tbl_punch_config for both companies (safe defaults)
  for (const companyId of [1, 2]) {
    const [existing] = await queryWithRetry(
      `SELECT company_id FROM tbl_punch_config WHERE company_id = ? LIMIT 1`,
      [companyId]
    );
    if (existing.length) {
      console.log(`📋 punch_config already exists for company_id=${companyId}`);
    } else {
      await queryWithRetry(
        `INSERT INTO tbl_punch_config
           (company_id, duplicate_punch_window_seconds, punch_reset_hours)
         VALUES (?, 60, 14)`,
        [companyId]
      );
      console.log(`✅ Inserted punch_config for company_id=${companyId} (60s window, 14h reset)`);
    }
  }

  console.log('Done. Restart the server to begin syncing.');
  process.exit(0);
}

run().catch(err => { console.error('❌', err.message); process.exit(1); });
