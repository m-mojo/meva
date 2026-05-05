const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), override: true });

const required = [
  'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME',
  'JWT_SECRET',
];

for (const key of required) {
  if (!process.env[key]) throw new Error(`${key} is not set in .env`);
}

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  jwtSecret: process.env.JWT_SECRET,
  device: {
    port: parseInt(process.env.DEVICE_PORT || '4370', 10),
    uth: { ip: process.env.DEVICE_IP_UTH, serial: process.env.DEVICE_SERIAL_UTH },
    ssh: { ip: process.env.DEVICE_IP_SSH, serial: process.env.DEVICE_SERIAL_SSH },
  },
};
