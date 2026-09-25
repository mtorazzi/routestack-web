# Verification — live proofs

All checks below were run against the **production** RouteStack MCP endpoint
(`https://mcp.routestack.ai/mcp`) with real credentials supplied via environment
variables. No secret value, API key, API secret or full JWT is reproduced here:
credentials are read from `ROUTESTACK_API_KEY` / `ROUTESTACK_API_SECRET` (and,
for the `header` auth mode, `ROUTESTACK_ACCOUNT_ID`).

Test suite: `npm test` → **38/38 pass**.

## Summary

| # | Check | Result |
|---|---|---|
| 1 | partner-token mint (`POST …/auth/partner-token`) | HTTP 200, JWT len 183, `expiresIn 24h` |
| 2 | MCP `initialize` → `notifications/initialized` → `tools/list` | 200, **30 tools** |
| 3 | `POST /api/config/test` | `mintStatus 200`, `tokenLength 183`, `toolsCount 30` |
| 4 | `POST /api/hotels/destinations` `{"query":"Rome"}` | 5 righe |
| 5 | `POST /api/flights/locations` `{"term":"MXP"}` | Malpensa |
| 6 | `POST /api/cars/locations` `{"term":"MXP"}` | Malpensa Airport |
| 7 | `POST /api/hotels/search` Roma 2027-08-20→25, 1 camera / 2 adulti, EUR | 200, `count 12`, `status InProgress`, `correlationId`+`token`+`nextResultsKey` |
| 8 | `POST /api/hotels/rooms` → `/revalidate` → `/checkout` | 200, `checkoutMode deeplink`, `https://mcp.routestack.ai/checkout/r/…` |
| 9 | `POST /api/flights/search` MXP→BKK 2027-08-20, 1 adulto, Economy, OneWay | 200, `count 420`, `status Complete`, più economica `489.34` |
| 10 | `GET /api/config` masking | né `apiKey` né `apiSecret` in chiaro |
| 11 | sandbox `evolvemcp.routestack.ai` | 401 con queste credenziali → solo produzione |
| 12 | `POST /api/cars/search` Malpensa MXP 2027-08-20→25 (round 4) | 200, `count 17`, `status Complete`, più economica `203.67 USD` |

Checks 1–11 were proven in earlier sessions and are **not re-run** here (each
`hotel_search` / `flight_search` / `car_search` consumes live inventory — two of
the three billable calls were already spent). Check 12 is the one remaining
billable call and is documented in full below.

## Check 12 — car search (the remaining billable call)

The billable call was made **once**, through the local server:

```bash
cd /root/Projects/routestack-web
PORT=8798 HOST=127.0.0.1 node server/index.js &   # background

curl -s --max-time 90 -o /tmp/opencode/car-search.json -w "HTTP_STATUS:%{http_code}\n" \
  -X POST localhost:8798/api/cars/search \
  -H 'content-type: application/json' \
  --data '{
    "pickup":  {"name":"Malpensa Airport","code":"MXP","date":"2027-08-20","time":"10:00"},
    "dropoff": {"name":"Malpensa Airport","code":"MXP","date":"2027-08-25","time":"10:00"},
    "filters": {"adults": 1}
  }'
```

Observed:

```text
HTTP_STATUS:200
ok: true | count: 17 | status: Complete
```

Cheapest offer (computed from the response):

```json
{
  "model": "Volkswagen UP, Peugeot 107 or similar",
  "type": "Mini Car",
  "supplier": "Green Motion",
  "price": 203.67,
  "currency": "USD",
  "prepaid": true
}
```

Notes:

- `correlationId` was returned (36 chars) and stored in the server-side session
  cache for a possible `/revalidate` + `/checkout` (both free).
- Prices come back in **USD** here (the upstream `price_prepaid.currency`), even
  though the request did not pin a currency; the UI reports the offer currency.
- **Port:** `8799` was already held by a stale process from the earlier
  concurrent session, which this run must not touch. The local server was
  therefore started on `8798` for the live proof. The behaviour is identical.
- **Latent bug fixed:** `car_search` (like `flight_search`) requires a top-level
  `filter` object. `server/routes/cars.js` sent flat args, which would have
  failed / wasted the billable call. It now wraps the args:

  ```js
  const r = await cars.search({ filter: args });
  ```

  See commit `fix(cars): wrap car_search args in filter envelope`.

## Reproducing the read-only checks (no billable call)

```bash
cd /root/Projects/routestack-web
PORT=8798 HOST=127.0.0.1 node server/index.js &

curl -s localhost:8798/api/health                       # {"ok":true}
curl -s -X POST localhost:8798/api/config/test          # mint + tools/list
curl -s -X POST localhost:8798/api/hotels/destinations \
     -H 'content-type: application/json' --data '{"query":"Rome"}'
curl -s -X POST localhost:8798/api/flights/locations \
     -H 'content-type: application/json' --data '{"term":"MXP"}'
curl -s -X POST localhost:8798/api/cars/locations \
     -H 'content-type: application/json' --data '{"term":"MXP"}'
```

`GET /api/config` masking check (must print `0`):

```bash
curl -s localhost:8798/api/config | grep -c "<apiKey value>"   # 0
```

## Sandbox

The sandbox host `evolvemcp.routestack.ai` responds **401** with these
credentials, so all proofs above are production-only. Toggle with
`config/secrets.json` → `"sandbox": true` (or leave `false`).
