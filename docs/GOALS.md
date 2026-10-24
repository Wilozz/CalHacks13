# Goals

This is the baseline plan, not the final one. Add ideas under **Ideas** or **Open questions** rather than rewriting the core loop.

## Purpose

GHOST lets someone show you how to do something with your object, over a call. Video calls flatten the thing you need help with: "press the button on the left side" doesn't land when you can't see your phone the way the helper sees it. In GHOST the object becomes a shared 3D hologram that both people hold with their own hands, and you can watch the lesson again later.

Users: anyone getting remote help with a physical thing (a new phone, a pill bottle cap, a router, a camera). That covers family tech support, elderly relatives, and teaching across distance and language. The pitch for the Meta track is that AI brings two people closer together through a shared object instead of a screen.

Roles (the code uses these names):

- **Learner**: owns the object, asks for help, keeps the replay.
- **Helper**: knows how; receives the hologram and demonstrates on it.

## The core loop (what the demo must show)

1. **Scan.** The learner holds up an object. It turns into a 3D model "instantly". For the demo the model is pre-made with SAM 3 / SAM 3D and cached, so it appears with no wait (see ARCHITECTURE "Object pipeline").
2. **Grab and handle.** The learner grabs the hologram with one hand: pinch or fist, from a generous radius, with no fiddling. With the hand held, they can move it, rotate it with the wrist, and resize it with a second hand (pinch apart and together).
3. **Throw.** A deliberate toss toward the screen sends it to the helper. A drop, a slow release, or losing tracking must never throw it.
4. **Demonstrate.** The helper catches it and does the task on the model with their hands: presses the button, twists the cap, opens the hinge. The model's parts respond (the button goes down, the screen lights up). The learner watches the helper's 3D hands on the model live.
5. **Throw back.** The helper tosses it back.
6. **Replay.** The learner's copy now includes a recording of the session: the model's motion and part states, plus both people's 3D hands. It does not include the call video. They can scrub it, replay it from any angle, and keep it for later ("how did I turn this on again?").

## Current milestone (CalHacks demo, submission Oct 25 2026, 9:00 PDT)

Must work live, on two laptops, on event Wi-Fi:

- [ ] **Hero: lanyard hook into a cardboard tag.** The hook has come off the tag; the helper shows how to clip it through the tag's slot (align, thread through, the tag hangs and swings). See ARCHITECTURE "Assembly". This must be the most polished thing in the demo.
- [ ] 1–2 backup cached objects with interactive parts (e.g. a phone power button, a pill bottle push-and-twist cap).
- [ ] Grab, move, rotate and two-hand resize that feel effortless (see ARCHITECTURE "Interaction").
- [ ] Throw with zero accidental throws in a 2-minute handling test.
- [ ] Both hands of the holder are sent to the other side and drawn on the model.
- [ ] Part interactions (press, twist, slide, hinge) driven by the hand, synced over the call.
- [ ] Session recording, a saved replay list, and a replay viewer with scrub and orbit.
- [ ] Convex backend: cached models, replays, and a live-updating replay list.
- [ ] Recorded demo video for Devpost.

## Status

Done:

- Live single-hand tracking in a worker with a 3D skeleton (desktop and phone browsers)
- Front/rear camera switch, mobile performance caps
- Two-person WebRTC calls via six-character room code, automatic signaling
- TURN relay support (coturn shared secret or managed provider), relay-only mode
- Throwing prototype (`src/throw/`): preset primitive objects, palm-anchored pinch/fist grab, turn it with your palm, throw (up-flick or push) through a portal over the friend's video; it comes out of a portal on their screen toward them
- Wilson's branch merged: voice agent (Cartesia STT, `src/voice/`), pinch/grip turning of the Call tab's 3D copy (`src/remote/grasp.ts`, `quat.ts`)
- Claude vision scan into a primitive `ModelSpec` twin, and an action library (`twist press pull push slide lift flip tilt`) with procedural animation (`src/render/motion.ts`)
- Helper hand wire format (`src/remote/handWire.ts`, 262 B/frame), not yet sent over the real call
- Unit tests and Playwright e2e (direct and relay)

