# GHOST — hand tracking prototype

A local browser proof of concept: webcam on the left, a live cyan 21-joint skeleton on the right. Includes a two-person WebRTC audio/video call panel. Includes a small shared signaling server; no simulated hand movement or recorded video uploads. Community adds optional accounts for assistance matchmaking; manual calls remain anonymous.

## Docs

- [AGENTS.md](AGENTS.md): commands, file map, invariants (for coding agents and contributors)
- [docs/GOALS.md](docs/GOALS.md): goals and status
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how tracking and calling work
- [deploy/README.md](deploy/README.md): public server and TURN relay

## Run

Requires Node.js 20.19+ or 22.12+ and a recent desktop Chrome/Edge, Android Chrome, or iOS Safari (17+ with worker OffscreenCanvas support) with WebGL, WebAssembly, workers, and camera access.

```sh
npm install
npm run dev
```

Open the printed localhost URL, click **Turn on camera** in the preview, and allow access. Hold one hand in view with good lighting. The UI follows FaceTime: an iPhone layout on phones and narrow windows (≤800 px or touch), a Mac-window layout on computers. The flip button in the preview switches front/rear camera (on the home screen only). **Turn off camera** releases the webcam; Cancel also cancels initialization. The hand button in a call toggles the landmark overlay (and the 3D hand tile on computers); **Hand tools and lab** (or **⋯** in a call) opens placement, tuning, the AI scan, and the 3D lab with metrics. Permission errors include retry guidance. Camera access needs localhost or HTTPS.

```sh
npm test       # coordinate transform invariants
npm run build # TypeScript and production bundle
npm run preview
```

MediaPipe 0.10.32's runtime and WASM are copied from the installed npm package into ignored local assets by postinstall/predev/prebuild. The first session requires internet to download the hand model from Google's storage. Fonts also load from Google Fonts, with local fallbacks. Hand tracking frames and landmarks stay in your browser; these asset requests do not carry camera data. When you explicitly start/join a call, its camera and microphone streams are transmitted to the connected peer. Hand landmarks and the 3D scene are not transmitted. This is not a fully offline distribution.

## Pipeline

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the tracking pipeline and calling flow.

## Performance and limitations

Rendering targets 30–60 FPS; actual tracking speed depends on your CPU, camera frame rate, browser, and lighting. Desktop inference runs as quickly as available frames allow (capped at 60 submissions/sec). Mobile camera capture and inference are capped at 30 FPS, with capture limited to a 640 px long edge while retaining its aspect ratio. Mobile 3D rendering targets up to 60 FPS at device pixel ratio 1; idle/background rendering is suspended, and inference pauses in hidden tabs. These limits reduce workload but cannot guarantee thermals or frame rate on every phone. CPU mode in a worker prioritizes UI responsiveness over device-specific GPU integration.

The FPS display measures the **render loop**, not inference throughput. Pipeline latency measures frame submission through bitmap creation, worker inference, and result receipt. Inference time measures MediaPipe alone. Neither measures true camera-exposure-to-display latency; camera buffering, presentation time, and smoothing add delay.

MediaPipe world landmarks are **monocular estimates**, not accurate full 3D reconstruction. Occluded fingers, fists, edge-on palms, rapid motion, and poor lighting can cause jumps or wrong depth. Global distance from the camera is unobservable here: wrist depth is intentionally anchored at zero, with screen XY estimated from the image. Wrist orientation comes from the landmark geometry without a rigid wrist rotation model. Bone lengths may fluctuate with model uncertainty; smoothing reduces jitter but adds lag. Image-only fallback is weaker and less metrically consistent. Handedness is MediaPipe's raw label (which can differ under selfie mirroring).

## Manual camera validation

Turn on the camera and verify live mirrored video; open and close the palm, point, move each finger, and rotate the wrist. Compare joint alignment using the landmark overlay. Remove the hand and confirm the skeleton disappears; return it and confirm immediate reacquisition. Stop and restart the camera. Test denying permission and retry after changing browser site settings. Test disconnecting the camera and a blocked model download. Observe the render and inference metrics in Hand tools → Hand tracking lab; performance is not guaranteed from build checks alone.

Implementation follows the [MediaPipe Hand Landmarker web guide](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js).


## Test on an actual phone

