# LandTrace Backend — Technical Documentation

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Repository Structure](#3-repository-structure)
4. [Environment Variables](#4-environment-variables)
5. [Architecture Overview](#5-architecture-overview)
6. [Database Schema](#6-database-schema)
7. [Authentication System](#7-authentication-system)
8. [API Reference](#8-api-reference)
9. [Spatial / PostGIS Layer](#9-spatial--postgis-layer)
10. [Conflict Detection Pipeline](#10-conflict-detection-pipeline)
11. [Error Handling](#11-error-handling)
12. [Running Locally](#12-running-locally)

---

## 1. Project Overview

LandTrace is a backend API for a rural land-tracing mobile app built for Indian farmers. It allows farmers to:

- Create an account via SMS OTP (no passwords)
- Upload GPS polygon boundaries of their fields
- Automatically detect when their field overlaps with another farmer's field (a land dispute)
- View, discuss, and resolve those disputes through a notes thread

The backend is a Node.js REST API backed by a Supabase (PostgreSQL + PostGIS) database.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js v22 (ES Modules) |
| Web framework | Express 4 |
| Database | Supabase (PostgreSQL 15 + PostGIS) |
| DB client | `@supabase/supabase-js` v2 |
| Auth (OTP) | Twilio Verify |
| Auth (sessions) | JWT (access tokens) + opaque refresh tokens |
| Input validation | Zod |
| Spatial queries | PostGIS RPC functions (stored in DB) |

---

## 3. Repository Structure

```
LandTrace-Backend/
├── src/
│   ├── index.js                  # App entry point, Express setup, route mounting
│   ├── db.js                     # Supabase client singleton
│   ├── controllers/
│   │   ├── auth.js               # OTP request/verify, token refresh, logout
│   │   ├── users.js              # Get/update own profile
│   │   ├── traces.js             # Upload, list, get, delete field traces
│   │   └── conflicts.js          # List, get, add notes, update status
│   ├── routes/
│   │   ├── auth.js               # Route definitions for /auth
│   │   ├── users.js              # Route definitions for /users
│   │   ├── traces.js             # Route definitions for /traces
│   │   └── conflicts.js          # Route definitions for /conflicts
│   ├── middleware/
│   │   └── auth.js               # JWT verification middleware
│   ├── services/
│   │   ├── conflicts.js          # detectConflicts + upsertConflict helpers
│   │   └── twilio.js             # Twilio Verify send/check wrappers
│   └── utils/
│       ├── token.js              # JWT sign/verify, refresh token generation + hashing
│       └── errors.js             # Shared errorResponse helper
├── supabase/
│   └── rpc_functions.sql         # All PostGIS stored functions — run in Supabase SQL editor
├── API_ENDPOINTS.md              # Endpoint reference with request/response shapes
├── package.json
└── .env                          # Not committed — see Section 4
```

### Key design principle

Controllers are thin — they validate input (Zod), call into the DB or a service, and return a response. No business logic lives in routes. Heavy spatial work lives entirely in DB-side RPC functions, not in JavaScript.

---

## 4. Environment Variables

Create a `.env` file in the project root. All variables are required.

```env
# Supabase
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# JWT
JWT_ACCESS_SECRET=a-long-random-secret-string

# Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_VERIFY_SERVICE_SID=VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Server (optional, defaults to 3000)
PORT=3000
```

**Where to find these:**
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`: Supabase dashboard → Project Settings → API
- `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN`: Twilio console → Account Info
- `TWILIO_VERIFY_SERVICE_SID`: Twilio console → Verify → Services → your service SID
- `JWT_ACCESS_SECRET`: generate with `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`

The service role key bypasses Supabase's Row Level Security. Never expose it to a client.

---

## 5. Architecture Overview

```
Client (mobile app)
        │
        ▼
  Express API (Node.js)
  ├── Zod validation
  ├── JWT middleware (protected routes)
  ├── Controllers
  │     ├── supabase.rpc(...)        ← calls stored DB functions
  │     └── supabase.from(...)       ← direct table reads/writes
  └── Services
        ├── Twilio Verify            ← SMS OTP
        └── conflicts.js             ← spatial conflict pipeline

        │
        ▼
  Supabase (PostgreSQL + PostGIS)
  ├── Tables: users, traces, conflicts, conflict_notes, refresh_tokens
  └── RPC functions: insert_trace, detect_conflicts, upsert_conflict, ...
```

### Request lifecycle

1. Request hits Express
2. If the route is protected, `authenticateToken` middleware verifies the JWT and attaches `req.user.id`
3. Controller validates the request body/query with Zod
4. Controller calls Supabase (RPC function or direct table operation)
5. Response is returned as JSON

---

## 6. Database Schema

### `users`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key, auto-generated |
| `phone` | text | Unique, E.164 format |
| `name` | text | Nullable until profile is filled |
| `village` | text | Nullable |
| `district` | text | Nullable |
| `state` | text | Nullable |
| `language` | text | e.g. `"hi"` for Hindi |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `traces`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `owner_id` | uuid | Foreign key → users.id |
| `local_id` | text | Device-side ID, unique per user |
| `label` | text | Optional display name |
| `geometry` | geometry(Polygon, 4326) | PostGIS polygon in WGS84 |
| `area_sqm` | float8 | Computed by DB trigger on insert |
| `perimeter_m` | float8 | Computed by DB trigger on insert |
| `traced_at` | timestamptz | When the farmer traced it |
| `created_at` | timestamptz | When the server received it |

### `conflicts`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `trace_a_id` | uuid | FK → traces.id (smaller UUID of the pair) |
| `trace_b_id` | uuid | FK → traces.id (larger UUID of the pair) |
| `overlap_geometry` | geometry | The intersection polygon |
| `overlap_sqm` | float8 | Area of the overlap in square metres |
| `overlap_pct_a` | float8 | Overlap as % of trace A's area |
| `overlap_pct_b` | float8 | Overlap as % of trace B's area |
| `status` | text | `open`, `resolved`, or `dismissed` |
| `detected_at` | timestamptz | |
| `resolved_at` | timestamptz | Nullable |

`(trace_a_id, trace_b_id)` has a unique constraint. UUIDs are always stored smallest-first to prevent duplicate rows for the same pair (see Section 10).

### `conflict_notes`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `conflict_id` | uuid | FK → conflicts.id (cascades on delete) |
| `author_id` | uuid | FK → users.id |
| `body` | text | 1–1000 chars |
| `created_at` | timestamptz | |

### `refresh_tokens`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `user_id` | uuid | FK → users.id |
| `token_hash` | text | SHA-256 hash of the actual token |
| `expires_at` | timestamptz | 30 days from creation |
| `revoked` | boolean | Set to true on use or logout |

The raw token is never stored — only its SHA-256 hash. Lookup is done by hashing the incoming token and comparing.

---

## 7. Authentication System

### OTP login flow

```
1. POST /auth/otp/request  { phone }
      → Twilio sends a 6-digit SMS code to the phone

2. POST /auth/otp/verify   { phone, code }
      → Twilio confirms the code is correct
      → upsert_user() creates user if first login, or fetches existing
      → access_token (JWT, 15 min) + refresh_token (opaque, 30 days) returned
      → refresh_token hash stored in refresh_tokens table
      → is_new_user: true on first login (use to trigger profile setup screen)
```

### Token system

**Access token** — a signed JWT. Contains `sub: user_id`. Valid for 15 minutes. Verified by the `authenticateToken` middleware on every protected request. Never stored in the DB.

**Refresh token** — a 128-character random hex string (`crypto.randomBytes(64)`). Stored as a SHA-256 hash in the `refresh_tokens` table. Valid for 30 days. Used only to get a new access token.

**Token rotation** — every call to `POST /auth/token/refresh` immediately revokes the old refresh token and issues a new one. If a stolen token is used, the legitimate user's next refresh will fail, indicating a breach.

**Logout** — marks the refresh token as `revoked: true`. The access token remains technically valid until it naturally expires (max 15 minutes), which is acceptable for this use case.

### `authenticateToken` middleware (`src/middleware/auth.js`)

Runs before every protected route. Reads the `Authorization: Bearer <token>` header, calls `jwt.verify()`, and attaches `{ id: payload.sub }` to `req.user`. Returns `401 UNAUTHORIZED` if the token is missing, malformed, or expired.

---

## 8. API Reference

All protected endpoints require: `Authorization: Bearer <access_token>`

All errors follow this shape:
```json
{ "error": { "code": "ERROR_CODE", "message": "Human-readable description" } }
```

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/otp/request` | No | Send OTP to phone |
| POST | `/auth/otp/verify` | No | Verify OTP, get tokens |
| POST | `/auth/token/refresh` | No | Rotate refresh token |
| POST | `/auth/logout` | No | Revoke refresh token |

### Users

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/users/me` | Yes | Get own profile |
| PATCH | `/users/me` | Yes | Update own profile (sparse) |

`PATCH /users/me` uses Zod's `.strict()` — any unknown field in the request body is rejected with `VALIDATION_ERROR`.

### Traces

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/traces` | Yes | Upload a field, triggers conflict detection |
| GET | `/traces` | Yes | List own fields (paginated) |
| GET | `/traces/:id` | Yes | Get one field (own only) |
| DELETE | `/traces/:id` | Yes | Delete a field (cascades to conflicts) |

### Conflicts

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/conflicts` | Yes | List conflicts (filter by status) |
| GET | `/conflicts/:id` | Yes | Get full conflict detail with notes |
| POST | `/conflicts/:id/notes` | Yes | Add a note to a conflict |
| PATCH | `/conflicts/:id/status` | Yes | Resolve or dismiss a conflict |

For the full request/response shapes, see `API_ENDPOINTS.md`.

---

## 9. Spatial / PostGIS Layer

All spatial logic lives in `supabase/rpc_functions.sql`. These are PostgreSQL stored functions called from Node.js via `supabase.rpc('function_name', params)`. They never need to be redeployed with the app — they live in the database and are run with `CREATE OR REPLACE` in the Supabase SQL editor.

### Why RPC functions instead of queries in JS?

- Spatial operations like `ST_Intersection` return binary geometry. RPC functions convert it to GeoJSON before it leaves the DB, so JS never handles raw geometry.
- `detect_conflicts` scans potentially thousands of rows with a spatial index. Doing this in JS (fetching all rows and comparing coordinates) would be orders of magnitude slower.
- Logic that touches multiple tables stays in one place.

### Key PostGIS functions used

| Function | What it does |
|---|---|
| `ST_GeomFromGeoJSON(text)` | Converts a GeoJSON string to internal PostGIS geometry |
| `ST_AsGeoJSON(geometry)` | Converts internal geometry back to a GeoJSON string |
| `ST_Intersects(a, b)` | Returns true/false — do these two shapes overlap? Hits spatial index. |
| `ST_Intersection(a, b)` | Returns the actual overlapping polygon |
| `ST_Transform(geom, 32643)` | Reprojects from WGS84 (degrees) to UTM Zone 43N (metres, covers India) |
| `ST_Area(geometry)` | Returns area in the geometry's units — must reproject to metres first |

### EPSG:32643 — why this projection?

Raw GPS coordinates are in degrees (WGS84, EPSG:4326). Area in degrees is meaningless. UTM Zone 43N (EPSG:32643) is a metric projection that covers most of north and central India, giving accurate square-metre results for typical farm sizes.

### The 8 RPC functions

| Function | Purpose |
|---|---|
| `upsert_user(phone)` | Create user on first login or fetch existing. `xmax=0` detects new vs existing. |
| `insert_trace(owner_id, local_id, label, geojson, traced_at)` | Insert trace, returns row with area/perimeter from DB trigger |
| `list_traces(owner_id, limit, offset)` | Paginated trace list, geometry as GeoJSON |
| `get_trace(trace_id, owner_id)` | Single trace, scoped to owner — returns NULL if not found or wrong owner |
| `detect_conflicts(geojson, owner_id, trace_id)` | Finds all other-owner traces that intersect the given polygon |
| `upsert_conflict(trace_a_id, trace_b_id, ...)` | Insert conflict row, `ON CONFLICT DO NOTHING` if pair already exists |
| `get_conflict_full(conflict_id)` | Full conflict detail: geometries, farmer info, notes — all in one query |
| `list_conflicts_for_user(user_id, status, limit, offset)` | Paginated conflicts where user owns either trace |
| `user_can_access_conflict(conflict_id, user_id)` | Boolean access guard — owns either trace? |

All functions are marked `SECURITY DEFINER`, meaning they run with the DB owner's privileges regardless of who calls them.

---

## 10. Conflict Detection Pipeline

This is the most complex flow in the system. It runs automatically every time a trace is uploaded.

```
POST /traces
  │
  ├─ 1. Validate GeoJSON polygon (Zod)
  │
  ├─ 2. insert_trace RPC
  │        └─ ST_GeomFromGeoJSON stores the polygon
  │        └─ DB trigger fires → computes area_sqm, perimeter_m
  │        └─ Returns full trace row including computed values
  │
  ├─ 3. detect_conflicts RPC  (src/services/conflicts.js)
  │        └─ Parses GeoJSON once via CTE
  │        └─ ST_Intersects scan against all other-owner traces (uses spatial index)
  │        └─ For each hit: ST_Intersection + ST_Area(ST_Transform(..., 32643))
  │        └─ Returns: other_trace_id, overlap_geometry, overlap_sqm, both areas
  │
  ├─ 4. For each conflict hit (loop in JS):
  │        ├─ Sort UUIDs: smaller → trace_a_id, larger → trace_b_id
  │        ├─ Compute overlap_pct_a = (overlap_sqm / area_a) * 100
  │        ├─ Compute overlap_pct_b = (overlap_sqm / area_b) * 100
  │        └─ upsert_conflict RPC → ON CONFLICT DO NOTHING if already exists
  │
  └─ 5. Return { trace, conflicts[] }
        conflicts[] is empty if no overlaps found
```

### Why conflict detection is non-fatal

The trace is already committed to the database before conflict detection runs. If conflict detection throws (Twilio or network issue), the trace is still saved and the error is only logged. A farmer's upload never fails because of a dispute detection issue.

### Canonical UUID ordering

The `conflicts` table has a unique constraint on `(trace_a_id, trace_b_id)`. Without ordering, the same pair `(A, B)` and `(B, A)` could produce two separate rows. To prevent this, `src/services/conflicts.js` always places the lexicographically smaller UUID in `trace_a_id` before calling the DB:

```js
const isNewFirst = traceNewId < other_trace_id;
const [traceAId, traceBId] = isNewFirst
  ? [traceNewId, other_trace_id]
  : [other_trace_id, traceNewId];
```

This ensures the pair is always represented the same way regardless of which farmer uploaded first.

---

## 11. Error Handling

All errors are returned via the shared `errorResponse` helper (`src/utils/errors.js`):

```json
{ "error": { "code": "ERROR_CODE", "message": "Human-readable description" } }
```

### Error codes

| Code | HTTP Status | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Request body or query param failed Zod validation |
| `OTP_INVALID` | 400 | Wrong or expired OTP code |
| `UNAUTHORIZED` | 401 | Missing, invalid, or expired access token |
| `INVALID_REFRESH_TOKEN` | 401 | Refresh token not found, revoked, or expired |
| `NOT_FOUND` | 404 | Resource doesn't exist or caller doesn't have access |
| `DUPLICATE_LOCAL_ID` | 409 | Trace `local_id` already used by this user |
| `OTP_SEND_FAILED` | 502 | Twilio couldn't send the SMS |
| `OTP_CHECK_FAILED` | 502 | Twilio couldn't verify the code |
| `DB_ERROR` | 500 | Unexpected database error |
| `INTERNAL_ERROR` | 500 | Unhandled Express error |

Note: `NOT_FOUND` is intentionally used for both "doesn't exist" and "you don't have access." This prevents callers from inferring the existence of resources they don't own.

### Global error handler

`src/index.js` registers a catch-all Express error handler that returns `500 INTERNAL_ERROR` for any unhandled exception and logs it to `console.error`.

---

## 12. Running Locally

### Prerequisites
- Node.js 18+
- A Supabase project with the PostGIS extension enabled
- A Twilio account with a Verify service set up
- The RPC functions deployed (paste `supabase/rpc_functions.sql` into the Supabase SQL editor and run it)

### Setup

```bash
# Install dependencies
npm install

# Create .env (see Section 4 for values)
cp .env.example .env   # or create manually

# Start in development mode (auto-restarts on file changes)
npm run dev

# Start in production mode
npm start
```

The server will log: `LandTrace API running on port 3000`

### Deploying the DB functions

Every time `supabase/rpc_functions.sql` is changed, the new version must be run in the Supabase SQL editor. All functions use `CREATE OR REPLACE`, so it is safe to re-run the entire file — it won't duplicate or break anything.

### Testing a request

```bash
# 1. Request OTP
curl -X POST http://localhost:3000/auth/otp/request \
  -H "Content-Type: application/json" \
  -d '{"phone": "+91XXXXXXXXXX"}'

# 2. Verify OTP — use the code from your SMS
curl -X POST http://localhost:3000/auth/otp/verify \
  -H "Content-Type: application/json" \
  -d '{"phone": "+91XXXXXXXXXX", "code": "123456"}'

# 3. Use the access_token from step 2
curl http://localhost:3000/users/me \
  -H "Authorization: Bearer <access_token>"
```
