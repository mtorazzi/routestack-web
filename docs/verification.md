# Verification — live proofs

All checks below were run against the **production** RouteStack MCP endpoint
(`https://mcp.routestack.ai/mcp`) with real credentials supplied via environment
variables. No secret value, API key, API secret or full JWT is reproduced here:
credentials are read from `ROUTESTACK_API_KEY` / `ROUTESTACK_API_SECRET` (and,
for the `header` auth mode, `ROUTESTACK_ACCOUNT_ID`).

Test suite: `npm test` → **93/93 pass** (latest additions in Check 20).

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

## Check 15 — static assets are no-store / settings save E2E

**Bug (diagnosed from the deployed instance):** the server served assets with
`express.static(publicDir, { extensions: ['html'], maxAge: 0 })`, which emits
`Cache-Control: public, max-age=0`. That still permits browser/proxy
revalidation caching, so after the Check 14 fix was committed the deployed
browser kept executing the **previous** `settings.js` bundle. The live process
proved it: the stale `POST /api/config` wrote a `config/secrets.json` containing
only `{"sandbox": false}` — a patch that **neither** the old nor the new
`settings.js` builds — so the first API key + secret were silently dropped and
the UI still said *"Impostazioni salvate."*.

**Fix:** `server/index.js` now disables validator/caching metadata for every
static asset and for the SPA catch-all:

```js
app.use(
  express.static(publicDir, {
    extensions: ['html'],
    etag: false,
    lastModified: false,
    setHeaders: (res) => res.setHeader('cache-control', 'no-store, must-revalidate'),
  }),
);

app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'), {
    headers: { 'cache-control': 'no-store, must-revalidate' },
  });
});
```

Routing and the API are unchanged.

**Regression test:** `test/static-cache.test.js` boots `createApp()` on an
ephemeral port and asserts `cache-control: no-store` for `/`, `/app.js`,
`/views/settings.js`, `/styles/tokens.css` and the SPA catch-all
`/impostazioni`. `npm test` → **46/46** green.

**Header proof.** The task asked to run on `PORT=8799 HOST=127.0.0.1`, but in
this environment 8799 is held by the pre-existing deployed instance, which the
hard rule forbids killing. It still serves the old header (which is exactly the
diagnosis):

```text
# pre-existing deployed instance on 8799 — left untouched
/app.js             Cache-Control: public, max-age=0
/                   Cache-Control: public, max-age=0
/views/settings.js  Cache-Control: public, max-age=0
```

The new code was started on a free port (8797) and probed with the exact
`curl -sI` commands:

```text
curl -sI localhost:8797/app.js            -> cache-control: no-store, must-revalidate
curl -sI localhost:8797/                  -> cache-control: no-store, must-revalidate
curl -sI localhost:8797/views/settings.js -> cache-control: no-store, must-revalidate
curl -sI localhost:8797/impostazioni      -> cache-control: no-store, must-revalidate
```

(After the deploy restarts the 8799 instance it will serve these same headers.)

**Settings save E2E** (throw-away copy `/tmp/rs-cfgtest`, clean env with
`ROUTESTACK_*` unset, no billable call; copy deleted afterwards). Port 8801 from
the previous round is also held by a leftover process and was not touched; 8813
was used:

```bash
cp -r /root/Projects/routestack-web /tmp/rs-cfgtest
rm -f /tmp/rs-cfgtest/config/secrets.json
cd /tmp/rs-cfgtest
env -u ROUTESTACK_API_KEY -u ROUTESTACK_API_SECRET -u ROUTESTACK_ACCOUNT_ID \
    -u ROUTESTACK_BASE_URL PORT=8813 HOST=127.0.0.1 node server/index.js
```

`POST /api/config` with the exact first-entry browser body
(`authMode`, `baseUrl`, `sandbox`, `currency`, `timeoutMs`, `apiKey`,
`apiSecret`), then `GET`, file inspection, `DELETE`, `GET`:

```text
BEFORE      apiKeySet:false apiSecretSet:false
POST        HTTP 200
AFTER POST  apiKeySet:true apiSecretSet:true apiKey:"dumm…1234" apiSecret:"dumm…1234" timeoutMs:30000
FILE        keys:apiKey,apiSecret,authMode,baseUrl,currency,sandbox,timeoutMs
DELETE      HTTP 200
AFTER DEL   apiKeySet:false apiSecretSet:false
E2E OK
```

