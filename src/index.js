require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');

const app = express();
const port = Number.parseInt(process.env.PORT || '3000', 10);

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

app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});