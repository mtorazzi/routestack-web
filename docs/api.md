# RouteStack Web — API reference

Local Express server (`server/`) that fronts the RouteStack MCP endpoint for the
static UI in `public/`. The browser only ever talks to this server; credentials
never leave it.

Base URL: `http://127.0.0.1:8787` by default (`PORT` / `HOST` override).

## Response envelope

Every JSON response uses one of two shapes.

Success:

```json
{
  "ok": true,
  "data": { },
  "meta": { "source": "production", "tool": "car_search" }
}
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "CREDENTIALS_INVALID",
    "message": "Mint partner token: credenziali non valide o token scaduto.",
    "upstreamStatus": 401
  },
  "meta": { "path": "/api/hotels/search", "method": "POST" }
}
```

- `error.code` — machine-readable (`CREDENTIALS_INVALID`, `QUOTA_EXCEEDED`,
  `PARTNER_TOKEN_NOT_CONFIGURED`, `UPSTREAM_TIMEOUT`, `TOOL_ERROR`, …).
- `error.message` — human message (Italian).
- `error.upstreamStatus` — HTTP status observed from RouteStack, or `null`.
- `error.detail` — optional, redacted technical detail.
- `meta.source` — `production` or `sandbox`.
- `meta.billable` — `true` **only** when one of the three billable searches
  (`hotel_search` / `flight_search` / `car_search`) timed out. The UI uses it to
  warn that the call was very likely counted and that the user should wait before
  retrying, instead of offering an immediate retry.

## Billing

Only these actions consume a **billable** RouteStack call:

| Action | Local call | Upstream tool |
|---|---|---|
| Flight search | `POST /api/flights/search` | `flight_search` |
| Hotel search | `POST /api/hotels/search` | `hotel_search` |
| Car search | `POST /api/cars/search` | `car_search` |
| Hotel "load more" | `POST /api/hotels/search` + `nextResultsKey` | `hotel_search` (same tool, billed again) |

Everything else is free: autocomplete (`destinations` / `locations`), rooms,
revalidate, details, session and checkout.

**Result sorting is not billable.** Changing the results-header *Ordina* select
reorders the rows already in memory on the client
(`public/components/sort.js#sortOffers`) and **never** calls `/search`. The
`sortBy` select *inside the search form* is part of the next real search payload;
changing it alone does not fire a search. The hotel *"Carica altri risultati"*
button is labelled *(nuova ricerca fatturata)* because it **does** re-send
`hotel_search` with `nextResultsKey`.

## Timeouts

Two knobs, both read from `config/secrets.json` (file wins) or the defaults:

| Field | Default | Applies to |
|---|---|---|
| `timeoutMs` | `60000` | general MCP calls: token mint, autocomplete, revalidate, checkout |
| `searchTimeoutMs` | `180000` | the three **billable** searches (clamped to 30000–600000) |

A timed-out call is **never retried** (a retry would bill a second search): the
`UPSTREAM_TIMEOUT` error propagates straight to the client. For the three
searches the message names the limit and `meta.billable` is `true`; the UI maps
it to *"Ricerca non conclusa in tempo"* with the advice to wait a few minutes.

> **Precedence.** A value stored in `config/secrets.json` overrides the default,
> so a deployed file still holding `"timeoutMs": 30000` (or lacking
> `searchTimeoutMs`) keeps the old behaviour until the operator updates it.

## Error mapping (upstream → local)

| Upstream | `error.code` | Local HTTP | Meaning |
|---|---|---|---|
| 401 | `CREDENTIALS_INVALID` | 401 | API key/secret wrong or expired; check Impostazioni |
| 402 | `QUOTA_EXCEEDED` | 402 | billable quota exhausted |
| 403 | `FORBIDDEN` | 403 | access denied |
| 404 | `UPSTREAM_NOT_FOUND` | 404 | resource not found |
| 429 | `RATE_LIMITED` | 429 | too many requests |
| 503 | `PARTNER_TOKEN_NOT_CONFIGURED` | 503 | service unavailable / partner token not configured |
| other ≥500 | `UPSTREAM_ERROR` | 502 | generic upstream failure |
| 400 | `UPSTREAM_BAD_REQUEST` | 400 | invalid request |
| timeout | `UPSTREAM_TIMEOUT` | 504 | no answer within `timeoutMs` (general) / `searchTimeoutMs` (billable searches); searches also set `meta.billable` |
| network | `UPSTREAM_UNREACHABLE` | 502 | host unreachable |

Local validation errors are `ApiError` with code `BAD_REQUEST` (HTTP 400),
`CREDENTIALS_MISSING` (400) and `TOOL_ERROR` (422 for a tool-level failure).

