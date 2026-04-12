require('dotenv').config();

const crypto = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

const app = express();
const port = Number.parseInt(process.env.PORT || '3000', 10);

if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

const MAX_DEVICE_ID_LEN = 255;
const MAX_METRIC_LEN = 64;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;

/** Allowed POST/GET metric names (series discriminator). */
const ALLOWED_METRICS = new Set([
    'uptime_ms',
    'wifi_rssi_dbm',
    'heap_free_bytes',
    'heap_min_free_bytes',
]);

const postDataLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: Number.parseInt(process.env.RATE_LIMIT_POST_PER_MIN || '60', 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests' },
});

const getDataLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: Number.parseInt(process.env.RATE_LIMIT_GET_PER_MIN || '120', 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests' },
});

app.use(express.json({ limit: '10kb' }));

function extractApiKey(req) {
    const xApiKey = req.get('X-API-Key');
    if (xApiKey && xApiKey.trim()) {
        return xApiKey.trim();
    }
    const auth = req.get('Authorization');
    if (auth && /^Bearer\s+/i.test(auth)) {
        return auth.replace(/^Bearer\s+/i, '').trim();
    }
    return null;
}

function apiKeyAuth(req, res, next) {
    const expected = process.env.API_KEY;
    if (!expected || expected.trim() === '') {
        console.error('API_KEY is not set');
        return res.status(503).json({ error: 'Server misconfigured' });
    }
    const provided = extractApiKey(req);
    if (!provided) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

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

app.post('/data', postDataLimiter, apiKeyAuth, async (req, res) => {
    try {
        const body = req.body;
        if (body === null || typeof body !== 'object' || Array.isArray(body)) {
            return res.status(400).json({ error: 'Invalid JSON body' });
        }
        const postKeys = new Set(['device_id', 'value', 'metric']);
        const keys = Object.keys(body);
        if (keys.some((k) => !postKeys.has(k))) {
            return res.status(400).json({ error: 'Unknown or disallowed body fields' });
        }
        if (!('device_id' in body) || !('value' in body)) {
            return res.status(400).json({ error: 'device_id and value are required' });
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

        let metric = 'uptime_ms';
        if ('metric' in body) {
            if (body.metric === undefined || body.metric === null) {
                return res.status(400).json({ error: 'metric must be a string when provided' });
            }
            if (typeof body.metric !== 'string') {
                return res.status(400).json({ error: 'metric must be a string' });
            }
            const m = body.metric.trim();
            if (m.length === 0 || m.length > MAX_METRIC_LEN) {
                return res.status(400).json({
                    error: `metric must be 1–${MAX_METRIC_LEN} non-whitespace characters`,
                });
            }
            if (!ALLOWED_METRICS.has(m)) {
                return res.status(400).json({ error: 'Unknown metric' });
            }
            metric = m;
        }

        const result = await pool.query(
            `INSERT INTO readings (device_id, value, metric)
            VALUES ($1, $2, $3)
            RETURNING id, device_id, value, metric, created_at`,
            [device_id, value, metric]
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

/** @returns {{ ok: true, metric: string } | { ok: false }} */
function parseMetricQueryParam(raw) {
    if (raw === undefined || raw === '') {
        return { ok: true, metric: '' };
    }
    if (Array.isArray(raw)) {
        return { ok: false };
    }
    const m = String(raw).trim();
    if (m.length === 0 || m.length > MAX_METRIC_LEN || !ALLOWED_METRICS.has(m)) {
        return { ok: false };
    }
    return { ok: true, metric: m };
}

app.get('/data', getDataLimiter, apiKeyAuth, async (req, res) => {
    try {
        const q = req.query;
        const unknown = Object.keys(q).filter(
            (k) => k !== 'limit' && k !== 'device_id' && k !== 'metric'
        );
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

        const metricParsed = parseMetricQueryParam(q.metric);
        if (!metricParsed.ok) {
            return res.status(400).json({ error: 'metric must be a single allowed metric name' });
        }
        const metricFilter = metricParsed.metric;

        const deviceRaw = q.device_id;
        let device_id = null;
        if (deviceRaw !== undefined && deviceRaw !== '') {
            if (Array.isArray(deviceRaw)) {
                return res.status(400).json({ error: 'device_id must be a single value' });
            }
            device_id = String(deviceRaw).trim();
            if (device_id.length === 0 || device_id.length > MAX_DEVICE_ID_LEN) {
                return res.status(400).json({
                    error: `device_id query must be 1–${MAX_DEVICE_ID_LEN} non-whitespace characters`,
                });
            }
        }

        const conditions = [];
        const params = [];
        let i = 1;
        if (device_id !== null) {
            conditions.push(`device_id = $${i}`);
            params.push(device_id);
            i += 1;
        }
        if (metricFilter !== '') {
            conditions.push(`metric = $${i}`);
            params.push(metricFilter);
            i += 1;
        }
        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        params.push(limit);

        const result = await pool.query(
            `SELECT id, device_id, value, metric, created_at
            FROM readings
            ${where}
            ORDER BY created_at DESC
            LIMIT $${i}`,
            params
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