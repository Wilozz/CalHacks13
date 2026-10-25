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

### Assembly: objects made of pieces (the lanyard demo)

The hero demo: the learner has a lanyard whose hook has come off a cardboard name tag. The helper shows how to clip the hook through the small slot in the tag. This is the case the whole system is built for, so it gets its own rules. The generic model comes first, then the specifics for the hook in "Hook into tag slot".

**Model.** An object is a *kit* of rigid **pieces**. Each piece has its own mesh and its own pose, plus **connectors** that can mate with each other. A part (button, cap) moves *within* a piece; a piece moves freely, and connectors join pieces.

```jsonc
"pieces": [
  { "id": "hook", "mesh": "lanyard-01/hook.glb",              // the strap rides along as a rope, see below
    "connectors": [{ "id": "tip", "kind": "hook", "at": [0.12, -0.3, 0], "axis": [0, 0, -1], "up": [0, 1, 0],
                     "mates": "tag.slot", "bend": [0, -0.42, 0] }] },  // bend: where the tag hangs once on
  { "id": "tag", "mesh": null, "card": { "size": [0.86, 0.54, 0.01], "texture": "lanyard-01/tag.jpg" },
    "connectors": [{ "id": "slot", "kind": "slot", "at": [0, 0.22, 0], "axis": [0, 0, 1], "up": [0, 1, 0],
                     "mates": "hook.tip", "slot": [0.14, 0.04] }] }   // slot opening, width × height
],
"joints": []                       // runtime state: [] = apart, [["hook.tip","tag.slot"]] = joined
```

Each piece is scanned separately with SAM 3D (photograph the two pieces apart). The connector frames (`at`, `axis`, `up`) are written by hand in the profile, because a model guessing them wrong breaks the demo.

**Mating: three stages, each forgiving.**

1. **Approach** (connectors more than about 2 × `insert` apart): free movement. Nothing happens.
2. **Align** (inside the assist radius): the moving piece's rotation is pulled smoothly (slerp, about 150 ms) toward the mating orientation. Its position is pulled onto the socket's axis line. The connector glows. The user only has to get close; the system lines up the last few degrees and centimetres.
3. **Insert:** progress along the axis comes from the hands moving the two pieces together (projected onto the axis). Past `insert` depth it **snaps**: a click sound, a squash, and the joint is added to `joints`. From then on the joined pieces move as one rigid group, held by either hand.

Separating uses the reverse motion. Objects with release tabs add a `press` part from the same parts system, so "press both tabs, then pull" is just a profile.

**Hook into tag slot (the actual demo).** These specifics replace the generic peg-in-socket insert:

