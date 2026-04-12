# Readings API — HTTP reference

**Base URL (example):** `https://api.bedrocklabs.online`  

Use your real API host. With Nginx TLS in front, use **HTTPS** on port **443** (no `:3000` in the URL).

Responses that include a body use **`Content-Type: application/json`**.

---

## Authentication

**`POST /data`** and **`GET /data`** require the server **`API_KEY`** (set in `.env` / Docker Compose).

Send **one** of:

| Header        | Value              |
|---------------|--------------------|
| `Authorization` | `Bearer <API_KEY>` |
| `X-API-Key`   | `<API_KEY>`        |

| Code | Body |
|------|------|
| **401** | `{ "error": "Unauthorized" }` — missing or wrong key |
| **503** | `{ "error": "Server misconfigured" }` — `API_KEY` not set on server |

**`GET /health`** does **not** require an API key.

---

## Rate limits

Per **client IP**, rolling **1 minute** window (see `src/index.js`).

| Route | Default max | Env override |
|-------|-------------|--------------|
| `POST /data` | 60 / min | `RATE_LIMIT_POST_PER_MIN` |
| `GET /data`  | 120 / min | `RATE_LIMIT_GET_PER_MIN` |

| Code | Body |
|------|------|
| **429** | `{ "error": "Too many requests" }` |

Standard **`RateLimit-*`** response headers may be present.

---

## `GET /health`

**Auth:** none.

| Code | Body |
|------|------|
| **200** | `{ "status": "ok", "database": "ok" }` |
| **503** | `{ "status": "error", "database": "unavailable" }` |

---

## `POST /data`

**Auth:** required.

**Headers**

- `Content-Type: application/json`
- `Authorization: Bearer <API_KEY>` **or** `X-API-Key: <API_KEY>`

**Body (JSON)** — required: `device_id`, `value`. Optional: `metric`. No other keys.

| Field | Type | Rules |
|-------|------|--------|
| `device_id` | string | After trim: length **1–255**, not whitespace-only |
| `value` | number | JSON **number** (not a string); **finite** (no `NaN` / `Infinity`) |
| `metric` | string | Optional. After trim: **1–64** chars. Allowed values: **`uptime_ms`**, **`wifi_rssi_dbm`**, **`heap_free_bytes`**, **`heap_min_free_bytes`**. If omitted, the server stores **`uptime_ms`**. |

**Examples**

```json
{"device_id":"esp32-001","value":23.5}
```

```json
{"device_id":"esp32-001","value":-62,"metric":"wifi_rssi_dbm"}
```

```json
{"device_id":"esp32-001","value":245680,"metric":"heap_free_bytes"}
```

(`heap_min_free_bytes` is the low-water free heap in bytes since boot, until reset.)

**Success**

- **201** — one inserted row:

```json
{
  "id": "1",
  "device_id": "esp32-001",
  "value": 23.5,
  "metric": "uptime_ms",
  "created_at": "2026-04-06T12:00:00.000Z"
}
```

`id` may be a **string** (bigint). `created_at` is ISO-8601.

**Errors**

| Code | Typical cause |
|------|----------------|
| **400** | Invalid JSON, unknown/extra keys, bad `device_id` / `value` / `metric` |
| **401** | Missing/wrong API key |
| **413** | Body larger than **10 KB** (`express.json` limit) |
| **429** | Rate limit |
| **500** | `{ "error": "Internal server error" }` |

---

## `GET /data`

**Auth:** required.

**Headers:** `Authorization: Bearer <API_KEY>` **or** `X-API-Key: <API_KEY>`

**Query parameters** — only these are allowed (any other name → **400**):

| Param | Required | Meaning |
|-------|----------|---------|
| `limit` | no | Positive integer; default **50**; maximum **100** |
| `device_id` | no | If set: filter to that device (trimmed, 1–255 chars) |
| `metric` | no | If set: filter to that series only — **`uptime_ms`**, **`wifi_rssi_dbm`**, **`heap_free_bytes`**, **`heap_min_free_bytes`** |

- Filters combine with **AND** (e.g. `device_id` + `metric`).
- Without `device_id` or `metric`: newest readings first, up to `limit` rows (any device, any metric).

**Success**

- **200** — JSON **array** of rows:

```json
[
  {
    "id": "2",
    "device_id": "esp32-001",
    "value": 23.5,
    "metric": "uptime_ms",
    "created_at": "2026-04-06T12:00:00.000Z"
  }
]
```

**Errors**

| Code | Typical cause |
|------|----------------|
| **400** | Unknown query param, invalid `limit`, `device_id`, or `metric` |
| **401** | Missing/wrong API key |
| **429** | Rate limit |
| **500** | `{ "error": "Internal server error" }` |

---

## Grafana

Use the Postgres datasource and filter panels by **`metric`**: e.g. `metric = 'uptime_ms'`, Wi‑Fi STA RSSI with `metric = 'wifi_rssi_dbm'` (**dBm**), heap with `metric = 'heap_free_bytes'` or `metric = 'heap_min_free_bytes'` (bytes; use a separate Y-axis scale from uptime/RSSI).

---

## MCU / embedded notes

1. Use **TLS** to the API hostname; enable **SNI** with that hostname.
2. On **`/data`**, always send `Content-Type: application/json` plus **`Authorization`** or **`X-API-Key`**.
3. Encode **`value`** as a JSON **number**, not a quoted string.
4. Omit **`metric`** for uptime (server defaults to **`uptime_ms`**); use **`wifi_rssi_dbm`**, **`heap_free_bytes`**, **`heap_min_free_bytes`** for those series when posting explicitly.
5. Keep **`GET`** URLs within your stack’s URL length limits if you add long query strings.

---

## `curl` examples

```bash
# Health (no key)
curl -sS https://api.example.com/health

# POST reading
curl -sS -X POST https://api.example.com/data \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"device_id":"esp32-001","value":23.5}'

# GET latest (default limit 50)
curl -sS -H "X-API-Key: YOUR_API_KEY" \
  "https://api.example.com/data"

# GET filtered
curl -sS -H "X-API-Key: YOUR_API_KEY" \
  "https://api.example.com/data?device_id=esp32-001&limit=10"

# GET Wi‑Fi RSSI series only
curl -sS -H "X-API-Key: YOUR_API_KEY" \
  "https://api.example.com/data?device_id=esp32-001&metric=wifi_rssi_dbm&limit=50"
```

Replace `https://api.example.com` and `YOUR_API_KEY` with your values.
