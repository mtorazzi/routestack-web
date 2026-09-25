# RouteStack Web

Interfaccia web locale per esplorare l'inventario di viaggio **RouteStack.ai** —
voli, hotel e auto — tramite l'endpoint MCP di produzione
(`https://mcp.routestack.ai/mcp`).

Il progetto è composto da:

- `server/` — server Express che fa da proxy verso RouteStack MCP. Custodisce le
  credenziali, mina il partner token, gestisce la sessione MCP e normalizza le
  risposte.
- `public/` — UI statica (`index.html`, `app.js`, `router.js`, `components/*`,
  `views/*`, `styles/*`), senza dipendenze: il browser non vede mai i segreti.
- `test/` — suite `node:test` (93 test).

## Avvio

Requisiti: Node.js ≥ 22.

```bash
npm install
npm start
```

Apri <http://127.0.0.1:8787>.

Sviluppo con riavvio automatico:

```bash
npm run dev
```

Test:

```bash
npm test
```

## Variabili d'ambiente

| Variabile | Default | Descrizione |
|---|---|---|
| `PORT` | `8787` | porta di ascolto |
| `HOST` | `127.0.0.1` | interfaccia di ascolto (usa `0.0.0.0` per esporre) |
| `ROUTESTACK_API_KEY` | — | API key RouteStack (fallback al file di config) |
| `ROUTESTACK_API_SECRET` | — | API secret RouteStack (fallback al file) |
| `ROUTESTACK_ACCOUNT_ID` | — | account id, richiesto solo in `authMode: "header"` |

Le credenziali possono arrivare dal file `config/secrets.json` (che ha
precedenza) oppure dalle variabili d'ambiente come fallback.

## `config/secrets.json`

File di configurazione locale, creato con permessi **0600** e **ignorato da Git**
(`.gitignore`). Esempio:

```json
{
  "authMode": "partner-token",
  "apiKey": "rst_…",
  "apiSecret": "…",
  "accountId": "",
  "baseUrl": "https://mcp.routestack.ai/mcp",
  "sandbox": false,
  "currency": "EUR",
  "timeoutMs": 60000,
  "searchTimeoutMs": 180000
}
```

I due timeout:

- `timeoutMs` — timeout **generale** delle chiamate MCP (mint del token, autocomplete
  e chiamate non billable), default **60000** ms.
- `searchTimeoutMs` — timeout dedicato alle **tre ricerche billable**
  (`/api/hotels/search`, `/api/flights/search`, `/api/cars/search`), default
  **180000** ms, limitato dall'ambiente locale a **30000–600000** ms: le ricerche
  long-haul / multi-tratta possono richiedere 30–120 s o più.

> **Precedenza.** Un valore presente in `config/secrets.json` **vince** sempre sul
> default del codice. Un file rimasto con `"timeoutMs": 30000` (o senza
> `searchTimeoutMs`) mantiene quindi il vecchio comportamento finché l'operatore
> non aggiorna il file sulla macchina di deploy. La pagina **Impostazioni**
> espone entrambi i campi.

I campi segreti si possono impostare anche dalla pagina **Impostazioni** dell'UI
(`POST /api/config`); vengono sovrascritti solo se il nuovo valore è non vuoto.
`DELETE /api/config` rimuove le credenziali memorizzate.

## Modello di sicurezza

- I segreti restano **solo lato server**: `apiKey` / `apiSecret` non vengono mai
  inviati al browser né inclusi nelle risposte.
- `GET /api/config` restituisce i segreti **mascherati** (`rst_…cdef`) e i flag
  `apiKeySet` / `apiSecretSet`, mai i valori in chiaro (vedi `redact()` in
  `server/util.js`).
- I token JWT sono tenuti in memoria e mai loggati; gli snippet di errore sono
  redatti (`[jwt]`).
- Header di sicurezza di base: `x-content-type-options: nosniff`,
  `referrer-policy: no-referrer`, `x-powered-by` disabilitato.
- Il modello parte in ascolto su `127.0.0.1` per default: esporre la rete solo
  dietro un reverse proxy con TLS.

## Deploy con systemd

```ini
[Unit]
Description=RouteStack Web
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=routestack
WorkingDirectory=/opt/routestack-web
EnvironmentFile=/opt/routestack-web/.env
Environment=HOST=0.0.0.0
ExecStart=/usr/bin/node server/index.js
Restart=on-failure

# hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/routestack-web/config

[Install]
WantedBy=multi-user.target
```

Note:

- `EnvironmentFile=` punta a un file `.env` con `ROUTESTACK_API_KEY` /
  `ROUTESTACK_API_SECRET` (`0600`, fuori da Git). In alternativa si usa
  `config/secrets.json`.
- `HOST=0.0.0.0` espone il servizio: mettilo dietro un reverse proxy (nginx /
  Caddy) con TLS.
- Porta di default **8787**; cambiala con `Environment=PORT=…`.
- `ReadWritePaths` è necessario solo per salvare/ripulire `config/secrets.json`
  a caldo (endpoint `POST`/`DELETE /api/config`).

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now routestack-web
sudo systemctl status routestack-web
```

## Sandbox

L'host sandbox `https://evolvemcp.routestack.ai/mcp` risponde **401** con le
credenziali di produzione: le prove documentate sono quindi solo di produzione.
Per usarlo, imposta `"sandbox": true` in `config/secrets.json` (servono
credenziali sandbox dedicate).

## Documentazione

- [`docs/api.md`](docs/api.md) — reference degli endpoint, envelope e flusso di
  autenticazione.
- [`docs/verification.md`](docs/verification.md) — prove live e output osservati
  (segreti redatti).