The written `config/secrets.json` contains **all** the required fields
(`authMode`, `baseUrl`, `currency`, `timeoutMs`, `apiKey`, `apiSecret`) plus
`sandbox`; `GET /api/config` returns the secrets **masked** (`dumm…1234`) and
never in clear; `DELETE` returns to unset. Only synthetic dummy credentials
(`dummy-key-1234` / `dummy-secret-1234`) inside the throw-away copy were used and
no real `ROUTESTACK_*` value was ever printed.

## Check 16 — Salva button was outside the form

**Symptom:** the user pressed "Salva" and nothing happened — no save, in a
normal window *and* in incognito. A fresh load produced **no** `POST /api/config`
at all (the last server-side write predated the click); the backend save path
was already proven correct by Check 14.

**Repro (pre-fix code):** `public/views/settings.js` built the action row as

```js
const actions = el('div', { class: 'row' }, testBtn, saveBtn, removeBtn);
const panel = el('section', { class: 'panel' }, el('h2', …), form, el('hr', …), actions, testResult);
```

`saveBtn` was `type="submit"` but sat **outside** the `<form>` and had no `form`
attribute. A submit button only submits its ancestor form (or the form named by
its `form` attribute), so the click never submitted and the `form.addEventListener('submit', …)`
listener never ran.

**Fix:**

- `saveBtn` stays `type="submit"` and now also carries `attrs: { form: FORM_ID }`,
  with `const FORM_ID = 'settings-form'`; `testBtn` / `removeBtn` stay `type="button"`.
- The `<form>` gets `id="settings-form"`.
- The action row and the test result are rendered **inside** the form as its last
  children (`fieldsets → <hr> → buttons → test result`). Visual order and classes
  are unchanged.
- Success feedback verified: the handler re-renders and announces
  `Impostazioni salvate.` (on failure it announces `Errore: <titolo>.`).

**Regression test:** `test/settings-dom.test.js` loads `public/views/settings.js`
in Node against a minimal DOM stub (`createElement`, `createElementNS`,
`createTextNode`, `append`, `setAttribute`, `querySelectorAll`, `addEventListener`,
`dispatchEvent`, `classList`, `dataset`), renders the view with a stub `ctx`, then:

- asserts `form.querySelector('button[type="submit"]')` is **not null** (the
  structural invariant — this assertion fails on the pre-fix code);
- fills the `apiKey` / `apiSecret` inputs, dispatches a real `submit` event and
  asserts the captured `POST /api/config` body contains both fields and that the
  announce text is `Impostazioni salvate.`.

Verified on the pre-fix code by stashing only `public/views/settings.js`: the test
fails at the structural assertion; with the fix restored it passes.

```text
node --test test/settings-dom.test.js  -> tests 1, pass 1, fail 0
npm test                               -> tests 47, pass 47, fail 0
for f in $(find public -name '*.js'); do node --check "$f"; done  -> no output
```

**Served asset** (what the browser actually downloads) shows the buttons inside
the form:

```bash
curl -s localhost:8802/views/settings.js | grep -c saveBtn   # -> 4
```

```js
    const saveBtn = el('button', { class: 'btn btn--primary', type: 'submit', attrs: { form: FORM_ID } }, /* … */ 'Salva');
    const actions = el('div', { class: 'row' }, testBtn, saveBtn, removeBtn);
    const form = el(
      'form',
      { class: 'form', attrs: { novalidate: '', id: FORM_ID } },
      fieldset('Autenticazione', […]),
      fieldset('Connessione', […]),
      fieldset('Preferenze', […]),
      el('hr', { class: 'divider' }),
      actions,
      testResult,
    );
```

**Port note:** `8799` is held by a pre-existing process that this session must
not touch, so the live check used `8802` and the instance was stopped afterwards.
Only synthetic dummy values (`dummy-key-1234` / `dummy-secret-1234`) were used; no
real credential appears in this document.

## Check 17 — flight checkout requires the itinerary context

**Symptom (from the UI):**

