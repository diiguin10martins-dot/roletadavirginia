-- Minimal MySQL schema for deposits + webhook events

CREATE TABLE IF NOT EXISTS deposits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  transaction_id VARCHAR(64) NOT NULL,
  external_id VARCHAR(64) NOT NULL,
  amount_cents INT NOT NULL,
  status VARCHAR(20) NOT NULL,
  payment_url TEXT,
  provider VARCHAR(32) NOT NULL DEFAULT 'abacatepay',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_transaction_id (transaction_id),
  UNIQUE KEY uniq_external_id (external_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS webhook_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  received_at DATETIME NOT NULL,
  payload_text LONGTEXT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_event_id (event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
