// One-off: dump first 3 raw attendance records to see actual field names
const ZKLib = require('node-zklib');
require('dotenv').config();

(async () => {
  const zk = new ZKLib(process.env.DEVICE_IP_UTH, Number(process.env.DEVICE_PORT) || 4370, 10000, 4000);
  try {
    await zk.createSocket();
    const result = await zk.getAttendances();
    const records = result?.data || result || [];
    console.log(`Total records: ${records.length}`);
    console.log('First 3 raw records:');
    records.slice(0, 3).forEach((r, i) => console.log(`[${i}]`, JSON.stringify(r)));
  } finally {
    await zk.disconnect().catch(() => {});
  }
})().catch(e => console.error('❌', e.message));