```text
Si è verificato un errore: flight_get_checkout_url: flight, origin, destination,
departureDate, and adults are required
```

**Diagnosis.** `public/views/flights.js` built the checkout body with
`fareSourceCode`, `origin`, `destination`, `departureDate`, `returnDate`,
`adults`, `children`, `infants`, `searchFilterObj`, `correlationId` and
`sessionId` — but never the selected offer's `flight` itinerary object. The
upstream `flight_get_checkout_url` tool requires `flight` + `origin` +
`destination` + `departureDate` + `adults`; without `flight` it cannot resolve
the fare and reports all five as missing.

**Fix.**

- **Client** (`public/views/flights.js`): the checkout body now includes the
  selected offer's raw itinerary, which `normalizeFlightOffer` already kept as
  `offer.raw`:

  ```js
  const { data } = await apiV.checkout({
    fareSourceCode: offer.fareSourceCode,
    flight: offer.raw,
    …
  });
  ```

- **Server** (`server/routes/flights.js` + `server/routestack/verticals.js`):
  `/api/flights/search` now caches the search context (`origin`, `destination`,
  `departureDate`, `returnDate`, `adults`, `children`, `infants`, `cabinClass`,
  `tripType`, `searchFilterObj`, `correlationId`, flight `sessionId`) **and** the
  returned offers keyed by `fareSourceCode`, next to `rememberFlightSession`
  (`rememberFlightSearch` / `getFlightSearch` / `findFlightOffer`). On checkout
  the explicit request body wins and the cache fills the gaps, including
  `flight` looked up by `fareSourceCode`. The existing `clean()` still drops
  every empty value before forwarding.

- **Cars audit** (`server/routes/cars.js` + `server/routestack/verticals.js`):
  `car_get_checkout_url` requires the raw `car` row. The client already forwarded
  `offer.raw`, but the server was not self-sufficient, so `/api/cars/search` now
  caches the pickup/dropoff context and the raw offers keyed by `fareCode` /
  `offerId` (`rememberCarSearch` / `getCarSearch` / `findCarOffer`) and checkout
  merges them the same way. **Hotels** already pass
  `token` + `recommendationId` + `roomId` and were proven live (Check 8); left
  unchanged.

**Offline proof (mandatory, no billable call).** `test/checkout-payload.test.js`
boots the real Express app with the MCP client replaced by a stub through the
`__setClientFactory` seam. The stub records every `tools/call`, so no network —
and therefore no billable `/search` — is ever contacted. The tests assert the
exact payload forwarded upstream:

- flight checkout with **only** `fareSourceCode` + cached search context →
  forwarded args contain non-empty `fareSourceCode`, `flight` (the raw itinerary),
  `origin`, `destination`, `departureDate`, `adults`, plus the cached
  `searchFilterObj` / `correlationId` / `sessionId`;
- flight checkout with an explicit body → the body wins over the cache
  (`origin`/`destination`/`departureDate`/`adults`/`flight`);
- car checkout with only `offerId` + `fareCode` → forwards the cached raw `car`
  row and the cached `correlationId`;
- hotel checkout → keeps `token` + `recommendationId` + `correlationId`.

Results:

```text
node --test test/checkout-payload.test.js  -> tests 4, pass 4, fail 0
npm test                                   -> tests 51, pass 51, fail 0
for f in $(find public -name '*.js'); do node --check "$f"; done  -> no output
```

**Live end-to-end checkout was NOT re-run.** It requires a billable
`flight_search` (and, to reach `flight_get_checkout_url`, the selected fare),
which this round is explicitly forbidden; the payload shape is instead proven
offline against the stubbed `tools/call` arguments.

## Check 18 — MultiCity support

**Contract (confirmed, free — no billable call).** `flight_search` accepts
`filter.type` / `filter.tripType` = `MultiCity` and then requires a
`destinations` array with **at least two segments** (production `tools/list`
dump kept at `/tmp/opencode/tools-prod.json`). Each segment carries the same
origin/destination aliases as the top-level filter
(`origin`/`from`/`departureCity`/`departureAirport`,
`destination`/`to`/`arrivalCity`/`arrivalAirport`) plus the leg date key
**`departureDate`** — a leg has **no** `returnDate`. The code uses exactly
`origin`, `destination` and `departureDate`; the local server additionally
accepts the UI alias `date` and normalises it to `departureDate`.

