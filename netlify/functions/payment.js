const { getPool, ensureSchema } = require('./_lib/db');

function parseAmountToCents(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') {
    return Math.round(value * 100);
  }
  const clean = String(value).replace(/[^\d,]/g, '');
  if (!clean) return null;
  const numeric = Number(clean.replace(',', '.'));
  if (Number.isNaN(numeric)) return null;
  return Math.round(numeric * 100);
}

function decodeBody(event) {
  if (!event.body) return '';
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, 'base64').toString('utf8');
  }
  return event.body;
}

function parseBody(event) {
  const raw = decodeBody(event);
  if (!raw) return {};
  const contentType = (event.headers['content-type'] || event.headers['Content-Type'] || '').toLowerCase();

  if (contentType.includes('application/json')) {
    return JSON.parse(raw);
  }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  try {
    return JSON.parse(raw);
  } catch {
    return Object.fromEntries(new URLSearchParams(raw));
  }
}

function buildReturnUrl(event, fallback) {
  const origin = event.headers.origin || event.headers.Origin || '';
  const referer = event.headers.referer || event.headers.Referer || '';
  if (origin) return origin;
  if (referer) return referer;
  const host = event.headers.host || '';
  if (host) return `https://${host}/`;
  return fallback || '';
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  let input;
  try {
    input = parseBody(event);
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid body' }) };
  }

  const amountCents = parseAmountToCents(input.amount);
  if (!amountCents || amountCents < 2000) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Valor minimo e R$ 20,00' }) };
  }

  const token = process.env.ABACATEPAY_TOKEN;
  if (!token) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing ABACATEPAY_TOKEN' }) };
  }

  const returnUrl = input.returnUrl || process.env.APP_RETURN_URL || buildReturnUrl(event, '');
  const completionUrl = input.completionUrl || process.env.APP_COMPLETION_URL || buildReturnUrl(event, '');

  const externalId = `dep_${Date.now()}_${Math.floor(Math.random() * 9000 + 1000)}`;

  const payload = {
    frequency: 'ONE_TIME',
    methods: ['PIX'],
    products: [
      {
        externalId: 'deposit-button',
        name: 'Deposito',
        description: 'Deposito',
        quantity: 1,
        price: amountCents,
      },
    ],
    returnUrl,
    completionUrl,
    allowCoupons: false,
    externalId,
    metadata: { externalId },
  };

  const customerId = input.customerId;
  if (customerId) {
    payload.customerId = customerId;
  } else {
    payload.customer = {
      name: input.nome || input.name || input.nome_completo || 'Cliente',
      cellphone: input.telefone || input.phone || '(11) 99999-9999',
      email: input.email || 'cliente@exemplo.com',
      taxId: input.cpf || input.taxId || '123.456.789-01',
    };
  }

  let response;
  try {
    response = await fetch('https://api.abacatepay.com/v1/billing/create', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Gateway error' }) };
  }

  const data = await response.json().catch(() => null);
  if (!response.ok || !data || !data.data) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Gateway request failed', status: response.status, data }),
    };
  }

  const billing = data.data;
  const paymentUrl = billing.url;
  if (!paymentUrl) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Payment URL not found', data }) };
  }

  try {
    const pool = getPool();
    await ensureSchema();
    await pool.execute(
      `INSERT INTO deposits
       (transaction_id, external_id, amount_cents, status, payment_url, provider, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         amount_cents = VALUES(amount_cents),
         status = VALUES(status),
         payment_url = VALUES(payment_url),
         updated_at = NOW()`,
      [
        billing.id || '',
        externalId,
        billing.amount || amountCents,
        billing.status || 'PENDING',
        paymentUrl,
        'abacatepay',
      ]
    );
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'DB error', detail: err.message }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      transactionId: billing.id || null,
      paymentUrl,
      url: paymentUrl,
      data: billing,
    }),
  };
};
