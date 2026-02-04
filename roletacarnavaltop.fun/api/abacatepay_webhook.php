<?php
// AbacatePay webhook endpoint (PIX / billing status updates)
// Configure the webhook URL in AbacatePay to point to this file.
// Optional: set ABACATEPAY_WEBHOOK_SECRET in your server environment to enable signature verification.

header('Content-Type: application/json');

require_once __DIR__ . '/db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$rawBody = file_get_contents('php://input');
if ($rawBody === false || trim($rawBody) === '') {
    http_response_code(400);
    echo json_encode(['error' => 'Empty body']);
    exit;
}

// Optional signature verification (adjust header name if AbacatePay uses a different one)
// AbacatePay webhook validation:
// 1) Query param "webhookSecret" must match ABACATEPAY_WEBHOOK_SECRET
// 2) Header "X-Webhook-Signature" must be HMAC-SHA256 of raw body using ABACATEPAY_PUBLIC_KEY, base64-encoded
$secret = getenv('ABACATEPAY_WEBHOOK_SECRET');
$publicKey = getenv('ABACATEPAY_PUBLIC_KEY');
$receivedSecret = $_GET['webhookSecret'] ?? '';
$signature = $_SERVER['HTTP_X_WEBHOOK_SIGNATURE'] ?? '';

if (!$secret || !$publicKey) {
    http_response_code(500);
    echo json_encode(['error' => 'Missing ABACATEPAY_WEBHOOK_SECRET or ABACATEPAY_PUBLIC_KEY']);
    exit;
}

if ($receivedSecret !== $secret) {
    http_response_code(401);
    echo json_encode(['error' => 'Invalid webhook secret']);
    exit;
}

$expectedSig = base64_encode(hash_hmac('sha256', $rawBody, $publicKey, true));
if (!$signature || !hash_equals($expectedSig, $signature)) {
    http_response_code(401);
    echo json_encode(['error' => 'Invalid signature']);
    exit;
}

$payload = json_decode($rawBody, true);
if (!is_array($payload)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON']);
    exit;
}

// Try to extract common fields
$eventId = $payload['id'] ?? null;
$eventType = $payload['event'] ?? null;
$data = $payload['data'] ?? [];

// AbacatePay billing events structure
$billing = $data['billing'] ?? [];
$pixQrCode = $data['pixQrCode'] ?? [];
$payment = $data['payment'] ?? [];

$transactionId = $billing['id'] ?? $pixQrCode['id'] ?? ($data['id'] ?? null);
$status = $billing['status'] ?? $pixQrCode['status'] ?? ($data['status'] ?? null);
$amount = $billing['paidAmount'] ?? $billing['amount'] ?? $pixQrCode['amount'] ?? $payment['amount'] ?? ($data['amount'] ?? null);
$method = $payment['method'] ?? ($data['method'] ?? ($data['methods'][0] ?? null));

try {
    $pdo = db();

    if ($eventId) {
        $stmt = $pdo->prepare(
            'INSERT INTO webhook_events (event_id, event_type, received_at, payload_text)
             VALUES (:event_id, :event_type, NOW(), :payload)
             ON DUPLICATE KEY UPDATE received_at = NOW()'
        );
        $stmt->execute([
            ':event_id' => $eventId,
            ':event_type' => $eventType ?: 'unknown',
            ':payload' => $rawBody
        ]);
    }

    if ($transactionId && $status) {
        $stmt = $pdo->prepare(
            'UPDATE deposits
             SET status = :status,
                 amount_cents = COALESCE(:amount_cents, amount_cents),
                 updated_at = NOW()
             WHERE transaction_id = :transaction_id'
        );
        $stmt->execute([
            ':status' => $status,
            ':amount_cents' => is_numeric($amount) ? (int) $amount : null,
            ':transaction_id' => $transactionId
        ]);
    }
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'DB error', 'detail' => $e->getMessage()]);
    exit;
}

// Log simples para auditoria (opcional)
$logLine = sprintf(
    "%s\t%s\t%s\t%s\n",
    date('c'),
    $status ?: 'UNKNOWN',
    $transactionId ?: 'UNKNOWN',
    $method ?: 'UNKNOWN'
);
@file_put_contents(__DIR__ . '/abacatepay_webhook.log', $logLine, FILE_APPEND);

echo json_encode([
    'received' => true,
    'transactionId' => $transactionId,
    'status' => $status
]);
