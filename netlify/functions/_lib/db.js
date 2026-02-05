const mysql = require('mysql2/promise');

let pool;

function parseMysqlDsn(dsn) {
  const raw = dsn.replace(/^mysql:/i, '');
  const parts = raw.split(';').filter(Boolean);
  const map = {};
  for (const part of parts) {
    const [key, ...rest] = part.split('=');
    if (!key) continue;
    map[key.trim()] = rest.join('=').trim();
  }
  return {
    host: map.host || '127.0.0.1',
    port: map.port ? Number(map.port) : 3306,
    database: map.dbname || map.database || '',
    charset: map.charset || 'utf8mb4',
  };
}

function getPool() {
  if (pool) return pool;

  const dsn = process.env.DB_DSN || '';
  if (!dsn) {
    throw new Error('Missing DB_DSN');
  }

  const caFromEnv = process.env.DB_CA_CERT || '';
  const caFromBase64 = process.env.DB_CA_CERT_BASE64 || '';
  let ssl;
  if (caFromBase64) {
    ssl = { ca: Buffer.from(caFromBase64, 'base64').toString('utf8'), rejectUnauthorized: true };
  } else if (caFromEnv) {
    ssl = { ca: caFromEnv.replace(/\\n/g, '\n'), rejectUnauthorized: true };
  } else {
    // Last resort (dev only): allow self-signed certs
    ssl = { rejectUnauthorized: false };
  }

  let config;
  if (/^mysql:\/\//i.test(dsn)) {
    config = { uri: dsn };
  } else if (/^mysql:/i.test(dsn)) {
    const parsed = parseMysqlDsn(dsn);
    config = {
      host: parsed.host,
      port: parsed.port,
      database: parsed.database,
      charset: parsed.charset,
      user: process.env.DB_USER || '',
      password: process.env.DB_PASS || '',
    };
  } else {
    throw new Error('Unsupported DB_DSN format. Use mysql:... or mysql://...');
  }

  if (ssl) {
    config.ssl = ssl;
  }

  pool = mysql.createPool({
    ...config,
    waitForConnections: true,
    connectionLimit: 3,
    queueLimit: 0,
  });

  return pool;
}

module.exports = { getPool };
