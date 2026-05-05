const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), override: true });
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:               process.env.DB_HOST,
  port:               parseInt(process.env.DB_PORT || '3306', 10),
  user:               process.env.DB_USER,
  password:           process.env.DB_PASSWORD,
  database:           process.env.DB_NAME,
  timezone:           '+08:00',
  waitForConnections: true,
  connectionLimit:    20,
  queueLimit:         0,
  enableKeepAlive:    true,
  keepAliveInitialDelay: 0,
});

pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+08:00'");
});

async function queryWithRetry(sql, params = [], retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await pool.query(sql, params);
    } catch (err) {
      const retryable = ['ECONNRESET', 'PROTOCOL_CONNECTION_LOST', 'ECONNREFUSED', 'ER_CON_COUNT_ERROR'];
      if (retryable.includes(err.code) && i < retries - 1) {
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      } else throw err;
    }
  }
}

module.exports = { pool, queryWithRetry };
