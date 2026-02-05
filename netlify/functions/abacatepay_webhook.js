const crypto = require('crypto');
const { getPool, ensureSchema } = require('./_lib/db');

function decodeBody(event) {
  if (!event.body) return '';
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, 'base64').toString('utf8');
  }
  return event.body;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const rawBody = decodeBody(event);
  if (!rawBody) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Empty body' }) };
  }

  const secret = process.env.ABACATEPAY_WEBHOOK_SECRET;
  const receivedSecret = (event.queryStringParameters || {}).webhookSecret || '';

  if (!secret) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing webhook secrets' }) };
  }

  if (receivedSecret !== secret) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid webhook secret' }) };
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
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
    return { statusCode: 500, body: JSON.stringify({ error: 'DB error', detail: err.message }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ received: true, transactionId, status }),
  };
};
