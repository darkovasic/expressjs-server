require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');

const app = express();
const port = Number.parseInt(process.env.PORT || '3000', 10);

const MAX_DEVICE_ID_LEN = 255;

app.use(express.json({ limit: '10kb' }));

function createPool() {
    if (process.env.DATABASE_URL) {
        return new Pool({ connectionString: process.env.DATABASE_URL });
    }
    const user = process.env.POSTGRES_USER;
    const password = process.env.POSTGRES_PASSWORD;
    const host = process.env.POSTGRES_HOST || 'localhost';
    const portPg = Number.parseInt(process.env.POSTGRES_PORT || '5432', 10);
    const database = process.env.POSTGRES_DB;
    if (!user || password === undefined || password === '' || !database) {
        throw new Error(
            'Set DATABASE_URL or POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB (and optional POSTGRES_HOST, POSTGRES_PORT)'
        );
    }
    return new Pool({ user, password, host, port: portPg, database });
}

const pool = createPool();

app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1 AS ok');
        res.json({ status: 'ok', database: 'ok' });
    } catch (err) {
        console.error('Health check DB error:', err.message);
        res.status(503).json({ status: 'error', database: 'unavailable' });
    }
});

app.post('/data', async (req, res) => {
    try {
        const body = req.body;
        if (body === null || typeof body !== 'object' || Array.isArray(body)) {
            return res.status(400).json({ error: 'Invalid JSON body' });
        }
        const keys = Object.keys(body);
        const allowed = new Set(['device_id', 'value']);
        if (keys.length !== 2 || keys.some((k) => !allowed.has(k))) {
            return res.status(400).json({ error: 'Body must contain only device_id and value' });
        }
        const { device_id: rawDeviceId, value } = body;
        if (typeof rawDeviceId !== 'string') {
            return res.status(400).json({ error: 'device_id must be a string' });
        }
        const device_id = rawDeviceId.trim();
        if (device_id.length === 0 || device_id.length > MAX_DEVICE_ID_LEN) {
            return res.status(400).json({
                error: `device_id must be 1–${MAX_DEVICE_ID_LEN} non-whitespace characters`,
            });
        }
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return res.status(400).json({ error: 'value must be a finite number' });
        }

        const result = await pool.query(
            `INSERT INTO readings (device_id, value)
            VALUES ($1, $2)
            RETURNING id, device_id, value, created_at`,
            [device_id, value]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('POST /data error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(port, () => {
    console.log(`Listening on port ${port}`);
});