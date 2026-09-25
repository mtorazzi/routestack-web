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

## Check 13 — frontend syntax regression

The 38-test suite only covered pure modules, so a real defect class shipped
unnoticed: the view layer did not parse. `node --check` on `public/**/*.js`
failed on **5** files.

1. `public/components/dom.js` — the JSDoc line
   `@param {object} [props] class/text/html/attrs/dataset/on*/DOM props`
   contained `*/` inside the comment text, closing the block early and leaving
   `DOM props` as stray code (`SyntaxError: Unexpected identifier 'props'`).
   Reworded to `…/on* handler props / DOM props`; no behaviour change.
2. `public/views/flights.js`, `public/views/hotels.js`, `public/views/cars.js`
   and `public/views/settings.js` each imported `render` from
   `../components/dom.js` *and* declared `export function render(ctx)`, which is
   a duplicate binding (`SyntaxError: Identifier 'render' has already been
   declared`). The DOM helper is now aliased as `render as renderNodes` and
   every internal call site that meant the helper was updated, while
   `export function render(ctx)` and `export default { render }` are unchanged
   (`public/app.js` still calls `flightsView.render`, etc.).

An additional latent defect surfaced once the views could be imported: `cars.js`
/`flights.js`/`hotels.js` imported `skeletonGrid` from `../components/results.js`,
but it is actually exported by `../components/states.js`, so `import()` of those
views threw `does not provide an export named 'skeletonGrid'`. The import was
corrected to source `skeletonGrid` from `states.js`.

New regression guard `test/frontend-modules.test.js` runs `node --check` over
every `.js` under `public/` (exit code 0, offending file named on failure), then
`await import()`s every module except `public/app.js` (which touches the DOM at
import time and is therefore syntax-checked only), and asserts the four view
modules still expose a callable `render` via both named and default export.

Verification: `for f in $(find public -name '*.js'); do node --check "$f" || echo
"SYNTAX FAIL $f"; done` prints nothing; `npm test` is **41/41** green; a smoke
server on `PORT=8799 HOST=127.0.0.1` returned **200** for `/`, `/app.js`,
`/router.js`, `/components/dom.js`, the four `/views/*.js` and
`/styles/tokens.css`.

## Check 14 — settings credential save (first entry)

**Bug (read from the code, then fixed):** on a fresh install nothing is
configured, so `maskConfig()` reports `apiKeySet:false` /
`apiSecretSet:false`. `public/views/settings.js#secretField` renders those
fields editable, but the "Modifica" button (which flips `state.editing.*`) is
only added `if (set)`. `state.editing` therefore stays
`{apiKey:false,apiSecret:false,accountId:false}` and the inline submit logic

```js
if (state.editing.apiKey && values.apiKey) patch.apiKey = values.apiKey;
if (state.editing.apiSecret && values.apiSecret) patch.apiSecret = values.apiSecret;
if (state.editing.accountId) patch.accountId = values.accountId || null;
```

never copied the typed secrets into the patch. `POST /api/config` saved only
preferences, the server kept `apiKeySet:false`, and the UI still announced
*"Impostazioni salvate."* — the first API key + secret were silently discarded.
(Editing an already-saved value worked, which is why it went unnoticed.)

**Fix:** the patch is now built by a pure, unit-tested helper
`buildConfigPatch(values, editing)` in `public/components/params.js`. It always
sends `authMode`, `baseUrl`, `sandbox`, `currency`, `timeoutMs`; includes
`apiKey` / `apiSecret` whenever the submitted value is a non-empty string
(regardless of `editing`); includes `accountId` for a non-empty value and emits
the explicit clear `accountId:null` only while `editing.accountId` is true;
never emits an `undefined`/`''` secret. `public/views/settings.js` was switched
to that helper and the inline logic removed; test connection, remove credentials
and re-render after save are unchanged.

**Regression test (written first, observed failing):** `buildConfigPatch` did
not yet exist, so `npm test` failed with
`does not provide an export named 'buildConfigPatch'`. After the fix the four
new assertions in `test/frontend-params.test.js` cover: first entry with
`editing` all-false saves both secrets; untouched (`''`) secrets are omitted;
`editing.accountId = true` + empty value yields `accountId:null`; `sandbox`
stays a real boolean. `npm test` → **45/45** green and
`for f in $(find public -name '*.js'); do node --check "$f"; done` prints
nothing.

**Live round-trip** (throw-away copy `/tmp/rs-cfgtest`, clean env with
`ROUTESTACK_*` unset, no billable call — `POST/DELETE /api/config` only; copy
deleted afterwards):

```bash
cp -r /root/Projects/routestack-web /tmp/rs-cfgtest
rm -f /tmp/rs-cfgtest/config/secrets.json
cd /tmp/rs-cfgtest
env -u ROUTESTACK_API_KEY -u ROUTESTACK_API_SECRET -u ROUTESTACK_ACCOUNT_ID \
    -u ROUTESTACK_BASE_URL PORT=8801 HOST=127.0.0.1 node server/index.js &
```

`GET /api/config` before, `POST` the test credentials, `GET` again, `DELETE`,
`GET` again:

```text
BEFORE      apiKeySet:false apiSecretSet:false
POST        HTTP 200
AFTER POST  apiKeySet:true  apiSecretSet:true  apiKey:"rst_…1234" apiSecret:"test…1234"
DELETE      HTTP 200
AFTER DEL   apiKeySet:false apiSecretSet:false
```

The values come back **masked** (`rst_…1234`, `test…1234`) and never in clear;
the test credentials used are synthetic (`rst_TESTKEY1234` /
`test-secret-1234`) and the copy was removed. No real `ROUTESTACK_*` value was
ever printed.
