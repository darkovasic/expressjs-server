-- Readings table (Phase 2a: table only; index in Phase 2b).
-- Applied automatically only when Postgres initializes an empty data directory
-- (see docker-compose volume mount in Phase 2c).

CREATE TABLE IF NOT EXISTS readings (
    id          BIGSERIAL PRIMARY KEY,
    device_id   VARCHAR(255) NOT NULL,
    value       DOUBLE PRECISION NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Phase 2b: speed up filters by device + time-ordered reads (Grafana, GET /data).
CREATE INDEX IF NOT EXISTS idx_readings_device_created_at
    ON readings (device_id, created_at DESC);