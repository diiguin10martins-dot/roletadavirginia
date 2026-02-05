const { getPool, ensureSchema } = require('./_lib/db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const qs = event.queryStringParameters || {};
  const transactionId = qs.transactionId || null;
  const externalId = qs.externalId || null;
  const limit = Math.max(1, Math.min(100, Number(qs.limit || 50)));

  try {
    const pool = getPool();
    await ensureSchema();

    if (transactionId || externalId) {
      const [rows] = await pool.execute(
        `SELECT transaction_id, external_id, amount_cents, status, payment_url, provider, created_at, updated_at
         FROM deposits
         WHERE transaction_id = ? OR external_id = ?
         LIMIT 1`,
        [transactionId || '', externalId || '']
      );
      return { statusCode: 200, body: JSON.stringify({ success: true, data: rows[0] || null }) };
    }

    const [rows] = await pool.execute(
      `SELECT transaction_id, external_id, amount_cents, status, payment_url, provider, created_at, updated_at
       FROM deposits
       ORDER BY id DESC
       LIMIT ?`,
      [limit]
    );
    return { statusCode: 200, body: JSON.stringify({ success: true, data: rows }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
