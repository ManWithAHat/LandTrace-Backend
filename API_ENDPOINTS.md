# LandTrace API — Endpoint Reference

**Base URL:** `http://localhost:3000` (dev) / your production domain

**Auth:** All protected endpoints require `Authorization: Bearer <access_token>` header.

**Error shape** (all errors):
```json
{ "error": { "code": "ERROR_CODE", "message": "Human-readable description" } }
```

---

## Auth

### POST /auth/otp/request
Send an OTP to a phone number.

**Auth required:** No

**Body:**
```json
{ "phone": "+919876543210" }
```
- `phone` — E.164 format (country code + number, no spaces)

**Response 200:**
```json
{ "message": "OTP sent" }
```

**Errors:**
| Code | Status | Reason |
|------|--------|--------|
| `VALIDATION_ERROR` | 400 | Phone not in E.164 format |
| `OTP_SEND_FAILED` | 502 | Twilio error |

---

### POST /auth/otp/verify
Verify OTP and receive tokens. Creates the user account on first login.

**Auth required:** No

**Body:**
```json
{
  "phone": "+919876543210",
  "code": "123456"
}
```

**Response 200:**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "a1b2c3...",
  "user_id": "uuid",
  "is_new_user": true
}
```
- `is_new_user` — `true` on first login; use to redirect to profile setup

**Errors:**
| Code | Status | Reason |
|------|--------|--------|
| `VALIDATION_ERROR` | 400 | Missing/invalid phone or code |
| `OTP_INVALID` | 400 | Wrong or expired OTP |
| `OTP_CHECK_FAILED` | 502 | Twilio error |

---

### POST /auth/token/refresh
Rotate the refresh token and get a new access token.

**Auth required:** No

**Body:**
```json
{ "refresh_token": "a1b2c3..." }
```

**Response 200:**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "d4e5f6..."
}
```
- Old `refresh_token` is immediately revoked; use the new one going forward.

**Errors:**
| Code | Status | Reason |
|------|--------|--------|
| `INVALID_REFRESH_TOKEN` | 401 | Token not found, revoked, or expired |

---

### POST /auth/logout
Revoke the refresh token (silent no-op if token is missing or already revoked).

**Auth required:** No

**Body:**
```json
{ "refresh_token": "a1b2c3..." }
```

**Response:** `204 No Content`

---

## Users

### GET /users/me
Return the authenticated user's profile.

**Auth required:** Yes

**Response 200:**
```json
{
  "id": "uuid",
  "phone": "+919876543210",
  "name": "Ravi Kumar",
  "village": "Nandpur",
  "district": "Varanasi",
  "state": "Uttar Pradesh",
  "language": "hi",
  "created_at": "2025-01-10T08:00:00Z",
  "updated_at": "2025-01-10T08:00:00Z"
}
```

---

### PATCH /users/me
Sparse-update the authenticated user's profile.

**Auth required:** Yes

**Body** (all fields optional):
```json
{
  "name": "Ravi Kumar",
  "village": "Nandpur",
  "district": "Varanasi",
  "state": "Uttar Pradesh",
  "language": "hi"
}
```
- Only provided fields are updated; omit fields to leave them unchanged.
- Unknown fields are rejected.

**Response 200:** Updated user object (same shape as `GET /users/me`)

**Errors:**
| Code | Status | Reason |
|------|--------|--------|
| `VALIDATION_ERROR` | 400 | Unknown field or value out of range |

---

## Traces

### POST /traces
Upload a new land trace. Automatically detects conflicts with other farmers' traces.

**Auth required:** Yes

**Body:**
```json
{
  "geometry": {
    "type": "Polygon",
    "coordinates": [
      [
        [82.9739, 25.3176],
        [82.9750, 25.3176],
        [82.9750, 25.3165],
        [82.9739, 25.3165],
        [82.9739, 25.3176]
      ]
    ]
  },
  "local_id": "field-001",
  "label": "North Field",
  "traced_at": "2025-01-10T06:30:00Z"
}
```
- `geometry` — GeoJSON Polygon; exterior ring must have ≥ 4 positions and be closed (first = last)
- `local_id` — your device-side ID; must be unique per user
- `label` — optional display name
- `traced_at` — optional ISO timestamp; defaults to now

