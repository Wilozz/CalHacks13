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

## Planned: object, interaction, replay

Status: design only, except where it names existing code. This is the baseline from [GOALS.md](GOALS.md). Change it as we build.

### Object pipeline (offline, cached)

```
photo of object ──SAM 3 (segment "phone", "power button", …)──> masks
   └──SAM 3D Objects (image → mesh)──> object.glb (+ optional per-part .glb)
        └──Claude vision (photo + part masks + render)──> profile.json (class, parts, affordances, physics)
             └── human check ──> public/objects/<id>/  or backend /objects/<id>
```

- SAM 3 does segmentation and SAM 3D does image-to-3D. We pre-run both and commit or host the output. The "scan" in the demo picks the cached object, either from a Claude/SAM label on a live frame or from a manual pick, and plays a scan effect.
- **A single SAM 3D mesh is one solid blob: a button is not a separate piece.** You can't press a button that isn't its own mesh. Two ways to get parts, and either works with the profile below:
  1. *Part meshes:* segment each interactive part with SAM 3 (text prompt "power button") and reconstruct it separately. Looks best, but needs more pre-processing and alignment.
  2. *Hotspots:* keep one mesh and have the profile define each part as a region (center, size) plus a proxy primitive drawn on top (for example a small box that presses in). This is cheaper, and the fallback for the demo.
- Load with `GLTFLoader` from `three/examples/jsm` (already in `three`, no new dependency). Keep `ModelSpec` primitives as the fallback when a GLB fails, and for the existing throw presets.

### Object profile (`profile.json`)

Plain serializable data, validated like `sanitizeModel` before use. It travels over the call by id (both sides load the same cached files), so a toss stays small.

```jsonc
{
  "id": "phone-01", "label": "Phone", "class": "smartphone",
  "mesh": "phone-01/object.glb", "scale": 0.15,          // metres for the real object's longest side
  "physics": { "mass": 0.2, "bounce": 0.2, "rigid": true },
  "parts": [
    { "id": "power", "label": "Power button", "action": "press",   // reuses ActionType from src/ai/types.ts
      "mesh": "phone-01/power.glb",                                // or omit and use "proxy"
      "proxy": { "shape": "box", "center": [0.5, 0.2, 0], "size": [0.02, 0.12, 0.03] },
      "axis": [-1, 0, 0], "range": [0, 0.004],                     // press depth / slide travel / hinge angle
      "hold": 1.5,                                                 // seconds held to trigger
      "effect": { "set": { "screen": "on" } } }
  ],
  "states": { "screen": ["off", "on"] },
  "visuals": { "screen=on": { "part": "display", "emissive": "#9fd8ff" } }
}
```

- `action` reuses the existing action library (`twist press pull push slide lift flip tilt`), so the parser, `motion.ts` animations and offline verbs all keep working. A new part type (such as `hinge`) means extending `ActionType`, not starting a second vocabulary.
- The classifier proposes. The checked-in profile is the source of truth for the demo, which is the same rule as `policy.ts`: the model never gets the last word.

### Interaction (grab, transform, throw)

Builds on `src/throw/TossScene.tsx` and `src/remote/pinch.ts`.

- **Grab:** pinch *or* fist, inside a generous radius (`GRAB_RADIUS` is 1.15 × object height today). Anchor to the palm centre, smooth with One Euro (already done). Show a reach highlight before the grip closes so the user knows it will take.
- **Rotate:** while held, apply the change in palm orientation (from wrist, index-MCP and pinky-MCP) to the object. Use deltas only, so grabbing never snaps the object.
- **Resize:** with the object held, the second hand pinches. The ratio of the distance between the hands to the distance at the moment the pinch started sets the scale, clamped. Needs `numHands: 2` in `public/tracking.worker.js`, which roughly doubles inference cost, so check mobile FPS.
- **Throw: intent, not just speed.** All of these must hold:
  1. The object was held for at least about 250 ms (no grab-flick-by-accident).
  2. The release velocity (`releaseVelocity`) is above threshold *and* points toward the screen or friend (a push, or an up-and-forward flick). A fast sideways or downward motion is a drop.
  3. The hand opens during or right after that motion. Tracking loss is **never** a release-with-velocity: on loss, freeze the object in place and keep the grip until the hand comes back or a timeout passes, then drop it. This replaces today's `LOST_GRACE` release.
  4. Optional: a throw zone at the top or far edge that glows when armed.
- Unit-test the throw classifier on recorded sample traces (as `toss.test.ts` does now), including "fast shake while holding", "tracking drop mid-hold", and "slow release".

### Hands and state over the call

| Channel | Ordered | Carries |
|---|---|---|
| `hand` (existing format, `handWire.ts`) | unreliable | holder's 1–2 hands, 30 Hz, 262 B per hand |
| `control` (existing) | reliable | `toss` (object id + pose + scale + part states), `part` state changes, `grab` and `release` events |

- Whoever holds the object is the authority for its pose and part states. The other side only displays them, the same rule as `twinMove.ts` today.
- Hands are drawn in the object's frame (object-relative), so they stay on the model when the viewer orbits.

### Recording and replay

- The recorder runs on **both** sides and logs what is in the scene, never video: `{t, kind: 'hand'|'pose'|'part'|'toss'|'caption', data}`. At 2 hands × 30 Hz × 262 B that is about 16 KB/s, or about 2 MB for a 2-minute lesson before compression.
- On throw-back the helper's log goes with it (or is uploaded and referenced by id). The learner merges both logs into one session timeline.
- Replay viewer: the same R3F scene fed from the log instead of live input, with scrub, play/pause, speed, orbit, and part-state chapter markers.
- Storage: one `replays` row (id, object id, created, duration) plus a time-series table of events (a Tiger Data hypertable, see GOALS **Tracks**). Served by a small HTTP API next to the signaling server. Replays are opt-in: the learner sees "saved", and can delete one.

### Planned server additions

- `GET /objects/:id/*`: cached GLBs and profiles (or static files from `dist/`)
- `POST /replays`, `GET /replays/:id`, `GET /replays?key=…`, `DELETE /replays/:id`, with a size cap and schema validation on upload
- The database URL lives server-side only, like the TURN secrets.
