<?php
// List deposits or fetch by transactionId/externalId

header('Content-Type: application/json');

require_once __DIR__ . '/db.php';

function respond($code, $payload) {
    http_response_code($code);
    echo json_encode($payload);
    exit;
}

try {
    $pdo = db();

    $transactionId = $_GET['transactionId'] ?? null;
    $externalId = $_GET['externalId'] ?? null;
    $limit = isset($_GET['limit']) ? max(1, min(100, (int) $_GET['limit'])) : 50;

    if ($transactionId || $externalId) {
        $stmt = $pdo->prepare(
            'SELECT transaction_id, external_id, amount_cents, status, payment_url, provider, created_at, updated_at
             FROM deposits
             WHERE transaction_id = :transaction_id OR external_id = :external_id
             LIMIT 1'
        );
        $stmt->execute([
            ':transaction_id' => $transactionId ?: '',
            ':external_id' => $externalId ?: ''
        ]);
        $row = $stmt->fetch();
        respond(200, ['success' => true, 'data' => $row]);
    }

    $stmt = $pdo->prepare(
        'SELECT transaction_id, external_id, amount_cents, status, payment_url, provider, created_at, updated_at
         FROM deposits
         ORDER BY id DESC
         LIMIT :limit'
    );
    $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $stmt->execute();
    $rows = $stmt->fetchAll();
    respond(200, ['success' => true, 'data' => $rows]);
} catch (Throwable $e) {
    respond(500, ['success' => false, 'error' => $e->getMessage()]);
}
