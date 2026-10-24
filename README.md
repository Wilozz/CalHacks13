# GHOST — hand tracking prototype

A local browser proof of concept: webcam on the left, a live cyan 21-joint skeleton on the right. Includes a two-person WebRTC audio/video call panel. No simulated hand movement, accounts, signaling backend, or recorded video uploads.

## Run

Requires Node.js 20.19+ or 22.12+ and a recent desktop Chrome/Edge, Android Chrome, or iOS Safari (17+ with worker OffscreenCanvas support) with WebGL, WebAssembly, workers, and camera access.

```sh
npm install
npm run dev
```

Open the printed localhost URL, click **Enable camera**, and allow access. Hold one hand in view with good lighting. Toggle **2D landmark overlay** to compare tracking with the mirrored video. Use **Switch camera** to select the front or rear camera (or select it before starting). On a single-camera device the browser can fall back to the available camera. Stop camera releases the webcam; Cancel also cancels initialization. Permission errors include retry guidance. Camera access needs localhost or HTTPS.

```sh
npm test       # coordinate transform invariants
npm run build # TypeScript and production bundle
npm run preview
```

MediaPipe 0.10.32's runtime and WASM are copied from the installed npm package into ignored local assets by postinstall/predev/prebuild. The first session requires internet to download the hand model from Google's storage. Fonts also load from Google Fonts, with local fallbacks. Hand tracking frames and landmarks stay in your browser; these asset requests do not carry camera data. When you explicitly start/join a call, its camera and microphone streams are transmitted to the connected peer. Hand landmarks and the 3D scene are not transmitted. This is not a fully offline distribution.

## Pipeline

1. `App.tsx` acquires a 640×480 preferred front-facing stream, with a front/rear switch. The old stream is stopped before switching. Each new video frame becomes a transferable ImageBitmap. At most one frame is in flight: slow inference drops intermediate frames instead of building a queue.
2. `public/tracking.worker.js` initializes MediaPipe Hand Landmarker in VIDEO mode for one hand. CPU/WASM inference runs off the UI thread. It returns 21 normalized image landmarks, estimated world landmarks, handedness, and inference timing. The transferred bitmap is always closed.
3. `coordinates.ts` defines a plain serializable `HandFrame` boundary for a future WebRTC transport. World points are wrist-relative and uniformly scaled from meters to scene units. X is mirrored for the front selfie camera and unmirrored for the rear camera, Y is flipped for Three.js, and Z is flipped so negative MediaPipe camera-relative depth points toward the viewer. Image wrist XY positions the skeleton on screen. No independent finger scaling, synthesized pose, or removal of wrist rotation is applied. Image-space coordinates provide a less accurate fallback when world points are unavailable.
4. `HandScene.tsx` updates spheres and cylinder bones directly in React Three Fiber's frame loop. Exponential smoothing is frame-rate independent (roughly 42 ms time constant), and resets on reacquisition. The scene hides on tracking loss or stale results after 350 ms. React UI metrics refresh only four times per second.

## Performance and limitations

Rendering targets 30–60 FPS; actual tracking speed depends on your CPU, camera frame rate, browser, and lighting. Desktop inference runs as quickly as available frames allow (capped at 60 submissions/sec). Mobile camera capture and inference are capped at 30 FPS, with capture limited to a 640 px long edge while retaining its aspect ratio. Mobile 3D rendering targets up to 60 FPS at device pixel ratio 1; idle/background rendering is suspended, and inference pauses in hidden tabs. These limits reduce workload but cannot guarantee thermals or frame rate on every phone. CPU mode in a worker prioritizes UI responsiveness over device-specific GPU integration.

The FPS display measures the **render loop**, not inference throughput. Pipeline latency measures frame submission through bitmap creation, worker inference, and result receipt. Inference time measures MediaPipe alone. Neither measures true camera-exposure-to-display latency; camera buffering, presentation time, and smoothing add delay.