**Shape.**

- `public/components/params.js#buildFlightSearchArgs`: for `MultiCity` emits
  `{ tripType: 'MultiCity', destinations: [{ origin, destination, departureDate }, …],
  adults, children, infants, cabinClass, filters, sortBy, limit }` and omits the
  top-level `origin`/`destination`/`departureDate`/`returnDate`. OneWay/RoundTrip
  are unchanged (verified by test).
- `missingRequired('flights', …)`: for MultiCity requires the cabin class and,
  per leg, origin, destination and date, with per-leg Italian messages
  (`tratta 2: destinazione`).
- `public/views/flights.js`: the trip-type radio gained
  **`Più tratte (MultiCity)`** and a leg editor of **2–5** legs. Each leg is a
  labelled `<fieldset><legend>Tratta N</legend>` with origin/destination
  autocomplete (`POST /api/flights/locations`) and a date; `Rimuovi` is hidden
  on legs 1–2 and `Aggiungi tratta` disables at 5. Leg 1 seeds from the
  single-itinerary fields; the single origin/destination/date/return-date fields
  are hidden **and** disabled while MultiCity is active, then restored.
- `server/routes/flights.js#buildFilter`: forwards sanitised `destinations`
  (only legs with origin + destination + departureDate) and omits the top-level
  itinerary; `< 2` valid legs → HTTP 400 `BAD_REQUEST` with the Italian message,
  thrown **before** the free session bootstrap (so no upstream call at all).
  OneWay/RoundTrip keep the existing origin/destination/departureDate
  requirements.
- Checkout: `rememberFlightSearch` now stores `destinations`;
  `/api/flights/checkout` forwards them plus the raw `flight` itinerary looked
  up by `fareSourceCode`, and derives the first/last leg
  origin/destination/date so the itinerary stays complete.

**Why the live search was not re-run.** A live MultiCity `flight_search` is
**billable**, and this round forbids billable calls (not even one). The request
shape, the local 400 guard and the checkout forwarding are proven offline
against the `__setClientFactory` stub, which captures every `tools/call`
without any network.

**Offline proof.**

```text
for f in $(find public -name '*.js'); do node --check "$f"; done  -> no output
node --test test/frontend-params.test.js   -> MultiCity build + validation green
node --test test/flights-filter.test.js    -> MultiCity filter + 400 guard green
node --test test/checkout-payload.test.js  -> MultiCity checkout context green
npm test                                   -> tests 62, pass 62, fail 0
```

The new/updated tests assert: 3 legs → `destinations.length === 3` with no
top-level origin/destination and `tripType:'MultiCity'`; OneWay/RoundTrip
unchanged; `missingRequired` names the first incomplete leg and passes a complete
itinerary; `buildFilter` rejects `< 2` valid legs with `BAD_REQUEST` while
OneWay/RoundTrip still require origin/destination/departureDate; and a stubbed
MultiCity search followed by `/checkout` forwards `destinations` + `flight`.

**Smoke (`PORT=8799 HOST=127.0.0.1`, no billable call).** The local server was
started and a 1-leg MultiCity body posted; validation runs before the session
bootstrap, so nothing reaches RouteStack:

```text
fonte: production (https://mcp.routestack.ai/mcp)
/api/health -> {"ok":true}

POST /api/flights/search
  {"tripType":"MultiCity",
   "destinations":[{"origin":"MXP","destination":"BKK","departureDate":"2027-08-20"}],
   "adults":1,"cabinClass":"Economy"}

HTTP_STATUS:400
{"ok":false,"error":{"code":"BAD_REQUEST",
 "message":"MultiCity richiede almeno 2 tratte valide: origine, destinazione e data per ogni tratta.",
 "upstreamStatus":null},"meta":{"path":"/api/flights/search","method":"POST"}}
```

The server was stopped afterwards; no credential value was printed (startup logs
only the masked key). The live proof in Check 9 still covers the single
itinerary search; the MultiCity live search remains deliberately unspent.

## Check 19 — search timeouts and billed-call wording

