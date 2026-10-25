# Hackathon log

- **Project:** Handoff
- **Event:** Cal Hacks 13.0
- **What it does:** Remote help for physical objects: on a video call the object becomes a 3D copy that the helper handles with tracked hands, and each session is saved as a replayable 3D lesson.
- **Live app:** https://ghost-68qn.onrender.com
- **Repo:** https://github.com/Wilozz/CalHacks13
- **Frontend:** Other (Render, `render.yaml`)
- **Convex deployment:** https://keen-mosquito-164.convex.cloud (production; the Render build runs `convex deploy` and bakes this URL into the app)
- **Components:** `@convex-dev/presence`
- **Convex features:** schema, indexes, queries, mutations, actions, HTTP actions (Convex Auth routes), scheduled functions, file storage, realtime useQuery
- **Auth:** Convex Auth
- **AI models:** `claude-sonnet-5-5`, `claude-haiku-5-5`, `fal-ai/sam-3/3d-objects`, `ink-whisper`, MediaPipe `hand_landmarker`, `efficientdet_lite0`, `mobilenet_v3_small`
- **Started:** 2026-10-24T07:17:00Z
- **Last updated:** 2026-10-25T08:15:33Z

## How we use Convex

- **Help requests and matching:** requests, sessions and notifications in indexed tables, with a scheduled mutation that expires unanswered requests (`convex/schema.ts`, `convex/community.ts`).
- **Accounts and profiles:** email/password sign-in with Convex Auth, served by HTTP routes (`convex/auth.ts`, `convex/http.ts`, `convex/profiles.ts`).
- **Who is online:** the presence component's heartbeat shows which helpers are around (`convex/presence.ts`, `convex/convex.config.ts`).
- **Friends and direct messages:** friendships, conversations and messages (`convex/social.ts`).
- **Tutorials:** each 3D lesson log is uploaded to file storage, then an action validates it before a mutation saves it (`convex/replays.ts`).
- **Live without a refresh:** the Community feed, Messages, notifications, member profiles, the Tutorials list and the nav request count are `useQuery` subscriptions (`src/community/*.tsx`, `src/replay/Tutorials.tsx`, `src/main.tsx`).

## Log

- 2026-10-24 `c851c28` hand tracking prototype with laptop video calls: `src/App.tsx`, `src/CallPanel.tsx`
- 2026-10-24 `43096fa` short-code calling, signaling and TURN: `src/CallSession.ts`
- 2026-10-24 `627a714` AI integration, helper hand overlay, 3D copy renderer: `src/ai/actionLibrary.ts`, `src/render/DemoScene.tsx`
- 2026-10-24 `798a529` throwing prototype: `src/throw/ThrowPrototype.tsx`
- 2026-10-24 `ea1b845` pinch and grip detection: `src/remote/grasp.ts`, `src/remote/pinch.ts`
- 2026-10-24 `376e48d` Convex community, profiles, friends, messaging: `convex/schema.ts`, `convex/community.ts`, `convex/social.ts`
- 2026-10-24 `f028f1b` production Convex Cloud + Render: `render.yaml`, `scripts/setup-community-auth.mjs`
- 2026-10-24 `1d92576` AI server served in production: `server/index.mjs`, `scripts/start.mjs`
- 2026-10-24 `6b8fb0a` Tutorials saved to Convex: `src/replay/Tutorials.tsx`, `convex/replays.ts`
- 2026-10-24 `526feba` lessons record themselves: `src/replay/log.ts`
- 2026-10-24 `951d6a9` SAM 3D models, two-hand rig: `src/render/TwinBox.tsx`, `src/remote/twinRig.ts`
- 2026-10-24 `282a186` hands work on the scanned mesh: `src/render/meshFit.ts`
- 2026-10-25 `295fe98` lanyard clip demo: `src/remote/kitRig.ts`
- 2026-10-25 `39a5dd1` mesh cache committed: `.cache/meshes/`
- 2026-10-25 `93f7d1e` one call flow, throwing prototype removed: `src/App.tsx`
- 2026-10-25 `ba4b30d` on-device object finder: `src/useObjectFinder.ts`
- 2026-10-25 `20f822b` click an object, shared 3D copy: `src/render/TwinBox.tsx`
- 2026-10-25 `4d76e93` helper mode, Claude scan as detector: `src/App.tsx`, `src/useLastSpeaker.ts`
- 2026-10-25 `f0bb922` helper mode fixes: `src/App.tsx`
- 2026-10-25 `41a364d` README rewrite: `README.md`
