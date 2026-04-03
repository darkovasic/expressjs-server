require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');

const app = express();
const port = Number.parseInt(process.env.PORT || '3000', 10);

const MAX_DEVICE_ID_LEN = 255;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;

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

function parseLimitParam(raw) {
    if (raw === undefined || raw === '') {
        return DEFAULT_LIST_LIMIT;
    }
    if (Array.isArray(raw)) {
        return null;
    }
    const s = String(raw).trim();
    if (!/^\d+$/.test(s)) {
        return null;
    }
    const n = Number(s);
    if (n < 1) {
        return null;
    }
    return Math.min(n, MAX_LIST_LIMIT);
}

app.get('/data', async (req, res) => {
    try {
        const q = req.query;
        const unknown = Object.keys(q).filter((k) => k !== 'limit' && k !== 'device_id');
        if (unknown.length > 0) {
            return res.status(400).json({
                error: `Unknown query parameters: ${unknown.join(', ')}`,
            });
        }

        const limit = parseLimitParam(q.limit);
        if (limit === null) {
            return res.status(400).json({
                error: `limit must be a positive integer (max ${MAX_LIST_LIMIT})`,
            });
        }

        const deviceRaw = q.device_id;
        if (deviceRaw === undefined || deviceRaw === '') {
            const result = await pool.query(
                `SELECT id, device_id, value, created_at
         FROM readings
         ORDER BY created_at DESC
         LIMIT $1`,
                [limit]
            );
            return res.json(result.rows);
        }

        if (Array.isArray(deviceRaw)) {
            return res.status(400).json({ error: 'device_id must be a single value' });
        }
        const device_id = String(deviceRaw).trim();
        if (device_id.length === 0 || device_id.length > MAX_DEVICE_ID_LEN) {
            return res.status(400).json({
                error: `device_id query must be 1–${MAX_DEVICE_ID_LEN} non-whitespace characters`,
            });
        }

        const result = await pool.query(
            `SELECT id, device_id, value, created_at
            FROM readings
            WHERE device_id = $1
            ORDER BY created_at DESC
            LIMIT $2`,
            [device_id, limit]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('GET /data error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(port, () => {
    console.log(`Listening on port ${port}`);
});