**Incident.** A **MultiCity** flight search launched from the UI failed after
30 s with

```text
RouteStack: timeout dopo 30000 ms.        (code UPSTREAM_TIMEOUT)
```

while RouteStack **still counted the billable call**. Root cause: a single
`config.timeoutMs` (default `30_000`) was used for every MCP call, but long-haul
/ multi-leg searches legitimately need 30–120 s+ (a single-leg MXP→BKK search
had already measured **29.3 s**). The error text also did not tell the user the
call may have been billed and may still be running.

**Values.**

| Field | Default | Scope |
|---|---|---|
| `timeoutMs` | `60000` (was `30000`) | general MCP calls (mint, autocomplete, revalidate, checkout) |
| `searchTimeoutMs` | `180000` | the three billable searches, clamped to **30000–600000** |

`searchTimeoutMs` is threaded through `run(tool, args, normalize, { timeoutMs })`
→ `McpClient.callTool(name, args, { timeoutMs, billable })` → `#post(...)`; the
`search` methods of `hotels` / `flights` / `cars` pass it, everything else keeps
the general timeout.

**Never retry a timeout.** Only the 401 / session-expiry branches of
`McpClient.callTool` re-issue the call. An abort throws `UPSTREAM_TIMEOUT`
directly, so a retry can never fire a second billable search (explicit comment in
`server/routestack/mcp.js`).

**Honest wording.** For the three searches the timeout message is
`RouteStack non ha risposto entro <N> s. La ricerca potrebbe essere ancora in
corso e la chiamata è stata conteggiata: attendi prima di ripetere.` with
`code: UPSTREAM_TIMEOUT`, `status: 504` and `meta.billable = true`
(`errorEnvelope` now merges `ApiError.meta`). `public/components/api.js`
propagates the envelope `meta` and `humanError()` maps it to
**“Ricerca non conclusa in tempo”** + the advice to wait a few minutes.

**UI.** `public/views/{flights,hotels,cars}.js` show the elapsed seconds next to
the spinner (`Ricerca in corso… 24s`) and a reserved-height `aria-live="polite"`
line *“Le ricerche lunghe possono richiedere 1–3 minuti: attendi senza
ripetere.”* (`startSearchClock`/`LONG_SEARCH_HINT` in
`public/components/states.js`); the clock is stopped in the `finally` branch, so
there is no layout jump and no leak. `public/views/settings.js` exposes
`searchTimeoutMs` (*Timeout ricerca (ms)*, min 30000, max 600000, step 30000)
next to `timeoutMs`; `buildConfigPatch` forwards it.

**Offline proofs (no billable call).** `test/search-timeout.test.js` (10 tests):

- `loadConfig()` defaults → `timeoutMs 60000`, `searchTimeoutMs 180000`; an
  injected temp `secrets.json` value (90 000) wins; 999 999 → 600 000; 1 000 →
  30 000; `maskConfig()` includes it; `buildConfigPatch` forwards it.
- with the `__setClientFactory` stubbed transport, `/api/hotels/search`,
  `/api/flights/search` and `/api/cars/search` go out with `180000`, while
  `/api/hotels/destinations` falls back to the general `60000`.
- a `fetch` stub that hangs: `flight_search` with a 50 ms per-call timeout throws
  `UPSTREAM_TIMEOUT` with `meta.billable === true`, and the transport is called
  **exactly once** (no retry); a non-billable tool keeps the generic message and
  no billable meta.
- `errorEnvelope` surfaces `meta.billable` through the real Express error
  middleware (HTTP 504).
- `humanError()` on a billable timeout → title *“Ricerca non conclusa in tempo”*.

```text
node --test test/search-timeout.test.js -> tests 10, pass 10, fail 0
npm test                                -> tests 72, pass 72, fail 0
for f in $(find public -name '*.js'); do node --check "$f"; done -> no output
```

**Smoke (`PORT=8799 HOST=127.0.0.1`, no billable call).**

```text
/api/config -> timeoutMs= 60000 searchTimeoutMs= 180000 apiKey= rst_… (masked)
```

The server was stopped immediately afterwards; no credential value was printed
(masked only).