**Response 201:**
```json
{
  "trace": {
    "id": "uuid",
    "owner_id": "uuid",
    "local_id": "field-001",
    "label": "North Field",
    "geometry": { "type": "Polygon", "coordinates": [[...]] },
    "area_sqm": 14250.5,
    "perimeter_m": 478.2,
    "traced_at": "2025-01-10T06:30:00Z",
    "created_at": "2025-01-10T08:00:00Z"
  },
  "conflicts": [
    {
      "id": "uuid",
      "trace_a_id": "uuid",
      "trace_b_id": "uuid",
      "overlap_sqm": 320.0,
      "overlap_pct_a": 2.24,
      "overlap_pct_b": 15.6,
      "status": "open",
      "detected_at": "2025-01-10T08:00:00Z"
    }
  ]
}
```
- `conflicts` — array of newly created conflict rows (empty if no overlaps found)
- `area_sqm` / `perimeter_m` — computed by DB trigger; always populated in the response

**Errors:**
| Code | Status | Reason |
|------|--------|--------|
| `VALIDATION_ERROR` | 400 | Invalid GeoJSON, missing `local_id`, etc. |
| `DUPLICATE_LOCAL_ID` | 409 | You already have a trace with this `local_id` |

---

### GET /traces
List the authenticated user's traces, newest first.

**Auth required:** Yes

**Query params:**
| Param | Default | Description |
|-------|---------|-------------|
| `limit` | 20 | Max results (1–100) |
| `offset` | 0 | Skip N results |

**Response 200:**
```json
{
  "traces": [
    {
      "id": "uuid",
      "owner_id": "uuid",
      "local_id": "field-001",
      "label": "North Field",
      "geometry": { "type": "Polygon", "coordinates": [[...]] },
      "area_sqm": 14250.5,
      "perimeter_m": 478.2,
      "traced_at": "2025-01-10T06:30:00Z",
      "created_at": "2025-01-10T08:00:00Z"
    }
  ],
  "limit": 20,
  "offset": 0
}
```

---

### GET /traces/:id
Get a single trace. Only accessible to the owner.

**Auth required:** Yes

**Response 200:** Single trace object (same shape as items in `GET /traces`)

**Errors:**
| Code | Status | Reason |
|------|--------|--------|
| `NOT_FOUND` | 404 | Trace doesn't exist or belongs to another user |

---

### DELETE /traces/:id
Delete a trace. Cascades to any associated conflicts and notes.

**Auth required:** Yes

**Response:** `204 No Content`

**Errors:**
| Code | Status | Reason |
|------|--------|--------|
| `NOT_FOUND` | 404 | Trace doesn't exist or belongs to another user |

---

## Conflicts

### GET /conflicts
List conflicts involving the authenticated user's traces.

**Auth required:** Yes

**Query params:**
| Param | Default | Options | Description |
|-------|---------|---------|-------------|
| `status` | `open` | `open`, `resolved`, `dismissed` | Filter by status |
| `limit` | 20 | 1–100 | Max results |
| `offset` | 0 | — | Skip N results |

**Response 200:**
```json
{
  "conflicts": [
    {
      "id": "uuid",
      "trace_a_id": "uuid",
      "trace_b_id": "uuid",
      "overlap_sqm": 320.0,
      "overlap_pct_a": 2.24,
      "overlap_pct_b": 15.6,
      "status": "open",
      "detected_at": "2025-01-10T08:00:00Z",
      "resolved_at": null,
      "farmer_a_name": "Ravi Kumar",
      "farmer_a_phone": "+919876543210",
      "farmer_a_village": "Nandpur",
      "farmer_b_name": "Suresh Singh",
      "farmer_b_phone": "+919812345678",
      "farmer_b_village": "Chandpur"
    }
  ],
  "limit": 20,
  "offset": 0,
  "status": "open"
}
```

---

### GET /conflicts/:id
Get full conflict detail. Only accessible if the authenticated user owns one of the two traces.

**Auth required:** Yes

