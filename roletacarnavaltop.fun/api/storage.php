<?php
// Simple file-based storage for deposits (minimal structure for local/dev)

function storage_path() {
    $dir = __DIR__ . '/data';
    if (!is_dir($dir)) {
        @mkdir($dir, 0777, true);
    }
    return $dir . '/deposits.json';
}

function load_deposits() {
    $path = storage_path();
    if (!file_exists($path)) {
        return [];
    }
    $raw = file_get_contents($path);
    if ($raw === false || trim($raw) === '') {
        return [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function save_deposits($deposits) {
    $path = storage_path();
    $json = json_encode($deposits, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    file_put_contents($path, $json, LOCK_EX);
}

function upsert_deposit($deposit) {
    $deposits = load_deposits();
    $id = $deposit['transactionId'] ?? null;
    if (!$id) {
        return;
    }
    $found = false;
    foreach ($deposits as &$row) {
        if (($row['transactionId'] ?? null) === $id) {
            $row = array_merge($row, $deposit);
            $found = true;
            break;
        }
    }
    unset($row);
    if (!$found) {
        $deposits[] = $deposit;
    }
    save_deposits($deposits);
}

function update_deposit_status($transactionId, $status, $amountCents = null) {
    $deposits = load_deposits();
    $found = false;
    foreach ($deposits as &$row) {
        if (($row['transactionId'] ?? null) === $transactionId) {
            $row['status'] = $status;
            if ($amountCents !== null) {
                $row['amountCents'] = $amountCents;
            }
            $row['updatedAt'] = date('c');
            $found = true;
            break;
        }
    }
    unset($row);
    if (!$found) {
        $deposits[] = [
            'transactionId' => $transactionId,
            'status' => $status,
            'amountCents' => $amountCents,
            'createdAt' => date('c'),
            'updatedAt' => date('c')
        ];
    }
    save_deposits($deposits);
}