## Auth flow

```text
                 routestack-web (server)                    RouteStack MCP (production)
 ┌──────────┐   ┌──────────────────────────────┐            ┌───────────────────────────────┐
 │ Browser  │   │ loadConfig()                  │            │                               │
 │ public/* │──▶│  apiKey + apiSecret           │            │                               │
 └──────────┘   │                               │            │                               │
                │ 1) HMAC-SHA256(apiSecret,     │  POST      │ /mcp/auth/partner-token       │
                │    `${apiKey}:${ts}:${nonce}`)│──────────▶ │   → { token, expiresIn }      │
                │    → base64url                 │            │                               │
                │                               │            │                               │
                │ 2) Authorization: Bearer JWT  │  POST      │ /mcp                          │
                │    JSON-RPC initialize        │──────────▶ │   → session-id                │
                │                               │  POST      │                               │
                │    notifications/initialized  │──────────▶ │   → 202 (no body)             │
                │                               │  POST      │                               │
                │    tools/call {name,args}      │──────────▶ │   → result payload            │
                │                               │            │                               │
                │  JWT cached in memory until   │            │                               │
                │  60s before `exp`             │            │                               │
                └──────────────────────────────┘            └───────────────────────────────┘
```

Steps:

1. **Partner-token mint** — `POST /mcp/auth/partner-token` with
   `{apiKey, hmac, timestamp, nonce}`, where
   `hmac = base64url(HMAC_SHA256(apiSecret, apiKey + ":" + timestamp + ":" + nonce))`.
   Response carries a JWT (`expiresIn` typically `24h`).
2. **MCP session** — JSON-RPC over Streamable HTTP:
   `initialize` (returns `mcp-session-id`) → `notifications/initialized` →
   `tools/list` / `tools/call`. The JWT is sent as `Authorization: Bearer <jwt>`
   and the session id as `mcp-session-id`.
3. **Caching** — the JWT is cached in memory keyed by `baseUrl|authMode|apiKey-fingerprint`
   and re-minted 60 s before expiry; a 401 invalidates the session and retries once.

Alternative mode `authMode: "header"` sends `X-Api-Key` + `X-Account-Id` instead
of minting a JWT (requires `ROUTESTACK_ACCOUNT_ID`).

## Endpoints

### Meta

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | liveness |
| GET | `/api/config` | browser-safe config (secrets masked) |
| POST | `/api/config` | save a config patch (secrets only overwritten when non-empty) |
| DELETE | `/api/config` | remove stored credentials |
| POST | `/api/config/test` | live test: partner-token mint + `tools/list` |

### Hotels

| Method | Path | Tool | Billable |
|---|---|---|---|
| POST | `/api/hotels/destinations` | `search_destinations` | no |
| POST | `/api/hotels/search` | `hotel_search` | **yes** |
| POST | `/api/hotels/rooms` | `hotel_get_rooms_and_rates` | no |
| POST | `/api/hotels/revalidate` | `hotel_revalidate_rate` | no |
| POST | `/api/hotels/details` | `hotel_get_details` | no |
| POST | `/api/hotels/checkout` | `hotel_get_checkout_url` | no |

Destination autocomplete — request / response:

```bash
curl -s -X POST localhost:8787/api/hotels/destinations \
  -H 'content-type: application/json' --data '{"query":"Rome"}'
```

```json
{
  "ok": true,
  "data": {
    "results": [
      { "destinationId": "ChIJw0rXGxGKJRMRAIE4sppPCQM", "name": "Rome", "type": "City", "country": "Italy" }
    ]
  },
  "meta": { "source": "production", "tool": "search_destinations" }
}
```

Hotel search — request (billable):

```bash
curl -s -X POST localhost:8787/api/hotels/search \
  -H 'content-type: application/json' \
  --data '{
    "destinationId": "ChIJw0rXGxGKJRMRAIE4sppPCQM",
    "destinationType": "City",
    "checkIn": "2027-08-20",
    "checkOut": "2027-08-25",
    "roomCount": 1,
    "adults": 2,
    "currency": "EUR"
  }'
```

Response (abridged) — includes the session handles used by the free follow-ups:

```json
{
  "ok": true,
  "data": {
    "hotels": [ { "hotelId": "…", "name": "…", "price": 210.5, "currency": "EUR" } ],
    "count": 12,
    "status": "InProgress",
    "correlationId": "…",
    "token": "…",
    "nextResultsKey": "…"
  },
  "meta": { "source": "production", "tool": "hotel_search" }
}
```

Rooms → revalidate → checkout (all free) continue from `hotelId` /
`recommendationId` / `correlationId` / `token`:

