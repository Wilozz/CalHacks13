# Handoff — hand tracking prototype

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

Open the printed localhost URL, start a call with **New call**, and allow camera and microphone access; hand tracking starts with the call (see "The call" below). The UI follows FaceTime: an iPhone layout on phones and narrow windows (≤800 px or touch), a Mac-window layout on computers. The flip button in the preview switches front/rear camera (on the home screen only). **Turn off camera** releases the webcam; Cancel also cancels initialization. The hand button in a call turns hand tracking on or off; **Hand tools** (or **⋯** in a call) opens placement, tuning and the AI scan. Permission errors include retry guidance. Camera access needs localhost or HTTPS.

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

## The call: click the object, both handle it, and that is the lesson (`src/App.tsx`)

There is one call screen. **New call** makes a room code; the other person types it into **Join with a code**. Hand tracking starts by itself once the call has the camera (it shares the call's camera track, so there is one camera and one permission prompt) and stops when the call ends. There are no preset objects and no hand skeleton drawn over the video.

1. **Objects on your camera get boxes; you click the one you want.** While no 3D copy is up, a small on-device model (`public/objects.worker.js`: MediaPipe EfficientDet-Lite0) boxes every object in your camera about 8 times a second. Each box, plus a box around each tracked hand (what you hold up), is compared with pictures of the stored lanyard (MobileNet-V3 embeddings against `public/demo/lanyard-ref*.png`, rendered from the saved SAM 3D mesh); the most lanyard-like box above `MATCH` (0.42) is labelled **lanyard**, the rest with what the detector calls them (bottle, cup, …). While there are boxes, your own camera goes big so you can click (Mac) or tap (phone) one. **Nothing ever comes up by itself.** The models load with the page (about 5 s the first visit, under 1 s once cached). No frame leaves the device for this.
   - **lanyard**: the stored SAM 3D lanyard (`public/demo/lanyard.*`, a plain file, no AI server needed), with the drawn claw and strap.
   - **anything else**: at once, the built-in shape for its name (a bottle gets a cap that unscrews; unknown things a box). Then Claude (`/ai/scene`) looks at the frame and, if it sees that object, its own model and name replace the shape; a SAM 3D model cached under that name is used too. No AI server: the built-in shape stays.
   With `FAL_KEY` set, a clicked object also gets the **3D** button: SAM 3D is made from the picture it was clicked in.
   Claude also teaches the finder: a small frame to `/ai/find` (Haiku, one yes/no) about once a second until it has seen the lanyard once; that crop is kept in this browser (`localStorage`, last 4), so from then on the device labels it at once. **⋯ → AI scan to 3D model → Saved for the demo → ★ lanyard** brings it out by hand.
2. **It appears on the screen itself**, over the video, on both screens, and **both people can handle it**. Both people's hands are drawn on it (yours cool, your friend's warm). Whoever takes it first holds it until they let go; meanwhile the other screen shows what they do, and its hands can point but not take it. If both take it at the same moment, the person who brought it out keeps it. Each new grab starts from where the last one left it. Tools (↺, ×) are top right. No message pills or notifications appear in the call; what happened goes to the browser console as `[call]`, `[find]` and `[lesson]` lines.
3. **That is the lesson.** It records on the screen that brought the copy out, from the moment it comes up until it is closed (×), another copy replaces it, or the call ends, and saves itself to **Tutorials** for both people ("… (from your friend)" on the other side).

Channels: the copy's pose (`twin-pose`, ~15 Hz while it moves, clip state included, resent every 300 ms by whoever moved it last) rides its own **unordered, no-retransmit** `pose` channel with a sequence number, so a lost packet on bad Wi-Fi never holds the next one up and a late one is dropped; a hold with nothing heard for 1 s has ended. The reliable `control` channel carries `twin` (the copy) and `lesson` (a saved lesson's id). Hands ride the `hand` channel as before. Grabbing uses your own camera's tracking, so your grab never waits on the network; only the other screen's view of it does.

