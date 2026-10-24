# Community — local development on `forum`

Community uses **Convex** for persistent profiles, requests, friends, private messages, notifications and session history, **Convex Auth** for email/password accounts, and **@convex-dev/presence** for reactive, multi-tab presence. The existing Node/WebSocket service still handles signaling; video, hand frames and object interactions still use the existing WebRTC peer connection. Nothing in this change deploys to Render or production Convex.

## Start locally

Node 22.12+ or 24 is recommended.

```sh
npm install
npm run convex
```

On a fresh checkout with no deployment selected, non-interactive Convex CLI provisioning can create an anonymous local backend. For an interactive terminal, select **local development** if prompted; do not choose a production deployment. Local backend state lives in ignored `.convex/`, and `.env.local` gets `CONVEX_DEPLOYMENT`, `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL`. Keep the Convex terminal running.

In another terminal, configure the LOCAL auth keys once, then launch the app:

```sh
npm run community:auth
npm run dev
```

`community:auth` refuses cloud deployments, generates an RSA signing key and JWKS inside the local deployment, never prints secrets, and preserves existing keys. Password authentication does not need external OAuth or email provider credentials. The setup here has no verification or password-reset email flow; use throwaway local test accounts rather than real reused passwords.

Once configured, a single command can run the backend and existing development services together:

```sh
npm run dev:community
```

It runs `convex dev --start "npm run dev"`. Stop any existing copies first to avoid port conflicts. Default ports: Vite **5173**, signaling **8787**, local Convex **3210**, Convex HTTP/auth **3211**, optional AI **8790**. `npm run dev` starts the original app/signaling/optional AI services; it does not launch Convex itself.

If `VITE_CONVEX_URL` is absent, standalone Call and Throwing prototype still load; Requests/Helpers/Activity/Profile show setup instructions. Use `npm run convex` to regenerate Convex types after backend edits. `convex/tsconfig.json` is checked separately.

## Two-user test

1. Open `http://127.0.0.1:5173/#community` in a normal browser profile and a private/incognito profile.
2. Sign up as two different users; the normal Call page remains accessible without login.
3. Make user B available in Community or Profile. Set a name, optional HTTPS avatar URL and comma-separated expertise tags.
4. User A clicks **Request Help**, enters a title/description/category, and submits. B sees the new Requests feed card and a live in-app notification without refreshing.
5. B clicks **Accept Help**. Messages opens for B with the automatic message: **Hey, I'm here to help! Want to join my call?** Both become busy while the invitation is pending. No call starts yet. A opens **Activity → Open messages** (or the Messages tab and the conversation).
6. A clicks **Accept call**. A enters the existing Call screen; B also enters automatically if still viewing the conversation. If B navigated away or refreshed, B can use **Join call** in Messages or **Join Session** in Activity. Both grant camera/microphone permission; no room code entry is required. The helper/recipient can still use hand tools, overlays, scanning and the existing 3D interactions (AI scanning requires its usual API key).
7. Test End call; both histories become Completed and both profiles become available again if availability was enabled. **End session** in activity can also close an unused/stuck assignment.
8. Test a direct request from Available Helpers, decline, cancellation, duplicate acceptance, refresh, and a third user's attempted entry.

Community room codes are participant-private: their first character is reserved `Z` so a manual `join` cannot bypass community authorization. Existing newly created manual calls use the remaining first-character space and need no accounts. Clicking Join Session sends a session ID and Convex access token to Node over the existing signaling connection. Node asks Convex to validate the actual JWT and session membership, and rechecks active assignments during its heartbeat; it does not trust a frontend user ID or the room code. Tokens are never put in URLs or public feed cards.

## Friends and direct calls

1. Every account receives a unique, searchable username based on its signup name. Missing handles on older profiles are repaired without replacing existing handles. You can change your username in **Profile**. Usernames are case-insensitive, 3–24 letters/numbers/underscores.
2. In **Messages → Find friends**, search at least two username characters. Search with or without `@` (for example `@Hetarth`); exact matches appear first. Click **Send request**.
3. The other account sees a request count on Messages, opens the **Friend requests** inbox section, and clicks **Accept friend** (or Decline friend). Pending requests persist across refresh and offline periods. Accepted friends get a private conversation.
4. Click **Message**, exchange text, then **Invite to call**. The recipient chooses **Accept call** or **Decline call**. The sender can **Cancel invitation** while waiting.
5. Accepting opens the call for the recipient and for the sender if the sender is watching that conversation. Otherwise use **Join call** later. Chat history survives refresh and call completion.

Help-request conversations do not require friendship. New direct call invites inside those conversations require accepted friendship. Pending call invitations reserve both participants to prevent double booking and expire after 30 minutes. Decline, cancellation, completion and expiry clear the reservation. Existing assignments created before this feature remain joinable.

## Member profiles and ratings

Navigation separates **Requests**, **Helpers**, **Activity**, **Messages**, **Call** and **Profile**. `#community` remains the Requests route; `#helpers` and `#activity` are independently reloadable routes. The large hero and small GHOST badges are removed.

Click an avatar on a request, helper card, friend/search result or conversation header to open the member profile. Cards show their bio, expertise, rating, unique people helped and completed help-session count. **Message** opens a private thread; **Send request** uses the existing friend-request flow. Edit your bio under Profile. Profile dialogs support keyboard focus, Escape and responsive sizing.

Counts and ratings are persisted transactionally. A help call must reach the connected state and then be explicitly completed to count. Friend calls, unjoined/cancelled invitations and expired sessions do not count. Helping the same requester again increments sessions but does not increment unique people helped. After completion, the requester can submit one 1–5 rating from Activity. Helpers cannot rate themselves or edit their stats. An unrated profile shows **Not rated yet**. Historical sessions that lack a recorded start timestamp are not guessed/backfilled; these statistics begin with sessions tracked by this feature.