Use Safari on an iPhone or Chrome on Android, in a regular browser tab. Connect the phone and laptop to the same Wi-Fi. Desktop setup remains `npm run dev`; desktop panels stay side by side. Phone panels stack vertically in portrait and landscape, with touch controls outside the views and safe-area padding.

A phone cannot access its camera from `http://192.168.…:5173`. HTTPS must be trusted **by the phone**; your laptop's localhost exception does not apply to its LAN address. See [camera secure-context requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

### Local-network HTTPS (no paid services or npm additions)

Use the free [mkcert utility](https://github.com/FiloSottile/mkcert) to make a development certificate. On macOS, install it with `brew install mkcert` if needed; other OS installation options are in its README. Then, in this project:

```sh
mkcert -install
mkdir -p .cert
# Replace 192.168.1.42 with your laptop's Wi-Fi IPv4 address.
mkcert -key-file .cert/localhost-key.pem -cert-file .cert/localhost.pem localhost 127.0.0.1 ::1 192.168.1.42
npm run dev:https
```

Find your laptop's Wi-Fi IP in its network settings (on macOS, `ipconfig getifaddr en0` usually works). The HTTPS command serves on all network interfaces; use the printed port, normally 5173. `.cert/` is Git-ignored. Regenerate the certificate if the laptop's IP changes.

The phone needs the development CA too. Run `mkcert -CAROOT` on the laptop and transfer **only `rootCA.pem`** from that directory to your own test phone. Never transfer `rootCA-key.pem` or the server private key.

- **iPhone:** open the certificate, install the downloaded profile in Settings, then enable full trust for that CA under Settings → General → About → Certificate Trust Settings.
- **Android:** install it as a CA certificate in Settings → Security / Encryption & credentials → Install a certificate → CA certificate (wording varies by manufacturer).

Open **`https://192.168.1.42:5173`** on the phone, using your actual IP. It should show no certificate warning. Allow camera access after tapping **Turn on camera**. If the page cannot load, allow the dev server through your laptop firewall and check Wi-Fi client isolation / guest-network restrictions. If there is a certificate warning, confirm the IP matches the certificate and the phone trusts the CA. After testing, you can remove the development CA profile from the phone.

### Device checklist

1. In portrait, verify no sideways scroll at small widths (including 320/375/390 px), the call controls fit in one row, and 44+ px touch controls. Check notch and home-indicator spacing.
2. Enable tracking and allow permission. Check palm opening/closing, individual fingers, pointing, and wrist rotation against the 2D overlay. Front camera video and skeleton should both behave like a mirror.
3. Switch to rear camera while tracking. Confirm the old camera stops, the new camera starts, and video/landmarks/3D move together without selfie mirroring. Switch back. Camera switches restart the tracking worker/model; a brief loading state is expected.
4. Rotate portrait ↔ landscape during tracking. The video stays uncropped, overlay stays aligned, and the scene resizes. Resize events refresh actual stream dimensions; stale frames with the old aspect ratio are discarded.
5. Toggle landmarks, stop/restart, cancel loading, deny permission and retry after allowing it in site settings. Stop must turn off the phone's camera indicator.
6. Background the browser, return, and navigate away/back. Inference and mobile rendering pause while hidden; leaving the page releases the stream and worker, and returning may require **Turn on camera** again. If the OS suspends the camera, stop/restart it.
7. Run for several minutes and observe FPS, inference latency, and device temperature. Test both iOS Safari and Android Chrome: desktop build checks cannot establish real-device tracking accuracy, battery use, camera orientation, or sustained FPS.


## Laptop-to-laptop video calls

Calling now uses **one six-character room code**, automatic WebSocket signaling, and trickle ICE. The invitation/reply text exchange has been removed.

### Local test on one laptop

```sh
npm install
npm run dev
```

This starts Vite on localhost:5173 and a signaling server on localhost:8787. Open two browser windows (or separate Chrome profiles), click **New call** in one, and type its code under **Join with a code → Join** in the other (or tap **Share code**). Allow camera and microphone in both. Both sides connect automatically; no reply code is needed. Use headphones.

A host can wait up to 30 minutes without a media connection timer. The 60-second connection timer starts only after **both** participants have accepted camera/microphone permissions and are ready. Rooms have capacity two; ending/leaving the call invalidates the room. A broken signaling connection ends the call; start a new room to retry.

### Calling between separate laptops

**Both laptops must connect to the same signaling server.** Running a separate default `npm run dev` on each laptop creates two independent sets of rooms, so codes will not be found across laptops until a shared server URL is configured.

The easiest deployed arrangement is one public HTTPS site serving the app and signaling. Both people open it, create/join, and allow camera/microphone. Or run the frontend locally on each laptop and put the **same** `VITE_SIGNALING_URL=wss://your-shared-server.example/signal` in `.env.local` on each laptop before restarting Vite. The server must allow both localhost Origins.

There is **no public server or TURN relay already activated** in this repository. Follow [deployment and TURN setup](deploy/README.md) to provision them. Local calling works without TURN on networks that allow direct WebRTC, but reliable calling on event Wi-Fi requires an internet-reachable relay. A local relay behind the event firewall cannot fix that. The relay must support the transports permitted by that network; TLS/TCP 443 is included in the example configuration.

### TURN relay integration

For the easiest managed setup, see **Render + managed TURN** in the [deployment guide](deploy/README.md): provider-issued `TURN_USERNAME` and `TURN_PASSWORD` are supported alongside `TURN_URLS`. Provider-managed credential expiry follows that provider’s settings.

For self-hosted coturn, on the **server**, copy `.env.example` to `.env` and configure `TURN_URLS` and `TURN_SHARED_SECRET` to match coturn's `use-auth-secret` configuration. Credentials are generated server-side, expire after 24 hours, and are delivered only to room participants. The shared secret never goes into a frontend `VITE_` variable. With relay settings present, the server defaults to **relay-only** ICE so a broken TURN service cannot be masked by a direct connection. Set `RELAY_ONLY=false` for automatic direct/relay selection.

The UI distinguishes configured relay settings from the actual selected candidate route. **TURN relay** after connection comes from WebRTC connection statistics, not just an environment flag. See [.env.example](.env.example), [coturn configuration](deploy/turnserver.conf.example), and [deployment guide](deploy/README.md). This implements [coturn's credential flow](https://github.com/coturn/coturn/wiki/turnserver); it does not create a public relay account or host for you.

### Media and cleanup

Mute, camera off/on, playback recovery, and End call work independently of hand tracking. Calls clone an existing tracking video track when available and request microphone permission separately. Stopping tracking does not stop the call; ending the call does not stop tracking. The camera indicator stays on while either still uses it. Camera-off disables the outgoing call video track; End call releases tracks, peer connection, signaling socket, and timers. Cancelling during a permission prompt also stops any media returned afterward. Leaving the page releases calling resources.

Camera/microphone media is encrypted by WebRTC. The signaling server handles room membership and connection metadata, not media. A configured TURN server forwards encrypted media when used. Hand landmarks/3D overlays are not sent to the friend. No recordings are stored. Room codes are invitations: share only with the intended friend. Rooms are in-memory and do not survive a signaling server restart.

### Tests

```sh
npm test                       # coordinate, room protocol, TURN HMAC and cleanup tests
npm run build                  # TypeScript + production build
npx playwright install chromium # one-time browser-test setup
npm run test:e2e                # real Chromium peers with synthetic media
npm run test:e2e:relay          # actual local coturn + relay-only calls over UDP and TCP
```

The relay test needs the free `turnserver` binary (`brew install coturn` on macOS or your OS package manager). It starts a temporary loopback-only test relay, and shuts it down afterward; no public relay is provisioned. `GHOST_TEST_TURN_BINARY` can point to an existing binary. Normal app use does not need coturn installed on each laptop.

Browser tests use synthetic audio/video to check actual peer connections, received audio/video RTP data, decoded video frames, media tracks, controls, resource release, permission errors, waiting beyond the old timeout, and delayed permission acceptance. Relay tests additionally require selected-candidate stats to report **TURN relay**. These local checks cannot prove a public provider's availability, physical camera/microphone behavior, or event-network connectivity: perform a two-laptop relay-only test on the actual network after deployment.

For a real call, follow the two-laptop sequence above and check both audio directions, both video directions, mute/unmute, camera off/on, tracking before/during the call, stop tracking while a call continues, end call from either laptop, cancel while permissions are pending, malformed codes, denied microphone access, and a blocked-network failure. Test two tabs on one laptop first if a second laptop is unavailable (wear headphones); a successful same-device test does not prove event-Wi-Fi connectivity.

## AI integration (`src/ai/`, `server/ai.ts`)

Implements the pipeline in `ai-integration.md`: hand history (2 s) and pointing detection, scene cache, transcript, the pointing + verb gate, Claude action parser with a fixed action library, the section 6 confidence policy (0.85 play, 0.6 confirm, else ask), a local offline fallback, and the context summarizer.

```sh
cp .env.example .env   # set ANTHROPIC_API_KEY
npm run dev            # also starts the AI server on :8790 (Vite proxies /ai to it)
```

`npm start` (production, Render) runs it too, behind the main server's `/ai` route. Set `ANTHROPIC_API_KEY` (and optionally `CARTESIA_API_KEY`) in the host's environment.

Wire-up: `new Orchestrator(new Transcript(), {client: httpAiClient(), clock, viewerLanguage, onOutcome})`, feed it `orchestrator.hands.pushLandmarks(t, landmarks)` and `orchestrator.scene.update(objects, t)`, and finalize speech with `transcript.finalize(...)`. `Outcome.decision` is `play`, `confirm` or `ask` for the helper UI. The model proposes; `policy.ts` enforces the rules, so a confident wrong answer cannot skip confirmation, and fallback parses never auto-play.

Not built or unverified: streaming Cartesia STT (the browser Web Speech adapter gives turn-level timing only), the on-device segmentation, the helper confirm UI, the 3D renderer, and latency numbers. Model IDs and cutoffs are defaults to tune.

## Helper hand on the recipient's feed (`src/remote/`)

The core product path: the helper's tracked hand is sent as compact binary frames (`handWire.ts`, 262 bytes, unordered data channel) and drawn over the recipient's live camera view (`HandOverlay.tsx`). `placement.ts` anchors the index fingertip, sizes the hand from the rigid palm, and supports "follow" and "pin to a spot" modes. `RemoteHandState` drops out-of-order packets, counts loss and hides a stale hand after 350 ms.

Solo demo: the page encodes your own hand, sends it through `LoopbackChannel` (adjustable latency, jitter and loss) and draws it on your own camera view through the same decoder a remote helper's hand would use. `RtcHandChannel` is the real-transport adapter (`createHandDataChannel(pc)` on the offering side, wrap the channel from `ondatachannel` on the other); it is not yet connected to the call code and has not been run in a browser.

Placement puts the hand on the feed. It does not align it to a real component: monocular landmarks do not know where an object is.

## 3D copy of the object (corner box)

Scan (Hand tools → AI scan) a camera view, or in a call your friend's view, and pick an object. Claude builds a small parametric 3D model of it, and a grey box in the bottom-right corner shows that copy with the helper's hand on it: the helper's fingertip is mapped from the feed into the object's box (`src/remote/twinPlacement.ts`) and onto the model, sized as the hand is on the feed. The object (label, box, model) is shared over a reliable `control` data channel so both screens show the same box; the hand rides the unreliable `hand` channel. While the box is up, the full-screen hand is hidden on the recipient's screen. The view is fixed on purpose: spinning the object would break the meaning of "the hand is here on the object".

### Moving the copy

Pinch (thumb to index) with the fingertip on the 3D copy to grab it; while pinched it follows the hand, and letting go leaves it where it was dropped. The ↺ button puts it back. A ring on the fingertip closes as the fingers meet, the object is outlined when in reach and yellow while held, and a ghost outline plus dashed line show where it started. Logic: `src/remote/pinch.ts` (hysteresis, palm-relative so it ignores distance) and `src/remote/twinMove.ts`. The helper's screen computes the movement and sends the pose over the control channel; the recipient's screen only displays it. "Rip" and other interactions are not built yet.

## Tutorials: record and replay (`src/replay/`, `convex/replays.ts`)

Lessons record themselves while the 3D copy is open; there is no record button. A hand arriving on the copy starts one (a red **● LESSON** badge shows), and 6 s with no hand and nothing held ends it, trimmed to just after the last activity. Switching objects or closing the copy ends it at once. It is kept only if the object was grabbed or a hand stayed for 4 s, so a hand passing through the view is not a lesson; 5 minutes at most. These are plain rules, not an AI call, so capture is certain, instant and works offline. Claude names it: the voice agent's current topic becomes the default name.

A recording is what the copy showed, never video: each hand frame (all 21 points, drawn as the same 3D hand) in the call's wire format and the object's pose, about 30 times a second. Each lesson is **saved automatically** to Tutorials the moment it ends. A **Lesson saved** card appears without interrupting the call; **Watch** plays it straight away (play/pause, scrub, 0.5–2× speed, drag to look from any angle), and you can **Rename** or **Delete** it there or on the Tutorials page. If saving fails (no Convex, offline), the card says so and offers **Try saving again**.

Saved tutorials are under **Tutorials**, a live Convex query, newest first, each with its own player and **Delete**. The log is uploaded to Convex file storage. Then the `replays.save` action checks its size (6 MB cap) and every field with the same decoders the call uses, and deletes an upload that fails the check. Tutorials belong to this browser through a random key in `localStorage`, not an account. Saving needs Convex (`npm run convex` locally; the Render build deploys it); without it a lesson can still be watched from its card until the tab closes.

## Throwing prototype (`src/throw/`)

A demo of "Reach Through": a hologram you grab and flick through the screen to the person you're calling. Open the **Throwing prototype** tab (top right on the start screen, or `/#throw`).

1. Pick **Mug**, **Pill bottle** or **Teddy bear**. These are preset `ModelSpec` shapes, so no scan or AI server is needed. Each pick adds an object: keep two (or up to four) on screen at once. They land side by side and nudge each other apart.
2. Grab it: turn on hand tracking (hand button), reach for it so your drawn hand or fingertips are on it, then pinch or make a fist. It takes the first closed frame, and a hand that closed up to 0.5 s before reaching it still takes it. Or drag it with the mouse or a finger.
3. While holding it, turn your hand to rotate it in 3D (the change in your palm's orientation since the grab; letting go keeps the turn). Resize it: on a phone, put a second finger on it and pinch; on a computer, scroll over it, or close your other hand on it and move your hands apart or together (computers track two hands; phones track one, since you hold the phone with the other). Each hand or finger can also hold a different object.
4. Throw: flick **up** (up-and-forward, within about 55° of straight up) or push your hand toward the screen, and let go. It keeps your flick's momentum and flies on into the screen toward your friend, shrinking with distance until it slips into their video. On their screen it comes out of the video toward them, growing as it nears, and lands in front of their hand, theirs to turn and throw back. No portal or sparkles: it should look like it simply passed through the glass. **Toss** throws your newest object for you. Both people can throw at the same moment; a catch never replaces what you already hold, and sending and catching messages stack instead of replacing each other. The size you gave it travels with it.
5. Every object is on both screens all the time. Yours are drawn in your space; your friend's are drawn in their video, on their real hand when they hold it, turning as they turn it. So after you throw something you watch your friend work on it live, and they see what you do with yours, including objects made before they joined.
6. With nobody on the call, a thrown object comes back to you, so the effect can be tried alone.

What never throws (`isThrow` in `toss.ts`, unit-tested): letting go within 0.25 s of grabbing, fast sideways or downward moves, slow releases. Losing hand tracking freezes the object and keeps the grip for 0.7 s; if the hand comes back still closed you are still holding it, otherwise it drops in place with no momentum.

Only the object's shapes and colors cross the call (a `toss` message on the reliable `control` data channel, about 1 KB; `give` marks a throw, which hands the object over). The receiver validates it with `sanitizeModel` before rendering. Whoever has an object streams where it is about 30 times a second (`poses` on the unreliable `hand` channel: position on their raw camera image, height, rotation, held), clamped on receipt; an object whose poses stop for 1.5 s leaves the other screen. Both people need to be on this tab with the same build: each side announces itself (`throw-hello` with a version) when the call connects, and if the friend doesn't answer within 4 s (they joined from the Call tab, or run an older build), a warning says so instead of their screen silently staying empty.

Grabbing follows your palm centre (it does not move when your fingers close), smoothed with a One Euro filter, and draws your hand where it appears in the camera. Pinch and fist thresholds come from MediaPipe landmarks on real hand photos (`src/remote/handPhotos.json`, checked in `src/remote/twin.test.ts`); the same pinch fix applies to the Call tab's 3D copy.

Manual checks (a real camera cannot run headless): the drawn hand sits on your hand; grabbing works with both a pinch and a fist at arm's length and close up; turning the wrist turns the object without jitter; an up-flick or push throws, while a fast sideways shake, a slow release, or the hand leaving the camera while holding never does; it disappears into the friend's video and comes out of it on the other screen at about the same moment; while your friend holds it, it sits on their hand in their video on your screen and turns with it (on a phone and a computer, with differently shaped videos); the object reads clearly over a bright room.

## Voice: the listening agent (`src/voice/`)

GHOST listens to the whole conversation and uses it to decide which object to show.

- **Speech to text:** `cartesia.ts` streams the mic to Cartesia's STT WebSocket (`ink-whisper`, 16 kHz PCM) using a short-lived token from `POST /ai/voice-token` (set `CARTESIA_API_KEY` in `.env`). Audio is only sent around speech (an energy detector gates it, with a 300 ms pre-roll), which keeps credits down. With no key it falls back to the browser's recognizer. The first start asks for consent.
- **Both sides of the call:** each person's device transcribes its own mic and sends the *text* to the other over the control channel, so both agents hear everything and no audio is relayed.
- **Which object:** `referent.ts` matches names and synonyms locally (instant) and `FocusTracker` combines that with pointing. Say an object's name and it is shown and remembered with no time limit; point at something (steady ~0.45 s) and that takes over; naming a different object after you began pointing takes over again; moving your hand away keeps the last focus. Ambiguous or descriptive sentences ("the thing with the screen", "it") go to Claude (`/ai/focus`) with the conversation and the visible objects.
- **Render everything first:** while listening, the view is re-scanned whenever it changes (not on a timer), so every visible object already has its 3D model before you mention it; the box then shows whichever one you mean. Chips above the camera list what was spotted; tapping one is the strongest signal.

Cartesia protocol details are from its docs (`wss://api.cartesia.ai/stt/websocket`, `cartesia_version=2026-08-14`, `access_token` for browsers). The live Cartesia connection has not been exercised without a key; the protocol is covered by tests against a fake socket and by a browser run against a mocked Cartesia endpoint.

### Turning the copy: pinch and grip

- **Pinch** (thumb + index): grabs at the point between the two fingertips. The copy follows your hand, and turning your hand like a knob spins it about its vertical axis. Opening your fingers never spins it (the twist is read from the palm, not the thumb-to-index line).
- **Grip** (thumb + index + middle together): a firmer hold. The copy follows your whole hand's orientation in 3D: roll, tilt or turn your wrist and it turns with you.
- It turns about the spot you are holding, so that spot stays under your fingers. Switching between pinch and grip mid-hold does not make it jump. Letting go keeps the turn; ↺ puts it back.
- The box shows a PINCH or GRIP badge, lights the fingertips that hold, and outlines the object (yellow for pinch, orange for grip). The other person's box shows the same turn.

Logic: `src/remote/grasp.ts` (detection with hysteresis), `src/remote/twinMove.ts` (grab, move, turn), `src/remote/quat.ts` (rotation math). Pinch and grip are measured on the 2D image landmarks and checked against real hand photos (`src/remote/turn.test.ts`); turning gains are first guesses to tune on real hands. The Throwing prototype uses the same palm-orientation math to turn what you hold.

### Parts: the cap and the whole

An object is a **whole plus separately movable pieces**: Claude marks and names the moving parts when it builds the model (`moving: true`, `name: "cap"`), and `src/remote/components.ts` groups touching moving pieces into components. Nothing is selected first. Pinch or grip **on the cap** and only the cap moves or turns (twist it loose, then pull it clear of the bottle); do it **anywhere else** and the whole object moves, cap included. Hovering outlines whatever you would take, and the box says what you are holding ("pinching the cap"). Logic: `src/remote/twinRig.ts`. The other person's box shows the same, because each piece's movement travels in the pose message.

The box also has a **magnify** button (top right) and, when you are alone, shows a **mirrored** view so the hand moves the way your mirrored video does.

**Why a part is reachable:** vision lists a bottle and its cap as two objects, so `src/ai/foldParts.ts` folds a small object that sits inside a larger, related one (a cap in a bottle, a button in a box) into the larger object as a named moving part, and drops it from the list. Saying "the cap" still finds the bottle. Caps and lids behave like threaded parts: while screwed on they only turn in place, climbing as they turn either way, so a shaky hand cannot drag one off the neck. About two-thirds of a turn (two or three twists of the wrist) frees one; the box shows the progress ("twist to unscrew · 70%", then "cap is loose · pull it off"), and only then does it follow your hand. Holding uses the index fingertip, and the hold is frozen while the fingers open, so letting go never drags the object.

## Community assistance

Community adds email/password accounts, profiles, reactive helper availability, public/direct help requests, notifications and participant-authorized call assignments. Manual calls and the existing hand/3D features remain available. Start local Convex with `npm run convex`, configure auth once with `npm run community:auth`, then run `npm run dev`. After initial setup, `npm run dev:community` launches both together. See [the complete local setup and two-user checklist](docs/COMMUNITY.md). The hosted Render app uses a production Convex deployment; see the production section there.

### Two hands, and grabs that are deliberate

**Two hands.** The tracker follows up to two hands and keeps each in its own slot by where it is and how fast it is moving (`src/remote/handSlots.ts`), because MediaPipe's left/right label swaps and hands cross. Both hands are drawn in the box and on the call (a second hand message slot on the wire), and each can hold a different piece: steady the bottle with one hand and twist the cap with the other. A piece one hand holds cannot be taken by the other; closing on it takes the body under it instead. The second hand is tinted purple.

**Bottle or cap?** Each hand takes the nearest free thing, judged by the gesture as well as the position (`pick` in `src/remote/twinRig.ts`):
- **Fingertips** (a pinch, or an open hand about to pinch) take the cap when they are on it or just around it, and also when they land a little low on the neck.
- **A fist** (grip) takes the bottle unless it is squarely on the cap. Grip the bottle by its shoulder or neck and you get the bottle.
- Once one hand holds the bottle, the other hand closing anywhere near the cap takes the cap.
- While the other hand works on the cap, the hand on the bottle **steadies** it: the bottle follows that hand's position but no longer turns with it, so wobbles do not swing it.
- A hand that holds something and drops out of tracking for a moment (two hands close together hide each other) keeps its hold for 350 ms.
- What a hand is on is decided along the line of sight through the fingertip, so it stays right however the object has been turned: tip the bottle toward you and the cap under your finger is still the cap.

**Deliberate grabs.** Waving a hand over the object used to move it, because opening and closing your fingers while swinging looks like a pinch. A grab now only starts when the hand was open just before, had been over the part for a moment, and is closing slowly (`src/remote/grabGate.ts`). That is judged only at the moment of closing, so a closed hand sweeping over the object, or one that closes mid-swing, never catches it. Once held, it stays held. The fingertip is also smoothed (One Euro filter), which steadies the hover and the hold. Thresholds (open 120 ms, over it 110 ms, slower than 1.4 object-heights per second, 250 ms cooldown after letting go) are first guesses to tune on real hands.

### Real 3D models with SAM 3D (fal.ai)

The copy starts as Claude's simple shapes, which appear at once. Press **3D** in the box's corner and the AI server sends the scanned picture, with Claude's box around the object, to SAM 3D on fal.ai (`fal-ai/sam-3/3d-objects`). In about 15 seconds the box swaps in a real mesh of the object, in the scan's own colours. Needs `FAL_KEY` in `.env` (server-side only); without it the button does not appear.

- **The parts still work.** The mesh is fitted onto the model and cut along the same pieces (`src/render/meshFit.ts`): the part of the scan inside the cap's box becomes the cap, so you still twist the cap off and steady the bottle with two hands. A piece the scan has nothing for keeps Claude's shape.
- **Facing the right way.** SAM 3D returns an upright mesh plus the pose it had in the photo. The box keeps it upright and turns it about the vertical so the side the camera saw faces you (`samYaw` in `src/ai/mesh.ts`, checked on a real result).
- **The cache.** A finished model is stored on disk by the object's name (`.cache/meshes/`, or `GHOST_MESH_CACHE`), so a good model is never made twice: next time that object is scanned, its model appears at once. Both screens of a call read the same cache, so the other person sees the model too. In the enlarged box, ⟳ remakes it (the new one replaces the old one only if it succeeds), and ◆/◇ switches between the model and the simple shapes.
- **Smaller downloads.** fal's mesh is about half a million triangles (5-12 MB). The server merges nearby vertices down to tens of thousands (about 1-2 MB) and stores that compact format (`.ghm`) next to the original `.glb`.
- **Privacy.** Nothing goes to fal.ai unless someone presses 3D, and then only the one picture from the scan. It is sent whole: the box only tells SAM 3D which object to model.

Routes on the AI server: `POST /ai/mesh` starts one (returns at once), `GET /ai/mesh?key=` reports what the cache has and whether one is being made, `GET /ai/mesh/file/<key>` serves the compact mesh.