Why on the device first: Claude takes about a second per look and the full scan (Hand tools → AI scan, Sonnet, a model of everything) many seconds; the device needs ~100 ms per frame. Generic "is this a lanyard" is weak on the device (other people's lanyards score 0.0–0.37 against the render, cards and keys up to ~0.3, measured on Wikimedia photos), but your own lanyard, the one the mesh was made from, scores far higher, and a learned crop of it higher still. Override Claude's model with `GHOST_FIND_MODEL`.

Manual checks (not headless): held up, the lanyard gets a **lanyard** box within about a second and a bottle a **bottle** box; nothing comes up until you click; clicked, it appears over the video on both screens; either person can grab, unclip and clip it, and the other sees it move with both people's hands on it; letting go and grabbing on the other screen continues from the same place; on throttled Wi-Fi it lags but does not freeze; after closing it both people find the lesson in Tutorials, with both people's hands and the claw opening and shutting.

## Tutorials: lessons record themselves (`src/replay/`, `convex/replays.ts`)

A lesson starts the moment a 3D copy comes up in a call and ends when it is closed, replaced, or the call ends; then it saves itself to **Tutorials**. It records on the screen that brought the copy out. Nothing on screen says it is recording; `[call] Lesson saved to Tutorials` is logged once it is saved. The other person gets the same recording in their Tutorials too (the saved id goes over the call's data channel and `replays.copy` adds it for them as "… (from your friend)", within 10 minutes of saving). Either person can rename or delete their copy; the file goes when both have deleted it. Under 2 s is not a lesson; recording stops at 3 minutes (four hands stay under the 8 MB cap).

A lesson is never video: both people's tracked hands (up to two each, all 21 points, with depth; the friend's as they arrived over the call) and the 3D copy's pose, whoever moved it (each piece, and whether the claw is open or clipped on). **Tutorials** is a live Convex query, newest first; a lesson plays in the same 3D box as the call, the lanyard with the hands on it, claw and strap included (play/pause, scrub, 0.5–2× speed, drag to look from any angle), and can be renamed or deleted. Older lessons from the removed Throwing prototype still play as before. The log is uploaded to Convex file storage, then the `replays.save` action checks its size (8 MB cap) and every field (the model like a Claude scan, hands with the call's own decoder, poses with the call's pose decoder) and deletes an upload that fails. Tutorials belong to this browser through a random key in `localStorage`, not an account. Saving needs Convex (`npm run convex` locally; the Render build deploys it).

## Voice: the listening agent (`src/voice/`)

The voice bar ("Handoff can listen to the conversation…") is not shown on the call screen any more, so the listening agent is off; the code is kept.

Handoff listens to the whole conversation and uses it to decide which object to show.

- **Speech to text:** `cartesia.ts` streams the mic to Cartesia's STT WebSocket (`ink-whisper`, 16 kHz PCM) using a short-lived token from `POST /ai/voice-token` (set `CARTESIA_API_KEY` in `.env`). Audio is only sent around speech (an energy detector gates it, with a 300 ms pre-roll), which keeps credits down. With no key it falls back to the browser's recognizer. The first start asks for consent.
- **Both sides of the call:** each person's device transcribes its own mic and sends the *text* to the other over the control channel, so both agents hear everything and no audio is relayed.
- **Which object:** `referent.ts` matches names and synonyms locally (instant) and `FocusTracker` combines that with pointing. Say an object's name and it is shown and remembered with no time limit; point at something (steady ~0.45 s) and that takes over; naming a different object after you began pointing takes over again; moving your hand away keeps the last focus. Ambiguous or descriptive sentences ("the thing with the screen", "it") go to Claude (`/ai/focus`) with the conversation and the visible objects.
- **Render everything first:** while listening, the view is re-scanned whenever it changes (not on a timer), so every visible object already has its 3D model before you mention it; the box then shows whichever one you mean. Chips above the camera list what was spotted; tapping one is the strongest signal.

Cartesia protocol details are from its docs (`wss://api.cartesia.ai/stt/websocket`, `cartesia_version=2026-08-14`, `access_token` for browsers). The live Cartesia connection has not been exercised without a key; the protocol is covered by tests against a fake socket and by a browser run against a mocked Cartesia endpoint.

### Turning the copy: pinch and grip

- **Pinch** (thumb + index): grabs at the point between the two fingertips. The copy follows your hand, and turning your hand like a knob spins it about its vertical axis. Opening your fingers never spins it (the twist is read from the palm, not the thumb-to-index line).
- **Grip** (thumb + index + middle together): a firmer hold. The copy follows your whole hand's orientation in 3D: roll, tilt or turn your wrist and it turns with you, 1.4 times as far (a wrist only turns so far, and the camera sees less of the turn than there is).
- It turns about the spot you are holding, so that spot stays under your fingers. Switching between pinch and grip mid-hold does not make it jump. Letting go keeps the turn; ↺ puts it back.
- The box shows a PINCH or GRIP badge, lights the fingertips that hold, and outlines the object (yellow for pinch, orange for grip). The other person's box shows the same turn.

Logic: `src/remote/grasp.ts` (detection with hysteresis), `src/remote/twinMove.ts` (grab, move, turn), `src/remote/quat.ts` (rotation math). Pinch and grip are measured on the 2D image landmarks and checked against real hand photos (`src/remote/turn.test.ts`); turning gains are first guesses to tune on real hands. The Throwing prototype uses the same palm-orientation math to turn what you hold.

### Parts: the cap and the whole

An object is a **whole plus separately movable pieces**: Claude marks and names the moving parts when it builds the model (`moving: true`, `name: "cap"`), and `src/remote/components.ts` groups touching moving pieces into components. Nothing is selected first. Pinch or grip **on the cap** and only the cap moves or turns (twist it loose, then pull it clear of the bottle); do it **anywhere else** and the whole object moves, cap included. Hovering outlines whatever you would take, and the box says what you are holding ("pinching the cap"). Logic: `src/remote/twinRig.ts`. The other person's box shows the same, because each piece's movement travels in the pose message.

The box also has a **magnify** button (top right) and, when you are alone, shows a **mirrored** view so the hand moves the way your mirrored video does.

**Why a part is reachable:** vision lists a bottle and its cap as two objects, so `src/ai/foldParts.ts` folds a small object that sits inside a larger, related one (a cap in a bottle, a button in a box) into the larger object as a named moving part, and drops it from the list. Saying "the cap" still finds the bottle. Caps and lids sit on their thread: a shaky hand cannot drag one off the neck, but **a firm pull (about a tenth of the object) pops it straight off**. Twisting works too and is optional: the cap turns in place and climbs, and about two-thirds of a turn frees it (the box shows "pull it off, or twist · 70%"). Holding uses the index fingertip, and the hold is frozen while the fingers open, so letting go never drags the object.

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

- **The parts still work.** The mesh is fitted onto the model and cut into the same pieces (`src/render/meshFit.ts`). A cap at the top is cut where the scan itself changes colour or width (a black cap on a clear bottle), searching near Claude's guess, so the cut lands on the real edge; other pieces take the scan inside their box. SAM 3D cannot do this itself: asked for the bottle and the cap as two boxes, it returns one object. A piece the scan has nothing for keeps Claude's shape.
- **The hands work on what you see.** With a mesh shown, the hands are hit-tested against the mesh's own shape (the body in eight horizontal slices, the cap as one box), not Claude's rougher shapes, and specks of background the scan picked up are dropped before fitting.
- **Facing the right way.** SAM 3D returns an upright mesh plus the pose it had in the photo. The box keeps it upright and turns it about the vertical so the side the camera saw faces you (`samYaw` in `src/ai/mesh.ts`, checked on a real result).
- **The cache.** A finished model is stored on disk by the object's name (`.cache/meshes/`, or `GHOST_MESH_CACHE`), so a good model is never made twice: next time that object is scanned, its model appears at once. The folder is committed to the repo, so every machine and the hosted app start with the models made so far, whoever scanned them; commit new ones the same way. Both screens of a call read the same cache, so the other person sees the model too. In the enlarged box, ⟳ remakes it (the new one replaces the old one only if it succeeds), and ◆/◇ switches between the model and the simple shapes.
- **Smaller downloads.** fal's mesh is about half a million triangles (5-12 MB). The server merges nearby vertices down to tens of thousands (about 1-2 MB) and stores that compact format (`.ghm`) next to the original `.glb`.
- **Privacy.** Nothing goes to fal.ai unless someone presses 3D, and then only the one picture from the scan. It is sent whole: the box only tells SAM 3D which object to model.

Routes on the AI server: `POST /ai/mesh` starts one (returns at once), `GET /ai/mesh?key=` reports what the cache has and whether one is being made, `GET /ai/mesh/file/<key>` serves the compact mesh.


### The lanyard demo: clipping the clasp onto the card

A lanyard (or badge, lobster clasp, name tag) is one object made of two pieces: the card, and the clasp with the strap above it (`src/remote/kitRig.ts`). It starts clipped together, as it was scanned (↺ puts it back that way):

1. **Grip the clasp and move it:** the claw stays shut, so the card comes along, hanging from it and swinging (a damped pendulum driven by how the clasp moves). Holding the card instead moves both together.
2. **Pinch the clasp** (thumb and index, as if pulling its lever): the lobster claw opens. **Lift it away** and the card slips off and stays where it hung. Or hold the card with your other hand: with the claw open, they come apart at once and each piece follows its own hand. The clasp is easy to take: its claw, the clip and the first stretch of strap all count, while a hand on the card's face always takes the card.
3. **Bring the open claw back to the card's hole.** Close enough, it lines itself up and the slot lights up ("let go to clip it on"). Right after unclipping it does not do this until you have moved it clear, so it never clips straight back on.
4. **Let go:** it snaps shut on the card ("clipped on ✓").

The lanyard strap is drawn too: two ribbons from the top of the clasp up out of the box, as if worn around a neck. It follows the clasp every frame, so it stays attached through carrying, swinging, unclipping and clipping back. The claw is drawn, not scanned: SAM 3D makes a blob of small shiny metal, and a scan cannot open. It is drawn bigger than life so it reads in the box. On a call, the other screen sees the claw open, snap shut and swing (the clip state travels in the pose message).

**Scan it once, keep it for the demo.** With `npm run dev` and `npm run ai` (with `FAL_KEY`) running:

1. Hold the lanyard with the card clipped on, in front of the camera, and scan (Hand tools → AI scan to 3D model → Scan my camera). Choose the lanyard or the card; either opens the lanyard, with a box around both.
2. Press **3D** in the box. In about 15 s the SAM 3D model replaces the simple shapes. It is cut where the scan narrows from the card to the strap (`fitLanyard` in `src/render/meshFit.ts`); the scan's own claw is replaced by the drawn one.
3. If it looks right, press **★** (keep for the demo). That writes `public/demo/lanyard.ghm`, `lanyard.json` and `index.json` into the app. Commit them.

From then on it comes with the app: **Saved for the demo** in the scan panel opens it without scanning, `?demo=lanyard` opens it on load, and any lanyard Claude scans uses it. No AI server is needed to show it. Saving only works while developing (`GHOST_KEEP=0` turns it off; the production start script does).
