<?php
// PDO connection helper (MySQL/PostgreSQL via DSN)
// Required env vars:
//   DB_DSN  (e.g. mysql:host=127.0.0.1;dbname=roleta;charset=utf8mb4)
//   DB_USER
//   DB_PASS

function db() {
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $dsn = getenv('DB_DSN');
    $user = getenv('DB_USER');
    $pass = getenv('DB_PASS');

    if (!$dsn) {
        throw new RuntimeException('Missing DB_DSN');
    }

    $options = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ];

    $pdo = new PDO($dsn, $user, $pass, $options);
    return $pdo;
}
