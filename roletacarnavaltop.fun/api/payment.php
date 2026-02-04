<?php
// AbacatePay billing link creation endpoint
// Expects POST with at least "amount" (in BRL, e.g. "20,00" or 20).
// Returns: { success, transactionId, paymentUrl, url }
//
// Set the token in your server environment:
//   ABACATEPAY_TOKEN=abc_xxx

header('Content-Type: application/json');

require_once __DIR__ . '/db.php';

function respond($code, $payload) {
    http_response_code($code);
    echo json_encode($payload);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, ['error' => 'Method not allowed']);
}

$contentType = $_SERVER['CONTENT_TYPE'] ?? '';
$rawBody = file_get_contents('php://input') ?: '';
$input = [];

if (stripos($contentType, 'application/json') !== false && trim($rawBody) !== '') {
    $input = json_decode($rawBody, true);
    if (!is_array($input)) {
        respond(400, ['error' => 'Invalid JSON']);
    }
} else {
    $input = $_POST;
    if (!$input && trim($rawBody) !== '') {
        parse_str($rawBody, $input);
    }
}

function parse_amount_to_cents($value) {
    if ($value === null || $value === '') return null;
    if (is_int($value)) return $value * 100; // treat as BRL if integer
    if (is_float($value)) return (int) round($value * 100);
    $clean = preg_replace('/[^\d,]/', '', (string) $value);
    if ($clean === '') return null;
    $numeric = floatval(str_replace(',', '.', $clean));
    return (int) round($numeric * 100);
}

$amountRaw = $input['amount'] ?? null;
$amountCents = parse_amount_to_cents($amountRaw);
if ($amountCents === null || $amountCents < 2000) {
    respond(400, ['error' => 'Valor minimo e R$ 20,00']);
}

$token = getenv('ABACATEPAY_TOKEN');
if (!$token) {
    respond(500, ['error' => 'Missing ABACATEPAY_TOKEN']);
}

// Build return/completion URL from input, env or request
$returnUrl = $input['returnUrl'] ?? getenv('APP_RETURN_URL') ?: '';
$completionUrl = $input['completionUrl'] ?? getenv('APP_COMPLETION_URL') ?: '';
if (!$returnUrl || !$completionUrl) {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $referer = $_SERVER['HTTP_REFERER'] ?? '';
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? '';
    $fallbackBase = $host ? ($scheme . '://' . $host . '/') : '';

    if (!$returnUrl) {
        $returnUrl = $origin ?: ($referer ?: $fallbackBase);
    }
    if (!$completionUrl) {
        $completionUrl = $origin ?: ($referer ?: $fallbackBase);
    }
}

$name = $input['nome'] ?? $input['name'] ?? $input['nome_completo'] ?? '';
$email = $input['email'] ?? '';
$cellphone = $input['telefone'] ?? $input['phone'] ?? '';
$taxId = $input['cpf'] ?? $input['taxId'] ?? '';
$customerId = $input['customerId'] ?? null;

$externalId = 'dep_' . time() . '_' . random_int(1000, 9999);

$payload = [
    'frequency' => 'ONE_TIME',
    'methods' => ['PIX'],
    'products' => [[
        'externalId' => 'deposit-button',
        'name' => 'Deposito',
        'description' => 'Deposito',
        'quantity' => 1,
        'price' => $amountCents
    ]],
    'returnUrl' => $returnUrl,
    'completionUrl' => $completionUrl,
    'allowCoupons' => false,
    'externalId' => $externalId,
    'metadata' => [
        'externalId' => $externalId
    ]
];

if ($customerId) {
    $payload['customerId'] = $customerId;
} else {
    $payload['customer'] = [
        'name' => $name ?: 'Cliente',
        'cellphone' => $cellphone ?: '(11) 99999-9999',
        'email' => $email ?: 'cliente@exemplo.com',
        'taxId' => $taxId ?: '123.456.789-01'
    ];
}

$ch = curl_init('https://api.abacatepay.com/v1/billing/create');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer ' . $token,
        'Content-Type: application/json'
    ],
    CURLOPT_POSTFIELDS => json_encode($payload),
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 30
]);

$response = curl_exec($ch);
$curlError = curl_error($ch);
$http = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($response === false) {
    respond(502, ['error' => 'Gateway error', 'detail' => $curlError]);
}

$data = json_decode($response, true);
if (!is_array($data)) {
    respond(502, ['error' => 'Invalid gateway response', 'raw' => $response]);
}

if ($http < 200 || $http >= 300) {
    respond(502, ['error' => 'Gateway request failed', 'status' => $http, 'data' => $data]);
}

$billing = $data['data'] ?? [];
$paymentUrl = $billing['url'] ?? null;
if (!$paymentUrl) {
    respond(502, ['error' => 'Payment URL not found', 'data' => $data]);
}

// Save deposit record to DB
try {
    $pdo = db();
    $stmt = $pdo->prepare(
        'INSERT INTO deposits (transaction_id, external_id, amount_cents, status, payment_url, provider, created_at, updated_at)
         VALUES (:transaction_id, :external_id, :amount_cents, :status, :payment_url, :provider, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           amount_cents = VALUES(amount_cents),
           status = VALUES(status),
           payment_url = VALUES(payment_url),
           updated_at = NOW()'
    );
    $stmt->execute([
        ':transaction_id' => $billing['id'] ?? '',
        ':external_id' => $externalId,
        ':amount_cents' => $billing['amount'] ?? $amountCents,
        ':status' => $billing['status'] ?? 'PENDING',
        ':payment_url' => $paymentUrl,
        ':provider' => 'abacatepay'
    ]);
} catch (Throwable $e) {
    respond(500, ['error' => 'DB error', 'detail' => $e->getMessage()]);
}

// Optional: log created transaction (for debugging)
$logLine = sprintf("%s\t%s\t%s\n", date('c'), $billing['id'] ?? 'UNKNOWN', $paymentUrl);
@file_put_contents(__DIR__ . '/abacatepay_billing.log', $logLine, FILE_APPEND);

respond(200, [
    'success' => true,
    'transactionId' => $billing['id'] ?? null,
    'paymentUrl' => $paymentUrl,
    'url' => $paymentUrl,
    'data' => $billing
]);
