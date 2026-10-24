# Architecture

## Hand-tracking pipeline

1. `App.tsx` acquires a 640×480 preferred front-facing stream, with a front/rear switch. The old stream is stopped before switching. Each new video frame becomes a transferable ImageBitmap. At most one frame is in flight: slow inference drops intermediate frames instead of building a queue.
2. `public/tracking.worker.js` initializes MediaPipe Hand Landmarker in VIDEO mode for one hand. CPU/WASM inference runs off the UI thread. It returns 21 normalized image landmarks, estimated world landmarks, handedness, and inference timing. The transferred bitmap is always closed.
3. `coordinates.ts` defines a plain serializable `HandFrame` boundary for a future WebRTC transport. World points are wrist-relative and uniformly scaled from meters to scene units. X is mirrored for the front selfie camera and unmirrored for the rear camera, Y is flipped for Three.js, and Z is flipped so negative MediaPipe camera-relative depth points toward the viewer. Image wrist XY positions the skeleton on screen. No independent finger scaling, synthesized pose, or removal of wrist rotation is applied. Image-space coordinates provide a less accurate fallback when world points are unavailable.
4. `HandScene.tsx` updates spheres and cylinder bones directly in React Three Fiber's frame loop. Exponential smoothing is frame-rate independent (roughly 42 ms time constant), and resets on reacquisition. The scene hides on tracking loss or stale results after 350 ms. React UI metrics refresh only four times per second.

See README "Performance and limitations" for accuracy and FPS caveats.

## Calling

```
Browser A (CallSession) ──ws /signal──> server/index.mjs <──ws /signal── Browser B
          └──────────── WebRTC media (direct, or via TURN relay) ────────────┘
```

- **Client** (`src/CallSession.ts`, `src/callSignaling.ts`): opens a WebSocket to `signalingUrl()` (defaults to same-origin `/signal`; `VITE_SIGNALING_URL` overrides). Sends `create` or `join` with a room code matching `ROOM_PATTERN`. After camera/mic permission, it sends `ready`.
- **Server** (`server/index.mjs`): holds rooms in memory (capacity two, 30-minute TTL). When both members are `ready`, it sends `peer-ready` to each; the host (first member) is the initiator and makes the offer. It validates and relays `signal` messages (SDP offer/answer, ICE candidates). `leave` or disconnect ends the room.
- **TURN** (`server/turn.mjs`): `turnConfiguration` builds ICE servers from env (`TURN_URLS` + `TURN_SHARED_SECRET` for 24 h HMAC credentials, or `TURN_USERNAME`/`TURN_PASSWORD`). Credentials go only to room participants. With relay settings present, ICE defaults to relay-only (`RELAY_ONLY=false` to disable).
- Media is WebRTC-encrypted; the server never sees it. The UI's "TURN relay" label comes from selected-candidate stats, not config.

Config: [.env.example](../.env.example). Deployment: [deploy/README.md](../deploy/README.md).
