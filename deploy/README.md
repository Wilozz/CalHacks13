# Activate shared short-code calling and a real TURN relay

The code is runnable locally but **no public server or relay is provisioned automatically**. You need internet-reachable hosting and DNS/TLS, or credentials for a managed service. A localhost TURN server on event Wi-Fi cannot solve the event network's inbound firewall. There is no bundled paid service, signup, billing, or pretend relay.

## Shared calling server

On a public Linux host with Node 22.12+ (or 24), check out this repository and run `npm ci` and `npm run build`. Copy `.env.example` to `.env`, then configure:

```dotenv
HOST=127.0.0.1
PORT=8787
ALLOWED_ORIGINS=https://ghost.example.com,http://localhost:5173,http://127.0.0.1:5173
TURN_URLS=turn:turn.example.com:3478?transport=udp,turns:turn.example.com:443?transport=tcp
TURN_SHARED_SECRET=YOUR_RANDOM_SHARED_SECRET
RELAY_ONLY=true
```

Run `npm start`. The Node server serves `dist`, the `/signal` WebSocket endpoint, and `/health`. Put a TLS reverse proxy in front (example `Caddyfile.example`) and allow HTTPS TCP 443. Configure a supervisor such as `ghost.service.example`, adapting its username and paths. Both browsers can simply open `https://ghost.example.com`: a single code joins the call. `/health` reports whether relay settings exist, not whether the relay is reachable.

Alternatively keep the frontend on each laptop: set `VITE_SIGNALING_URL=wss://ghost.example.com/signal` in `.env.local` on **both** laptops and restart `npm run dev`. Their localhost Origins must be in the server's `ALLOWED_ORIGINS`. An HTTPS tunnel can expose the signaling server for a short demo, but it does **not** tunnel TURN or remove the need for a public relay. Only one signaling instance is supported: rooms live in process memory and are cleared on restart. Do not use multiple replicas without a shared room store.

## Public coturn relay

On a dedicated public Linux relay host, install coturn using your OS package manager. Point `turn.example.com` DNS to that host and obtain a normal trusted TLS certificate for that hostname. Adapt `turnserver.conf.example` and start coturn with it. The `static-auth-secret` must equal `TURN_SHARED_SECRET` on the calling server. Generate a random value with `openssl rand -hex 32`; keep it in server-side config only. The provided credential implementation follows [coturn's TURN REST authentication](https://github.com/coturn/coturn/wiki/turnserver).

Open inbound:

- TCP and UDP 3478 for TURN/STUN.
- TCP 443 for TURN over TLS (important when event Wi-Fi blocks UDP).
- UDP 49160–49260 for allocated relay traffic, matching the configuration.

Permit outbound relay traffic too. Map the same UDP port range through NAT and configure `external-ip` if required. Ensure the coturn service can read its TLS certificate/key, including after certificate renewal; restart/reload it on renewal. The sample uses port 443, so the service needs permission to bind that privileged port (configure the system service's bind capability). Use a different host/public IP for TURN TLS 443 and website HTTPS 443; they cannot both bind the same address/port. A typical HTTP reverse proxy cannot handle TURN traffic.

Private-address peer blocks and bandwidth/allocation quotas are included in the example. Rooms have 30-minute waiting expiry, two-person capacity, Origin checks, payload limits, heartbeat cleanup, and bounded signaling traffic. This is a demonstration service without user authentication: a code is the invitation, and public relay use can incur hosting bandwidth costs. Add provider-side spend/traffic limits and proper account access controls before broad public release.

## Prove the public relay is working

1. Set `RELAY_ONLY=true` on the calling server and restart it. Both participants must create a **new** room afterward.
2. Create/join with a single six-character code. The UI should report **TURN relay** after connection. In relay-only mode, direct host candidates cannot hide a broken relay configuration.
3. Check live video and audio in both directions on separate laptops/networks, mute/camera controls, and hangup. Test TCP/TLS-only networking too.
4. If it fails, check coturn logs, DNS, certificate trust, public port mappings, the matching shared secret, and synchronized clocks. The app gives network discovery 60 seconds only **after both participants are ready**. Waiting for a friend or accepting camera permissions is not a connection failure; waiting rooms expire after 30 minutes.

The automated suite checks local direct calling and can check a temporary local coturn relay. It cannot establish that your public event network allows the chosen relay. No implementation can guarantee connectivity across every firewall.


## Easiest hosted demo: Render + managed TURN

The server also accepts provider-issued `TURN_USERNAME` / `TURN_PASSWORD` instead of `TURN_SHARED_SECRET`. Use one method only. For managed credentials the provider controls expiry and rotation; GHOST does not generate a new HMAC password. Never put a provider dashboard password or API key in these fields.

1. Create a managed TURN credential (for example in Metered's TURN Server & SFU → Credentials). Copy the supplied ICE server URLs, username, and credential/password. Include the provider's TLS/TCP URL if offered.
2. Push the latest code to GitHub before deploying; the earlier manual-code commit does not contain the shared server.
3. In Render create a **Web Service**, connect the repository, choose its updated branch and Node runtime. Build: `npm ci --include=dev && npm run build`. Start: `npm start`. Set health check `/health`, `NODE_VERSION=24`, and `HOST=0.0.0.0`.
4. Add server environment variables `TURN_URLS` (comma-separated URLs supplied by the provider), `TURN_USERNAME`, `TURN_PASSWORD`, and `RELAY_ONLY=true`. Leave `TURN_SHARED_SECRET` unset. Render supplies `PORT` automatically.
5. Copy the HTTPS URL Render assigns (for example `https://ghost-demo.onrender.com`) into `ALLOWED_ORIGINS` exactly, without a trailing slash; redeploy if necessary. Both people open that same URL, create/join a room, and grant permissions. No `VITE_SIGNALING_URL` or phone certificates are needed in this arrangement.

Render supports inbound WebSockets: https://render.com/docs/websocket . Free web services can sleep and restart: https://render.com/docs/free . Rooms are lost on restart; use the free tier for a demo rather than a reliable always-on service. Check current provider quotas before use. Metered setup: https://www.metered.ca/docs/turn-server-service/quickstart/ .
