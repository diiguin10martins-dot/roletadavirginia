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

async function parseBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  const raw = await readBody(req);
  if (!raw) return {};
  const contentType = (req.headers['content-type'] || '').toLowerCase();
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

function buildReturnUrl(req, fallback) {
  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  if (origin) return origin;
  if (referer) return referer;
  const host = req.headers.host || '';
  if (host) return `https://${host}/`;
  return fallback || '';
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let input;
  try {
    input = await parseBody(req);
  } catch {
    res.status(400).json({ error: 'Invalid body' });
    return;
  }

  const amountCents = parseAmountToCents(input.amount);
  if (!amountCents || amountCents < 2000) {
    res.status(400).json({ error: 'Valor minimo e R$ 20,00' });
    return;
  }

  const token = (process.env.ABACATEPAY_TOKEN || '').trim();
  if (!token) {
    res.status(500).json({ error: 'Missing ABACATEPAY_TOKEN' });
    return;
  }

  const returnUrl = input.returnUrl || (process.env.APP_RETURN_URL || '').trim() || buildReturnUrl(req, '');
  const completionUrl = input.completionUrl || (process.env.APP_COMPLETION_URL || '').trim() || buildReturnUrl(req, '');

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
  } catch {
    res.status(502).json({ error: 'Gateway error' });
    return;
  }

  let data = null;
  try {
    data = await response.json();
  } catch {}

  if (!response.ok || !data || !data.data) {
    res.status(502).json({ error: 'Gateway request failed', status: response.status, data });
    return;
  }

  const billing = data.data;
  const paymentUrl = billing.url;
  if (!paymentUrl) {
    res.status(502).json({ error: 'Payment URL not found', data });
    return;
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
    res.status(500).json({ error: 'DB error', detail: err.message });
    return;
  }

  res.status(200).json({
    success: true,
    transactionId: billing.id || null,
    paymentUrl,
    url: paymentUrl,
    data: billing,
  });
};
