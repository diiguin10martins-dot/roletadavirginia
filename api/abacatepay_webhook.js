const { getPool, ensureSchema } = require('./_lib/db');

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const rawBody = await readBody(req);
  if (!rawBody) {
    res.status(400).json({ error: 'Empty body' });
    return;
  }

  const secret = (process.env.ABACATEPAY_WEBHOOK_SECRET || '').trim();
  const receivedSecret = (req.query && req.query.webhookSecret) || '';

  if (!secret) {
    res.status(500).json({ error: 'Missing webhook secret' });
    return;
  }

  if (receivedSecret !== secret) {
    res.status(401).json({ error: 'Invalid webhook secret' });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  const eventId = payload.id || null;
  const eventType = payload.event || 'unknown';
  const data = payload.data || {};

  const billing = data.billing || {};
  const pixQrCode = data.pixQrCode || {};
  const payment = data.payment || {};

  const transactionId = billing.id || pixQrCode.id || data.id || null;
  const status = billing.status || pixQrCode.status || data.status || null;
  const amount =
    billing.paidAmount ||
    billing.amount ||
    pixQrCode.amount ||
    payment.amount ||
    data.amount ||
    null;

  try {
    const pool = getPool();
    await ensureSchema();

    if (eventId) {
      await pool.execute(
        `INSERT INTO webhook_events (event_id, event_type, received_at, payload_text)
         VALUES (?, ?, NOW(), ?)
         ON DUPLICATE KEY UPDATE received_at = NOW()`,
        [eventId, eventType, rawBody]
      );
    }

    if (transactionId && status) {
      await pool.execute(
        `UPDATE deposits
         SET status = ?,
             amount_cents = COALESCE(?, amount_cents),
             updated_at = NOW()
         WHERE transaction_id = ?`,
        [status, Number.isFinite(Number(amount)) ? Number(amount) : null, transactionId]
      );
    }
  } catch (err) {
    res.status(500).json({ error: 'DB error', detail: err.message });
    return;
  }

  res.status(200).json({ received: true, transactionId, status });
};