`convex/profiles.ts` returns an explicit public-data allowlist, excluding email, auth data and private session assignments. Profiles and messaging require an authenticated account. `reviews` stores one review per qualifying session, `helpedPairs` prevents counting the same person twice, and optional profile counters keep card reads bounded.

## Data and functions

- Auth library tables: users, password accounts, sessions, refresh/verification tokens and auth rate limits.
- `profiles`: display name, optional unique username (indexed), optional avatar, expertise, availability and active assistance assignment, indexed by authenticated user ID.
- `requests`: public/direct request metadata and status, indexed by requester, recipient, helper and status.
- `sessions`: private room assignment, requester/helper, lifecycle timestamps and disconnect state, indexed by room code and both participants.
- `friendships`: normalized user pair, request sender and pending/accepted status; only participants can respond or list their requests.
- `conversations` and `messages`: normalized two-person thread, indexed message history, optional call-invitation references. Only participants can read/send.
- `notifications`: user-scoped persisted notifications and read status.
- Presence component tables: scoped session capabilities and timeout-driven online/offline state, including multiple tabs per account. No polling queries or query-time wall clocks are used.

`convex/community.ts` implements profile setup/update, public feed, available helpers, private activity/notifications, request creation, atomic acceptance, cancellation/decline, session authorization, connected/disconnected/completed transitions and scheduled expiry. `convex/presence.ts` wraps the component with identity checks; disconnect uses an unguessable session capability so page-close beacons can work after auth teardown. Public feed cards never contain room codes, and only participants can query a session assignment.

`convex/social.ts` implements username search/claims, friend requests, participant-only inbox/messages and explicit call-invitation acceptance. `src/community/Messages.tsx` renders these reactive views. Server-side signaling authorization rejects new sessions until their invitation is accepted.

Statuses: Pending → Accepted (call invitation pending/accepted) → In Session → Completed. A pending private request can be Declined by its recipient; its creator can Cancel a pending request. Pending requests and unjoined assignments expire after 30 minutes. One active assistance assignment per profile prevents double booking. Acceptance, busy assignment, notifications and session creation commit together in one Convex transaction.

## Disconnect behavior

A network/socket loss ends the current peer connection but preserves the assignment for a **60-second rejoin grace period**. Both users can return to Activity → Join Session; once both are ready again, the existing assignment resumes. This is rejoining, not an invisible seamless media reconnection. Explicit End call completes the assignment. If nobody reconnects successfully, a scheduled mutation expires it and clears busy state. An abrupt server/backend crash can require manually ending an assignment from Activity; local sessions/history survive browser refresh, but the signaling server's media rooms remain in memory.

## Configuration

- `.env.local`: generated local Convex deployment selection and `VITE_CONVEX_URL`.
- Node reads `.env` and `.env.local`; `CONVEX_URL` can explicitly set the backend URL used for server-side session checks. The local default uses `VITE_CONVEX_URL`.
- `ALLOWED_ORIGINS`: retains the existing signaling Origin allowlist. For two profiles on one laptop, localhost is enough.
- Convex deployment-only values: `JWT_PRIVATE_KEY`, `JWKS`; initialized by `community:auth`.
- TURN and Anthropic variables are unchanged; neither is needed for a same-laptop Community test with direct WebRTC and AI scanning disabled.

Do not copy auth signing keys into a `VITE_` variable. Ignore `.env*`, `.convex/` and certificates in Git. For a second physical laptop, both frontends must reach the same LOCAL Convex and signaling services over secure/trusted origins; using two independent local backends will not share accounts or requests. No production service change is necessary for testing two profiles on one laptop.

## Checks

```sh
npm test
npm run test:community
npx tsc --noEmit -p convex/tsconfig.json
npm run build
npm run test:e2e
```

Community backend tests use `convex-test`, Vitest edge runtime and registered presence components. Browser Community tests require the local Convex backend to be running and configured with auth keys. They create disposable test accounts in that LOCAL backend. Existing calling/throwing tests still run with synthetic media. Physical hand motion, real microphone quality and mobile cameras need the existing manual checks.

## Intentional limits

- Local password auth has no email verification/reset provider configured.
- Bounded views show the newest 100 public pending requests, 100 presence entries and 50 requests per activity index; pagination is future work.
- Manual anonymous calls remain outside community profile busy/session accounting; busy state represents Community assistance assignments.
- No followers, uploads, read receipts, attachments or leaderboards were added. Messages are plain text, persisted in Convex and protected by participant authorization; they are not end-to-end encrypted.
- Username search returns up to 20 matches; friends/conversations show up to 100 per participant index and chat shows the latest 100 messages. Older-history pagination is future work.
- Community acceptance is not a substitute for TURN/public networking; event-network reliability is a separate deployment concern.

## Production: Convex Cloud + Render

1. `npx convex login`, then `npx convex dev --once --configure new` to create the cloud project. This points `.env.local` at the project's cloud dev deployment; delete those lines and rerun `npm run convex` to go back to a local backend.
2. `npx convex deploy` pushes `convex/` to the production deployment. Then `npm run community:auth -- --prod` sets production `JWT_PRIVATE_KEY`/`JWKS`, and `npx convex env set --prod SITE_URL https://<your-app>.onrender.com`.
3. Convex dashboard → production deployment → Settings → **Generate Production Deploy Key**.
4. Render service → Environment: `CONVEX_DEPLOY_KEY` (that key) and `CONVEX_URL` (`https://<deployment>.convex.cloud`). The build (`render.yaml`) runs `convex deploy`, which pushes the functions and sets `VITE_CONVEX_URL` for the bundle. The deploy key is build-time only and never reaches the browser.
