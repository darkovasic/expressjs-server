-- Per-series discriminator (uptime_ms, wifi_rssi_dbm, ...). Default keeps legacy rows/clients valid.
ALTER TABLE readings
    ADD COLUMN IF NOT EXISTS metric VARCHAR(64) NOT NULL DEFAULT 'uptime_ms';

CREATE INDEX IF NOT EXISTS idx_readings_device_metric_created_at
    ON readings (device_id, metric, created_at DESC);
