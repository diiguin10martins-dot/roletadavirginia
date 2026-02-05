const { getPool, ensureSchema } = require('./_lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { transactionId = null, externalId = null, limit } = req.query || {};
  const safeLimit = Math.max(1, Math.min(100, Number(limit || 50)));

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
      res.status(200).json({ success: true, data: rows[0] || null });
      return;
    }

    const [rows] = await pool.execute(
      `SELECT transaction_id, external_id, amount_cents, status, payment_url, provider, created_at, updated_at
       FROM deposits
       ORDER BY id DESC
       LIMIT ${safeLimit}`
    );
    res.status(200).json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