MediaPipe world landmarks are **monocular estimates**, not accurate full 3D reconstruction. Occluded fingers, fists, edge-on palms, rapid motion, and poor lighting can cause jumps or wrong depth. Global distance from the camera is unobservable here: wrist depth is intentionally anchored at zero, with screen XY estimated from the image. Wrist orientation comes from the landmark geometry without a rigid wrist rotation model. Bone lengths may fluctuate with model uncertainty; smoothing reduces jitter but adds lag. Image-only fallback is weaker and less metrically consistent. Handedness is MediaPipe's raw label (which can differ under selfie mirroring).

## Manual camera validation

Enable camera and verify live mirrored video; open and close the palm, point, move each finger, and rotate the wrist. Compare joint alignment using the debug overlay. Remove the hand and confirm the skeleton disappears; return it and confirm immediate reacquisition. Stop and restart the camera. Test denying permission and retry after changing browser site settings. Test disconnecting the camera and a blocked model download. Observe the render and inference metrics on your laptop; performance is not guaranteed from build checks alone.

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

Open **`https://192.168.1.42:5173`** on the phone, using your actual IP. It should show no certificate warning. Allow camera access after tapping **Enable camera**. If the page cannot load, allow the dev server through your laptop firewall and check Wi-Fi client isolation / guest-network restrictions. If there is a certificate warning, confirm the IP matches the certificate and the phone trusts the CA. After testing, you can remove the development CA profile from the phone.

### Device checklist

1. In portrait, verify no sideways scroll at small widths (including 320/375/390 px), readable status metrics, and 44+ px touch controls. Check notch and home-indicator spacing.
2. Enable tracking and allow permission. Check palm opening/closing, individual fingers, pointing, and wrist rotation against the 2D overlay. Front camera video and skeleton should both behave like a mirror.
3. Switch to rear camera while tracking. Confirm the old camera stops, the new camera starts, and video/landmarks/3D move together without selfie mirroring. Switch back. Camera switches restart the tracking worker/model; a brief loading state is expected.
4. Rotate portrait ↔ landscape during tracking. The video stays uncropped, overlay stays aligned, and the scene resizes. Resize events refresh actual stream dimensions; stale frames with the old aspect ratio are discarded.
5. Toggle landmarks, stop/restart, cancel loading, deny permission and retry after allowing it in site settings. Stop must turn off the phone's camera indicator.
6. Background the browser, return, and navigate away/back. Inference and mobile rendering pause while hidden; leaving the page releases the stream and worker, and returning may require **Enable camera** again. If the OS suspends the camera, stop/restart it.
7. Run for several minutes and observe FPS, inference latency, and device temperature. Test both iOS Safari and Android Chrome: desktop build checks cannot establish real-device tracking accuracy, battery use, camera orientation, or sustained FPS.


## Laptop-to-laptop video calls

Each person runs their own copy (`npm install`, then `npm run dev`) and opens their own `http://127.0.0.1:5173` in Chrome or Edge. No phone certificate or shared LAN URL is required. Both laptops need internet access for public STUN discovery. This is a WebRTC browser call, separate from Apple's FaceTime service.

1. On laptop A, click **Create invitation**, allow camera and microphone, then **Copy invitation code**. Send the entire code to B in your existing chat app.
2. On laptop B, paste that code under **Have an invitation?**, then click **Join friend's call** and allow camera and microphone.
3. B clicks **Copy reply code** and sends it back to A. Keep B's tab open.
4. A pastes that reply under **Paste your friend's reply code**, then clicks **Connect call**. Exchange the reply within two minutes; otherwise end and create fresh codes.
5. Both participants see live video and hear each other. Use **Mute microphone**, **Turn camera off**, and **End call**. If autoplay is blocked, click **Play friend's audio & video**. Headphones avoid feedback.

The call acquires its own media and can run without MediaPipe/model downloads. If tracking is already using the camera, the call clones its video track and separately requests microphone permission. Ending a call releases its tracks and peer connection; tracking continues if enabled. Stopping tracking does not stop an active call's cloned camera track. Thus the camera indicator stays on until both tracking and calling stop. Closing/leaving the page releases both. Camera-off disables the call track but leaves its session active; End call releases it. Tracking remains below the call panel and does not send remote landmarks or overlays.