Next, in build order (each step demoable on its own):

1. ~~**Throw safety.**~~ Done: `isThrow` in `src/throw/toss.ts` (held ≥ 0.25 s, up-flick or push only), and tracking loss freezes the object instead of releasing it.
2. **Mesh objects.** Load cached GLB models next to `ModelSpec` primitives. Add an object profile with parts, pieces and connectors (ARCHITECTURE "Object profile" and "Assembly").
3. **Two hands.** Set `numHands: 2` in the worker, assign hands to pieces by continuity, hold one piece in each hand, and add two-hand resize and rotate.
3b. **Assembly.** For the lanyard: align assist, thread the hook tip through the tag slot, then the tag hangs and swings (ARCHITECTURE "Hook into tag slot"). Unit-test the math first.
4. **Hands over the call.** Connect `RtcHandChannel` in the call and draw the remote hands on the shared model.
5. **Part interactions.** Hit-test fingertips against part hotspots and drive part state. Sync the state over `control`.
6. **Recording and replay.** Record the event log, upload it on throw-back, and add a replay viewer.
7. **Convex.** Model files, profiles and replays (ARCHITECTURE "Backend: Convex").
8. Polish: the scan "moment" (a scan effect, then the cached model appears), sound, captions.

## Tracks we're targeting

| Track | Why we fit | What we need to show |
|---|---|---|
| **Meta: Bringing People Closer Together with AI** (primary) | Remote help through a shared object, built on Meta's SAM 3 / SAM 3D | SAM pipeline visible in the pitch, the two-person loop |
| **Convex: Best use of Convex** | Backend for models, replays and the live replay list. A reactive query makes the replay appear as the object is thrown back | Replay shows up live; file storage for meshes and logs |
| **[MLH] Vultr** | Host the app and signaling. A Vultr GPU can run SAM 3D for live, uncached scans | App deployed on Vultr. GPU scan is optional |
| **Cartesia** | Helper's voice to captions or translated speech during the demo | Live captions in the call and saved into the replay |
| **Cal Hacks overall / Most Technically Advanced / Most Creative** | Worker hand tracking, WebRTC data channels, 3D, AI part classification | A clean live demo |
| **[MLH] GoDaddy domain** | Cheap win | Register a domain and point it at the deploy |

Possible but not planned: Tiger Data (we chose Convex for storage), Elastic (search across saved replays by "how do I…"), Fetch.ai (agents). Prefer depth on a few tracks over a thin integration everywhere.

## Non-goals

- Accounts or login. A replay is tied to a browser-held key or the room, not a user.
- Recording or storing call video or audio. Only the 3D event log is saved.
- Simulated or synthesized hand motion (replays are real recorded hands only)
- Real-time SAM 3D during the demo (it's cached; live scanning is a stretch goal)
- A general physics engine. Motion is kinematic plus simple scripted bounce and gravity.
- Multi-instance signaling (rooms are in-memory by design)

## Ideas (not committed)

- Live uncached scan on a Vultr GPU, with the cached model shown first and swapped in when the real one is ready
- AI step detection: split a replay into "Step 1: hold power 3 s" chapters from the part-state events
- Learner "try it" mode: after the replay, the learner repeats the steps and GHOST checks each part state
- Ghost hands: play the helper's recorded hands on the learner's model while the learner follows along
- Share a replay link with someone else

## Open questions

- Replay ownership without accounts: is a random replay id plus a key kept in `localStorage` enough for the demo?
- Hook type: a plain open hook, or a spring-gate clasp (lobster or trigger)? This only sets the `gate` flag. Photograph the real hook and tag first.
- Who decides part affordances: Claude per object (with a human check on the cached ones), or hand-written profiles for the 3 demo objects? Recommended: Claude-generated, then hand-checked and committed.
- Does the learner watch the helper's demonstration in 3D only, or 3D overlaid on the helper's video?
- One shared scene (both see the same object at once) or the current "only the holder has it" model? Currently the holder has it. That keeps conflicts away and makes the throw meaningful.
