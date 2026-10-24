# AGENTS.md

GHOST is a browser hand-tracking prototype for CalHacks: webcam on the left, a live 21-joint 3D hand skeleton on the right (MediaPipe + React Three Fiber), plus a two-person WebRTC call joined by a six-character room code.

- Goals and status: [docs/GOALS.md](docs/GOALS.md)
- How it works: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- User-facing setup, phone testing, calling: [README.md](README.md)
- Public server + TURN relay: [deploy/README.md](deploy/README.md)

## Commands

Node 20.19+ or 22.12+.

| Command | What it does |
|---|---|
| `npm install` | Installs deps; postinstall copies MediaPipe runtime into `public/vendor/` (ignored) |
| `npm run dev` | Vite on 127.0.0.1:5173 + signaling server on :8787 |
| `npm run dev:https` | LAN HTTPS for phones; needs mkcert certs in `.cert/` (see README) |
| `npm test` | Unit tests: coordinates, room protocol, server, TURN HMAC |
| `npm run build` | `tsc -b` typecheck + production bundle in `dist/` |
| `npm run test:e2e` | Playwright, two real Chromium peers with synthetic media (`npx playwright install chromium` once) |
| `npm run test:e2e:relay` | Relay-only calls through a local coturn (needs `turnserver` binary) |
| `npm start` | Production server: serves `dist/`, `/signal` WebSocket, `/health` |

## Where things live

| Path | Role |
|---|---|
| `src/App.tsx` | Camera lifecycle, front/rear switch, frame submission to the worker, UI |
| `public/tracking.worker.js` | MediaPipe Hand Landmarker in a worker (plain JS, not bundled by Vite) |
| `src/coordinates.ts` | `HandFrame` type and MediaPipe → Three.js coordinate transform, `BONES` |
| `src/HandScene.tsx` | R3F scene: joints/bones, smoothing, tracking-loss hiding |
| `src/device.ts` | `useMobileDevice` |
| `src/CallPanel.tsx` | Call UI |
| `src/CallSession.ts` | WebRTC peer + signaling client |
| `src/callSignaling.ts` | Room code format/validation, signaling URL |
| `src/main.tsx` | Tabs: Call (`App`) and Throwing prototype (`#throw`) |
| `src/throw/` | Throwing prototype: hologram toss over the call's `control` data channel |
| `server/index.mjs` | `createSignalingServer`: rooms, signaling relay, static files |
| `server/turn.mjs` | `turnConfiguration`: TURN credentials (shared-secret or static) |
| `scripts/` | Dev launchers, asset copy, test harnesses |
| `tests/` | Playwright e2e specs |
| `deploy/` | Example Caddy, systemd, coturn configs |

Unit tests sit next to the code (`*.test.ts`, `server/server.test.mjs`). New unit test files must be added to the `test` script in `package.json`; it lists files explicitly.

## Invariants (do not break)

- Hand inference runs locally. Calls send media and hand landmarks to the connected peer using WebRTC. Explicit AI scans can send selected snapshots to the AI backend. Community metadata lives in Convex; never send high-frequency hand data through Convex.
- At most one frame in flight to the worker; drop frames rather than queue. Always close transferred `ImageBitmap`s.
- `HandFrame` stays plain, serializable data (planned future transport boundary).
- TURN secrets are server-side only. Never put them in a `VITE_` variable.
- One signaling instance only: rooms are in-memory, capacity two, cleared on restart.
- No uploads, recordings, simulated hand motion, or fake relays. Community uses Convex Auth accounts; standalone manual calls remain anonymous.

## Conventions

- TypeScript strict, React 19 function components, ES modules. Server is plain `.mjs`.
- Code is dense (compact one-liners in `src/CallSession.ts` and `server/`); match the style of the file you edit.
- Don't add dependencies for small things. Keep README instructions in sync when behavior changes.

## Definition of done

1. `npm test` passes.
2. `npm run build` passes.
3. If call/signaling code changed: `npm run test:e2e` passes.
4. Camera and tracking behavior can't be verified headlessly. Say so and point to the manual checklists in README.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