**No live search was re-run.** Every `/search` in this round is billable and is
explicitly forbidden; the request shape and the timeout plumbing are proven
against stubbed transports only. The precedence gotcha is documented in
`README.md` / `docs/api.md`: a deployed `config/secrets.json` still carrying
`"timeoutMs": 30000` keeps the old behaviour until the operator updates it.

## Check 20 — result sorting is local, not a billable search

**Audit finding.** Changing the results-header *Ordina* select re-issued the
search in **all three** verticals, so every sort change cost a paid RouteStack
call:

- `public/views/flights.js` had `resubmit()` →
  `form.dispatchEvent(new Event('submit', …))`, i.e. a full
  `POST /api/flights/search`;
- `public/views/hotels.js` and `public/views/cars.js` did the same thing inline
  (`form.dispatchEvent(new Event('submit', …))`).

`POST /api/{flights,hotels,cars}/search` is the **billable** call on RouteStack
(`flight_search` / `hotel_search` / `car_search`), so a sort — a pure
presentation concern over data already in memory — was spending money.

**Fix.**

- New pure module `public/components/sort.js` exporting
  `sortOffers(offers, sortBy, vertical)`. It returns a **new** array and never
  mutates the input; comparators are stable (index tie-break) and
  **missing/unparseable values always sort last**; an empty/unknown `sortBy` or
  an unknown vertical keeps the original order.
  - flights: `price` (`ourprice`/`price`, asc), `duration` (minutes, parsed from
    a number, `"13h 20m"` or `"PT13H20M"`, asc), `departure`
    (`departureTime`, asc);
  - hotels: `price` (asc), `stars`, `savings` (`savingsPercent`) and `rating`
    (descending, best first);
  - cars: `price` (asc) plus the existing `supplier` option (alphabetical).
- The header `onSort` in the three views now reorders
  `state.offers` / `state.hotels` and calls `renderResults()` only. The old
  `resubmit()` helper and both inline `dispatchEvent('submit')` calls were
  removed — nothing in the header touches the network. `sortBy` remains in the
  **search form**, so it still travels upstream on the next real search.
- Cost made visible: a persistent note next to the search button in all three
  verticals — *"Le ricerche sono fatturate. L'ordinamento dei risultati è locale
  e non consuma una nuova ricerca."* (`SEARCH_COST_HINT` / `searchCostHint()` in
  `public/components/states.js`).
- The hotels *"Carica altri risultati"* button is now labelled
  *"Carica altri risultati (nuova ricerca fatturata)"*: it re-sends
  `hotel_search` with `nextResultsKey` and **is** billable. It still works; no
  confirm dialog was added.

Pagination state (`nextResultsKey`), checkout and MultiCity are untouched.

**Offline proof (no billable call).**

Unit tests — `test/sort.test.js` (18) cover each vertical and each key, the
fallbacks (`ourprice`/`price`), numeric/`"13h 20m"`/ISO duration parsing, stable
ties, missing/unparseable values last in both directions, input-not-mutated,
non-array input, empty/unknown `sortBy` and unknown vertical, plus
`parseDuration` / `sortKeys`.

DOM-stub tests — `test/sort-dom.test.js` (3) load the **real** view modules in
Node against the extended `settings-dom.test.js` stub (autocomplete needs
`replaceWith` / `after` / `parentElement`), drive one search through a stubbed
`fetch`, then change the header select and assert both the new DOM order **and
that `fetch` was called zero extra times** for that interaction. All three
verticals are covered because the same stub supports them cheaply.

Pre-fix proof: reintroducing the old submit in `flights.js#onSort` and re-running
`test/sort-dom.test.js` makes the flights test fail (the search returns the
server order, not the sorted one, and `fetch` is called again); restoring the fix
turns it green. The change is a genuine regression guard, not a tautology.

Observed:

```text
node --test test/sort.test.js      -> tests 18, pass 18, fail 0
node --test test/sort-dom.test.js  -> tests 3,  pass 3,  fail 0
npm test                           -> tests 93, pass 93, fail 0
for f in $(find public -name '*.js'); do node --check "$f"; done  -> no output
```

**No live `/search` was executed in this round**: the three billable calls are
audited from the code and the fix is verified offline against stubs only.