Connection codes exchange complete SDP/ICE descriptions manually, avoiding a hosted signaling backend. Codes contain connection metadata: send them only to your intended friend. Media is encrypted in transit by WebRTC. A public Google STUN server discovers connection candidates; it does not relay media. Neither codes nor media are stored by GHOST.

### Restricted networks

Running localhost avoids the event Wi-Fi's block on opening a friend's web server, but **does not guarantee the peer media connection**. Some event Wi-Fi/NAT/firewalls block direct WebRTC too. Reliable calls there require an internet-reachable TURN relay; no working relay is bundled. This follows the [WebRTC connectivity guidance](https://webrtc.org/getting-started/peer-connections).

If you already have a TURN server, copy `.env.example` to `.env.local`, fill in `VITE_TURN_URL`, `VITE_TURN_USERNAME`, and `VITE_TURN_CREDENTIAL`, and restart Vite on **both laptops** before creating new codes. Prefer TURN over TLS/TCP on port 443 where UDP is blocked, if your relay supports it. Vite variables are public browser configuration: use short-lived development credentials rather than privileged long-lived secrets. Otherwise use a network that permits direct WebRTC; a public website URL alone will not solve a blocked media path.

### Call validation

Automated tests cover connection-code validation, offer/answer roles, complete ICE gathering, and cancellation, alongside the hand coordinate tests. Build checks do not establish real camera/microphone or network interoperability.

For a real call, follow the two-laptop sequence above and check both audio directions, both video directions, mute/unmute, camera off/on, tracking before/during the call, stop tracking while a call continues, end call from either laptop, cancel while permissions are pending, malformed codes, denied microphone access, and a blocked-network failure. Test two tabs on one laptop first if a second laptop is unavailable (wear headphones); a successful same-device test does not prove event-Wi-Fi connectivity.

## AI integration (`src/ai/`, `server/ai.ts`)

Implements the pipeline in `ai-integration.md`: hand history (2 s) and pointing detection, scene cache, transcript, the pointing + verb gate, Claude action parser with a fixed action library, the section 6 confidence policy (0.85 play, 0.6 confirm, else ask), a local offline fallback, and the context summarizer.

```sh
cp .env.example .env   # set ANTHROPIC_API_KEY
npm run ai             # AI server on :8787 (Vite proxies /ai to it)
npm run dev
```

Wire-up: `new Orchestrator(new Transcript(), {client: httpAiClient(), clock, viewerLanguage, onOutcome})`, feed it `orchestrator.hands.pushLandmarks(t, landmarks)` and `orchestrator.scene.update(objects, t)`, and finalize speech with `transcript.finalize(...)`. `Outcome.decision` is `play`, `confirm` or `ask` for the helper UI. The model proposes; `policy.ts` enforces the rules, so a confident wrong answer cannot skip confirmation, and fallback parses never auto-play.

Not built or unverified: streaming Cartesia STT (the browser Web Speech adapter gives turn-level timing only), the on-device segmentation, the helper confirm UI, the 3D renderer, and latency numbers. Model IDs and cutoffs are defaults to tune.

## Helper hand on the recipient's feed (`src/remote/`)

The core product path: the helper's tracked hand is sent as compact binary frames (`handWire.ts`, 262 bytes, unordered data channel) and drawn over the recipient's live camera view (`HandOverlay.tsx`). `placement.ts` anchors the index fingertip, sizes the hand from the rigid palm, and supports "follow" and "pin to a spot" modes. `RemoteHandState` drops out-of-order packets, counts loss and hides a stale hand after 350 ms.

Solo demo: the page encodes your own hand, sends it through `LoopbackChannel` (adjustable latency, jitter and loss) and draws it on your own camera view through the same decoder a remote helper's hand would use. `RtcHandChannel` is the real-transport adapter (`createHandDataChannel(pc)` on the offering side, wrap the channel from `ondatachannel` on the other); it is not yet connected to the call code and has not been run in a browser.

Placement puts the hand on the feed. It does not align it to a real component: monocular landmarks do not know where an object is.
