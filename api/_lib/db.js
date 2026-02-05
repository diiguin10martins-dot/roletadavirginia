const mysql = require('mysql2/promise');

let pool;
let schemaReady = false;

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

  const dsn = (process.env.DB_DSN || '').trim();
  if (!dsn) {
    throw new Error('Missing DB_DSN');
  }

  const caFromEnv = process.env.DB_CA_CERT || '';
  const caFromBase64 = process.env.DB_CA_CERT_BASE64 || '';
  const forceInsecure = String(process.env.DB_SSL_INSECURE || '').trim().toLowerCase() === 'true';
  let ssl;
  if (forceInsecure) {
    ssl = { rejectUnauthorized: false };
  } else if (caFromBase64) {
    ssl = { ca: Buffer.from(caFromBase64, 'base64').toString('utf8'), rejectUnauthorized: true };
  } else if (caFromEnv) {
    ssl = { ca: caFromEnv.replace(/\\n/g, '\n'), rejectUnauthorized: true };
  } else {
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
      user: (process.env.DB_USER || '').trim(),
      password: (process.env.DB_PASS || '').trim(),
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

async function ensureSchema() {
  if (schemaReady) return;
  const p = getPool();
  await p.execute(
    `CREATE TABLE IF NOT EXISTS deposits (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      transaction_id VARCHAR(64) NOT NULL,
      external_id VARCHAR(64) NOT NULL,
      amount_cents INT NOT NULL,
      status VARCHAR(20) NOT NULL,
      payment_url TEXT,
      provider VARCHAR(32) NOT NULL DEFAULT 'abacatepay',
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_transaction_id (transaction_id),
      UNIQUE KEY uniq_external_id (external_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  );
  await p.execute(
    `CREATE TABLE IF NOT EXISTS webhook_events (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      event_id VARCHAR(64) NOT NULL,
      event_type VARCHAR(64) NOT NULL,
      received_at DATETIME NOT NULL,
      payload_text LONGTEXT NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_event_id (event_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  );
  schemaReady = true;
}

module.exports = { getPool, ensureSchema };
