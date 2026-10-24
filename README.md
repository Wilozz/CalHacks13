# GHOST — hand tracking prototype

A local browser proof of concept: webcam on the left, a live cyan 21-joint skeleton on the right. Includes a two-person WebRTC audio/video call panel. Includes a small shared signaling server; no simulated hand movement, accounts, or recorded video uploads.

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
npm run ai             # AI server on :8790 (Vite proxies /ai to it; 8787 is the signaling server)
npm run dev
```

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

## Throwing prototype (`src/throw/`)

A demo of "Reach Through": a hologram you grab and flick through the screen to the person you're calling. Open the **Throwing prototype** tab (top right on the start screen, or `/#throw`).

1. Pick **Mug**, **Pill bottle** or **Teddy bear**. These are preset `ModelSpec` shapes, so no scan or AI server is needed.
2. Grab it: pinch it with your tracked hand (thumb and index finger), or drag it with the mouse or a finger.
3. Flick and let go to throw it. It flies into the screen and comes out of the other person's screen, where it lands and becomes theirs to move and throw back. **Toss** does a flick for you.
4. With nobody on the call, a thrown object comes back to you, so the effect can be tried alone.

Only the object's shapes and colors cross the call (a `toss` message on the reliable `control` data channel, about 1 KB). The receiver validates it with `sanitizeModel` before rendering. Both people need to be on this tab; a toss sent to someone on the Call tab is ignored.

Manual checks (cannot run headless): pinch grabs only when the cursor ring is on the object; a fast flick throws while a slow release drops it; the hologram reads clearly over a real, bright camera feed.