- **Tag:** don't SAM 3D it. A flat piece of cardboard is a thin box with the photo of the tag as its texture, with the slot cut out (a hole in the texture's alpha, plus a darker rim). It looks better than a scan of a thin card would, and the slot is exactly where the profile says it is.
- **Hook:** SAM 3D does poorly on small, shiny metal. Try the scan, but keep a fallback built from simple shapes: a `TorusGeometry` arc for the bend, a cylinder shank, and a ring at the top. Show it about 4× the tag's real proportion, because at true size the hook is a few pixels. The hologram can be resized anyway.
- **Align:** the hook tip is pulled so it points through the slot (tip direction against the card's normal) and lined up with the slot's long side.
- **Insert = thread through:** the join happens when the hook tip *crosses the card's plane inside the slot rectangle*. That's a segment-plane test on the tip's path between two frames, plus a point-in-rectangle check. It runs in the tag's frame, so either hand can be the one that moves. A tip that crosses outside the slot bumps: the tag nudges away, with no join, which shows "you missed the hole".
- **After the join, the tag hangs.** It is no longer rigidly attached. It hangs on the hook's `bend` point as a damped pendulum (one or two angles, driven by how the hook moves), so the tag swings when the helper lifts the lanyard. That swing is the "it's on" proof, and it reads well on video.
- **Clasp gate:** if the real hook has a spring gate (a lobster or trigger clasp), the gate opens while the hook is held in a pinch near the slot, and closes on the join. The thumb pressing the trigger is too small to track reliably, so this is cosmetic. It's a profile flag (`"gate": true`); skip it for a plain open hook.
- **Separating:** grab the tag and pull it back over the tip (the reverse threading test), with the gate open if there is one.
- **Strap (stretch goal):** a verlet rope from the hook's ring to off-screen, so the hook feels attached to a lanyard. It is not needed for the join.

**Why it will feel good, given hand-tracking limits:**

- **Depth is the weak axis.** MediaPipe's monocular z is noisy, so when both pieces are held they share one working depth plane. Alignment and insertion use screen-plane position plus rotation only. The user never has to judge depth.
- **Assign hands to pieces by continuity, not by MediaPipe's left/right label.** That label swaps when hands cross or come close. Match each new hand to the piece it held last frame by nearest palm position.
- **Two hands near each other is where tracking drops.** On a dropout, freeze that piece (grip kept) for up to about 500 ms. Never drop it, and never throw it (same rule as throw safety).
- **The assist radius is generous; the snap is not.** Joining needs alignment within tolerance *and* the insert motion. That way the demonstration shows the real motion (push in), not just "touch and it teleports".
- Strap: rigid meshes are enough for the demo. A stretch goal is a short verlet rope (about 16 points) drawn as a `TubeGeometry` hanging from each piece, so the strap sways. About 30 lines, no physics engine.

**Over the call and in the replay.** The holder is the authority for every piece's pose and for `joints`. `control` carries `joint` events (`join`/`split` with connector ids). The replay records per-piece poses and joint events, so the replay viewer can mark "joined at 0:42" as a chapter.

**Tests to write first** (pure functions, no camera): connector world frame from piece pose; align assist (converges, never overshoots); insert progress projection; snap fires only within tolerance; hand-to-piece assignment when labels swap; dropout freezes rather than drops.

### Interaction (grab, transform, throw)

Built on `src/remote/pinch.ts` (the Throwing prototype that started it, `src/throw/`, was removed; see git history).

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
- Built in the call: one shared copy. Both screens draw both people's hands on it; whoever takes it first drives it until they let go (a tie goes to whoever brought it out), sending `twin-pose` on the unordered `pose` channel (~15 Hz while it moves, resent every 300 ms, sequence-numbered); the other screen shows that pose and `adopt`s it into its own rig, so its next grab starts from there (`TwinScene` in `src/render/TwinBox.tsx`). There is no throw any more.
- Hands are drawn in the object's frame (object-relative), so they stay on the model when the viewer orbits.

### Recording and replay

- The recorder runs on **both** sides and logs what is in the scene, never video: `{t, kind: 'hand'|'pose'|'part'|'toss'|'caption', data}`. At 2 hands × 30 Hz × 262 B that is about 16 KB/s, or about 2 MB for a 2-minute lesson before compression.
- On throw-back the helper's log goes with it (or is uploaded and referenced by id). The learner merges both logs into one session timeline.
- Replay viewer: the same R3F scene fed from the log instead of live input, with scrub, play/pause, speed, orbit, and part-state chapter markers.
- Built: a lesson runs from the copy coming up until it is closed or the call ends (`CallLesson` in `src/replay/lesson.ts`), recorded on the screen that brought it out (its raw hands, the friend's hands as they arrived, and the copy's `TwinPose` stream whoever moved it; log v3 with optional `ph` in `src/replay/log.ts`), saved to Convex by itself, renamable and deletable. The id goes to the friend over `control`; `replays.copy` gives them their own row pointing at the same log file. Tutorials replays it in `TwinScene` itself (drive `remote`), so it looks like the live box.

### Backend: Convex

Convex holds everything persistent. Signaling and live media stay on `server/index.mjs` and WebRTC, because Convex is not a 30 Hz transport.

| Convex | Holds |
|---|---|
| File storage | Cached `.glb` meshes and the replay event log (one binary blob per replay, made of `handWire` frames plus JSON events) |
| `objects` table | `profile` (the JSON above), `meshFiles: Id<'_storage'>[]`, label, class |
| `replays` table | `objectId`, `ownerKey`, `logFile: Id<'_storage'>`, `durationMs`, `chapters` (joint and part events with times), `createdAt` |

- **The log goes in file storage, not in a document.** Convex documents are capped at 1 MiB and arrays at 8192 items, and a 2-minute log is about 2 MB. Upload: mutation `replays.generateUploadUrl`, then `POST` the blob, then mutation `replays.create({ storageId, … })`, which checks the size and fields.
- `chapters` is small and stays in the document, so the replay list can show "hooked onto tag at 0:42" without downloading the log.
- `replays.list({ ownerKey })` is a reactive query. A replay appears in the learner's list the moment the helper's throw-back finishes, with no polling. Show that in the Convex pitch.
- No accounts: `ownerKey` is a random id in `localStorage`, checked in every query and mutation. That's enough for the demo, but not real auth.
- Stretch: a Convex action calls Claude to propose a profile from a photo plus the SAM masks (the classifier in "Object pipeline"). It writes a draft, which a person reviews.
- The Convex deploy key and the Anthropic key stay server-side. Only the public `VITE_CONVEX_URL` reaches the client.