```json
// POST /api/hotels/checkout  →  data
{ "url": "https://mcp.routestack.ai/checkout/r/…", "checkoutMode": "deeplink" }
```

### Flights

| Method | Path | Tool | Billable |
|---|---|---|---|
| POST | `/api/flights/session` | `flight_session` | no |
| POST | `/api/flights/locations` | `flight_locations` | no |
| POST | `/api/flights/search` | `flight_search` | **yes** |
| POST | `/api/flights/revalidate` | `flight_revalidate` | no |
| POST | `/api/flights/checkout` | `flight_get_checkout_url` | no |

Airport autocomplete:

```bash
curl -s -X POST localhost:8787/api/flights/locations \
  -H 'content-type: application/json' --data '{"term":"MXP"}'
```

```json
{ "ok": true, "data": { "locations": [ { "code": "MXP", "name": "Malpensa" } ] }, "meta": { "tool": "flight_locations" } }
```

Flight search — request (billable):

```bash
curl -s -X POST localhost:8787/api/flights/search \
  -H 'content-type: application/json' \
  --data '{
    "tripType": "OneWay",
    "origin": "MXP",
    "destination": "BKK",
    "departureDate": "2027-08-20",
    "adults": 1,
    "cabinClass": "Economy"
  }'
```

Response (abridged):

```json
{
  "ok": true,
  "data": {
    "flights": [ { "price": 489.34, "currency": "EUR", "airline": "…" } ],
    "count": 420,
    "status": "Complete"
  },
  "meta": { "source": "production", "tool": "flight_search" }
}
```

MultiCity search — request (billable). When `tripType` (or `type`) is
`MultiCity` the itinerary lives in `destinations` and the top-level
`origin`/`destination`/`departureDate`/`returnDate` are omitted. Each leg uses
the exact keys from the `flight_search` leg schema — `origin`, `destination` and
**`departureDate`** (a leg has no `returnDate`; the server also accepts the UI
alias `date` and normalises it to `departureDate`). At least **two** complete
legs are required:

```bash
curl -s -X POST localhost:8787/api/flights/search \
  -H 'content-type: application/json' \
  --data '{
    "tripType": "MultiCity",
    "destinations": [
      { "origin": "MXP", "destination": "BKK", "departureDate": "2027-08-20" },
      { "origin": "BKK", "destination": "SYD", "departureDate": "2027-08-27" },
      { "origin": "SYD", "destination": "AKL", "departureDate": "2027-09-03" }
    ],
    "adults": 1,
    "cabinClass": "Economy"
  }'
```

The server forwards each leg to the tool as `{ origin, destination,
departureDate }` (legs missing any of the three are dropped). A MultiCity body
with fewer than two valid legs is rejected locally with HTTP 400 `BAD_REQUEST`
(`MultiCity richiede almeno 2 tratte valide: origine, destinazione e data per
ogni tratta.`) before any upstream call. `/api/flights/search` caches the legs
so the free `/api/flights/checkout` can forward `destinations` together with the
selected `flight` itinerary.

### Cars

| Method | Path | Tool | Billable |
|---|---|---|---|
| POST | `/api/cars/locations` | `car_locations` | no |
| POST | `/api/cars/search` | `car_search` | **yes** |
| POST | `/api/cars/revalidate` | `car_revalidate` | no |
| POST | `/api/cars/checkout` | `car_get_checkout_url` | no |

Location lookup:

```bash
curl -s -X POST localhost:8787/api/cars/locations \
  -H 'content-type: application/json' --data '{"term":"MXP"}'
```

Car search — request (billable):

```bash
curl -s -X POST localhost:8787/api/cars/search \
  -H 'content-type: application/json' \
  --data '{
    "pickup":  {"name":"Malpensa Airport","code":"MXP","date":"2027-08-20","time":"10:00"},
    "dropoff": {"name":"Malpensa Airport","code":"MXP","date":"2027-08-25","time":"10:00"},
    "filters": {"adults": 1}
  }'
```

Response (abridged; the server wraps the body into the MCP `filter` envelope):

```json
{
  "ok": true,
  "data": {
    "offers": [
      {
        "offerId": "…",
        "fareCode": "…",
        "model": "Volkswagen UP, Peugeot 107 or similar",
        "carType": "Mini Car",
        "supplier": "Green Motion",
        "price": 203.67,
        "currency": "USD",
        "prepaid": true
      }
    ],
    "count": 17,
    "status": "Complete",
    "correlationId": "…",
    "currency": "EUR"
  },
  "meta": { "source": "production", "tool": "car_search" }
}
```