**Response 200:**
```json
{
  "id": "uuid",
  "trace_a_id": "uuid",
  "trace_b_id": "uuid",
  "overlap_geometry": { "type": "Polygon", "coordinates": [[...]] },
  "overlap_sqm": 320.0,
  "overlap_pct_a": 2.24,
  "overlap_pct_b": 15.6,
  "status": "open",
  "detected_at": "2025-01-10T08:00:00Z",
  "resolved_at": null,
  "trace_a_geometry": { "type": "Polygon", "coordinates": [[...]] },
  "trace_a_label": "North Field",
  "trace_a_area_sqm": 14250.5,
  "trace_b_geometry": { "type": "Polygon", "coordinates": [[...]] },
  "trace_b_label": "East Plot",
  "trace_b_area_sqm": 2050.0,
  "farmer_a_id": "uuid",
  "farmer_a_name": "Ravi Kumar",
  "farmer_a_phone": "+919876543210",
  "farmer_a_village": "Nandpur",
  "farmer_b_id": "uuid",
  "farmer_b_name": "Suresh Singh",
  "farmer_b_phone": "+919812345678",
  "farmer_b_village": "Chandpur",
  "notes": [
    {
      "id": "uuid",
      "body": "I have the original deed from 2003.",
      "created_at": "2025-01-11T09:00:00Z",
      "author_id": "uuid",
      "author_name": "Ravi Kumar"
    }
  ]
}
```
- `notes` — always an array (empty `[]` if none exist)

**Errors:**
| Code | Status | Reason |
|------|--------|--------|
| `NOT_FOUND` | 404 | Conflict not found or user not a party to it |

---

### POST /conflicts/:id/notes
Add a note to a conflict.

**Auth required:** Yes — must own one of the two traces

**Body:**
```json
{ "text": "I have the original deed from 2003." }
```
- `text` — 1–1000 characters

**Response 201:**
```json
{
  "id": "uuid",
  "conflict_id": "uuid",
  "author_id": "uuid",
  "body": "I have the original deed from 2003.",
  "created_at": "2025-01-11T09:00:00Z"
}
```

**Errors:**
| Code | Status | Reason |
|------|--------|--------|
| `VALIDATION_ERROR` | 400 | `text` missing or over 1000 chars |
| `NOT_FOUND` | 404 | Conflict not found or user not a party to it |

---

### PATCH /conflicts/:id/status
Resolve or dismiss a conflict. Optionally adds a closing note.

**Auth required:** Yes — must own one of the two traces

**Body:**
```json
{
  "status": "resolved",
  "resolution_note": "We agreed on the boundary on-site."
}
```
- `status` — `"resolved"` or `"dismissed"`
- `resolution_note` — optional; if provided, automatically posted as a note

**Response 200:** Updated conflict row (without geometry — use `GET /conflicts/:id` for full detail):
```json
{
  "id": "uuid",
  "trace_a_id": "uuid",
  "trace_b_id": "uuid",
  "overlap_sqm": 320.0,
  "overlap_pct_a": 2.24,
  "overlap_pct_b": 15.6,
  "status": "resolved",
  "detected_at": "2025-01-10T08:00:00Z",
  "resolved_at": "2025-01-15T14:22:00Z"
}
```

**Errors:**
| Code | Status | Reason |
|------|--------|--------|
| `VALIDATION_ERROR` | 400 | `status` not `resolved` or `dismissed` |
| `NOT_FOUND` | 404 | Conflict not found or user not a party to it |

---

## Common Error Codes

| Code | Meaning |
|------|---------|
| `UNAUTHORIZED` | Missing or invalid `Authorization` header / expired access token |
| `VALIDATION_ERROR` | Request body or query param failed schema validation |
| `NOT_FOUND` | Resource doesn't exist or you don't have access |
| `DUPLICATE_LOCAL_ID` | Trace `local_id` collision for this user |
| `OTP_INVALID` | Wrong or expired OTP code |
| `OTP_SEND_FAILED` | Twilio couldn't send the SMS |
| `OTP_CHECK_FAILED` | Twilio couldn't verify the code |
| `INVALID_REFRESH_TOKEN` | Refresh token expired, revoked, or not found |
| `DB_ERROR` | Unexpected database error |
| `INTERNAL_ERROR` | Unhandled server error |
