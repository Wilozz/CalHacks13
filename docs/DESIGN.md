# Handoff design (approved look, not built yet)

This is the approved visual redesign for Handoff on iPhone and Mac. It is a **restyle only**: every feature that exists today keeps working exactly as it does now. Nothing in this document is implemented yet. Build it in small steps (section 9) and keep `npm test`, `npm run build` and `npm run test:e2e` green after every step.

- **Live design canvas:** https://claude.ai/artifact/QBy2kkPZLskqvA7czZV1Rf (private to the owner until shared from its Share menu)
- **Frozen copy in this repo:** `docs/design/screens/*.jpg` (pictures) and `docs/design/source/*.html` (open in a browser; exact sizes, colors and spacing are in the inline styles)
- **Designed against:** commit `1a730d4` (2026-10-24). The app is changing quickly. Before building, redo the parity check in section 10 against the current code. If a feature was added since, give it a place in the same style. If one was removed, drop it from the design.

## 1. Rules that are not negotiable

1. **No functional change.** Same components, same state, same handlers, same Convex calls, same call and tracking code. Only markup and CSS change. Nothing is added, removed or moved between screens, apart from the navigation layout in section 5.
2. **Every accessible name, `data-testid` and class in section 11 stays exactly as written.** The Playwright suite finds controls by these names, so a visible label may look different only if the accessible name stays the same (`aria-label`). Two controls on one screen must never share a name: Playwright's strict mode fails when a name matches twice.
3. **Brand:** the only mark is the word **Handoff**, set in the system font, bold. No logo, no app icon artwork, no illustrations, and no photos or 3D renders used as decoration or wallpaper.
4. **Do not slow demos.** No splash screen, no intro, no added steps or confirmations. Animations never block input, run at most about 0.5 s, and are switched off under `prefers-reduced-motion: reduce`. The call path (New call → Share code → Join → click the object → handle the 3D copy → End call) has exactly the same number of taps as today.
5. **Keep the AGENTS.md invariants.** No recording indicator for lessons. Call video and audio are never recorded. Manual calls need no account.
6. **No new dependencies.** Icons are inline SVG in the existing `src/icons.tsx` `Icon` component; the paths come from Phosphor Icons (MIT), and you copy only the ones used. Motion is plain CSS. The bundled Inter font stays as the fallback.

## 2. What the pictures in the mockups are

| In the mockups | What it really is |
|---|---|
| The photo of a white mug | A **stand-in for the live camera video** (`.camera-stage video`, `.friend-video`, `.self-video`). It is not part of the design. |
| The blue lanyard and badge card | A render of the committed mesh `.cache/meshes/lanyard.glb`. It shows **only where the app really draws the 3D copy**: the in-call copy (`TwinBox`), the 3D copy tools and the lesson player (`ReplayPlayer`). It is never a logo or a background. |
| Jordan, Sam, Priya, Alex, their messages and requests | Sample data. Real screens show real Convex data. |
| Gray circles with an initial | `MemberAvatar` when there is no avatar URL. When there is one, it shows the image in the same circle. |

## 3. Look and feel

Apple-like, quiet, no AI tropes: no gradient text, no glow, no emoji, no slogans, no eyebrow labels. Calls are dark (like FaceTime). Everything else is light, using iOS grouped lists on the phone and Mac sidebars on the desktop.

### Colors (define them as CSS custom properties in `design.css`)

| Token | Light | Call / dark | Use |
|---|---|---|---|
| `--bg` | `#F2F2F7` | `#000` | Page background (grouped) |
| `--surface` | `#FFFFFF` | `rgba(30,30,32,.55)` with `backdrop-filter: blur(30px) saturate(170%)` | Rows, cards, call material |
| `--sidebar` | `#ECECEF` | | Mac sidebar |
| `--label` | `#000` | `#FFF` | Main text |
| `--label-2` | `#3C3C43` | `rgba(235,235,245,.85)` | Secondary text |
| `--label-3` | `#6C6C70` | `rgba(235,235,245,.6)` | Tertiary text, meta (passes 4.5:1 on `--bg`) |
| `--separator` | `#C6C6C8`, 0.5 px | `rgba(255,255,255,.12)` | Hairlines, inset from the left like iOS |
| `--fill` | `rgba(118,118,128,.12)` | `rgba(255,255,255,.14–.18)` | Search fields, segmented controls, glass buttons |
| `--tint` | `#0066CC` (hover `#004F9E`) | `#0A84FF` | Links, primary buttons |
| `--call` | `#1F7A35` (white text) | | New call, Join Session, Accept call |
| `--live` | `#34C759` | `#30D158` | Available dot, switch on, in-session dot |
| `--end` | `#FF3B30` | `#FF3B30` | End call and Decline call circles (icon only) |
| `--danger-text` | `#C4001A` | | Delete, Log out, End session (text) |
| `--warn-text` | `#C93400` | | "pending" status |
| `--error-bg` / `--error-text` | `#FFE5E3` / `#8A1C12` | | `role="alert"` banners |
| `--hand` | | `#64D2FF` | Hand and grip accents |

### Type

- **Font stack:** `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter Variable", system-ui, sans-serif`. Room codes use `"SF Mono", ui-monospace, Menlo, monospace` with letter-spacing of 0.08–0.14em.
- **Phone sizes:**
  - Large title 34/41 bold
  - Title 28/34 bold
  - Headline 17 semibold
  - Body 16–17
  - Subhead 15
  - Footnote 13
  - Caption 11–12
- **Mac sizes:** window title 15 semibold, body 13, secondary 11–12.
- **Tracking:** tighten large text (about −0.015em) and leave body text at 0.

### Shapes and spacing

- **Side margins:** 16 px on the phone. Mac panes use 20–28 px.
- **Phone corner radii:**
  - Grouped list 12
  - Card 16–18
  - Bottom sheet 34 (top corners)
  - Pushed modal 12
  - Big button 14 (50 px tall)
  - Small button 10 (36 px)
- **Mac radii:** 7–8 for controls, 14 for dialogs.
- **Tap targets:** at least 44 px on the phone.

### Motion (CSS only)

- **Press:** `:active { transform: scale(.97) }` over 100 ms ease-out.
- **Enter (sheets, cards, dialogs):** 350–500 ms with `cubic-bezier(.2,.9,.25,1)`. Glass surfaces also fade from `blur(6px)` to none.
- **Calling:** two rings expand from the round button (`scale 1 → 1.9`, opacity `.6 → 0`, 2 s, offset 1 s). The status text gets a light shimmer (2.2 s linear).
- **Incoming invite:** the Accept circle has a soft halo (1.6 s).
- **Reduced motion:** every animation above is off under `prefers-reduced-motion: reduce`.

### Icons

Phosphor "regular" weight, with "fill" for selected or active states. These replace the existing `Icon` names one for one:

| Existing name | Phosphor icon |
|---|---|
| video | video-camera |
| videoOff | video-camera-slash |
| mic | microphone |
| micOff | microphone-slash |
| hand | hand |
| more | dots-three |
| end | phone-disconnect |
| share | share |
| flip | camera-rotate |
| close | x |

The new navigation also uses chat-circle, users, clock, cube, magnifying-glass, plus and star.

## 4. Two layouts, chosen by the existing switch

Use the existing `useMobileDevice()` (`max-width: 800px` or a coarse pointer) and the existing `app phone` / `app mac` classes. Do not add another breakpoint. The Playwright suite runs at desktop size, so the **Mac layout is the one the tests see**.

## 5. Navigation (the only structural change)

The top tab bar in `main.tsx` becomes:

- **Phone:** a floating bottom bar with **Call · Requests · Messages · Lessons**. Inside Requests, a segmented control switches **Open · Helpers · Activity**. Profile is the avatar button at the top right of Requests.
- **Mac:** a left sidebar with **Call · Requests · Helpers · Activity · Messages · Lessons**, plus a **Profile** row at the bottom. The Mac shows no segmented control, so no name appears twice.

| Today | Phone | Mac | Accessible name (keep) |
|---|---|---|---|
| Call tab | Tab | Sidebar | `Call` |
| Requests tab | Tab, then segment "Open" | Sidebar | `Requests` (tab and sidebar). The phone segment is named `Open` so it never collides. |
| Helpers tab | Segment | Sidebar | `Helpers` |
| Activity tab | Segment | Sidebar | `Activity` |
| Messages tab (with friend request count) | Tab with red badge | Sidebar with count | `Messages`. Badge `aria-label` `${count} friend requests` |
| Tutorials tab | Tab "Lessons" | Sidebar "Lessons" | Visible label changes to **Lessons**. Nothing tests the old name. Update the README wording in the same change. |
| Profile tab | Avatar button | Sidebar row | `Profile` |

All navigation items are real `<button>`s, as today. The `<a>` links in the canvas exist only so the prototype can click through.

## 6. Screens

The file names refer to `docs/design/screens/`. Each screen restyles the component named next to it.

### Call (`src/App.tsx`, `src/CallPanel.tsx`)

- **`iphone-01-home` / `mac-01-home`:** `screen==='home'`.
  - **Camera:** the live camera fills the top of the phone screen, or the whole window on the Mac. Overlaid on it are `self-label` ("Hand tracked" / "Looking for your hand"), **Turn off camera** and the flip button (`Switch to rear camera`).
  - **Object boxes:** SceneOverlay boxes keep today's behavior: invisible until hovered or pressed, then corner brackets plus the label chip.
  - **Sheet:** a bottom sheet on the phone, or a floating glass sidebar on the Mac. It holds **New call** (green), the field labelled **Join with a code** with its **Join** button, the latest lessons and the **Hand tools and lab** link. Banners (`role="alert"` and `role="status"`) and the "Hand tracking runs on this device…" fine print go at the bottom of the sheet.
  - **Camera off:** when the camera is off, the camera area shows "Your camera and hand tracking turn on when the call starts." and **Turn on camera** / **Try again**, as today.
  - **Removed decoration:** the "A hand. From anywhere." heading is removed. It is decoration, and no test uses it.
- **`iphone-02-calling` / `mac-02-calling`:** `screen==='calling'`.
  - **Background:** the user's own camera fills the screen.
  - **Rings:** two rings ripple from a frosted circle holding a video icon.
  - **Code and status:** the room code (`data-testid="room-code"`, no space inside the code) sits above the status line, which uses the exact `callStatus` text ("Getting camera and microphone ready…", "Connecting…" or "Waiting for your friend…").
  - **Buttons:** **Share code** sits above the call controls.
  - **Relay warning:** the "No TURN relay on this server…" warning shows as fine print when it applies.
- **`iphone-03-call-invite`:** a full-screen presentation of an **existing incoming call invite** (`social.invite`, answered with `respondInvite`). It shows the caller's name, avatar initial and request title, with **Decline call** / **Accept call** (visible "Decline" / "Accept").
  - **Optional, low priority.** The in-chat invite card (`iphone-18-chat`) already covers this.
  - If you build it, show it only while the app is open and an invite is pending, and close it the moment the invite stops being pending.
  - It must never appear for code-based calls.
- **`iphone-04-in-call` / `mac-03-in-call`:** `screen==='incall'`.
  - **Video:** the friend's video fills the screen and the user's own video is the small rounded inset.
  - **Status pill:** shows room code · clock · route (`data-testid="room-code"`, `data-testid="call-state"` showing `mm:ss` or "Reconnecting…", then "Direct" or "TURN relay").
  - **3D copy:** the shared 3D copy (`TwinBox`, `aside` named `3D copy of <label>`, classes `.twin-box.stage`) sits in a frosted panel with the object label and the GRIP/PINCH chip.
  - **Controls:** a glass bar with **Mute microphone**, **Turn camera off**, **Show my hand** (white when on), **Hand tools** and **End call** (red).
  - **No text overlays:** no message pills, voice bar or detection boxes on screen, matching today's behavior.
- **`iphone-06-hand-tools`:** the existing **Hand tools** sheet (`role="dialog"`, `aria-label="Hand tools"`) as a dark bottom sheet with **Close**.
  - **Hand placement:** **Follow my finger** / **Pin to a spot** (group "How the hand is placed") and the live hint text.
  - **Collapsible sections:** the same `<details>` sections, "Tune the hand" (HandAdvanced) and "AI scan to 3D model" (ScenePanel: **Scan my camera**, **Scan my friend's view**, "Re-scan my camera every 6 s", "Detected objects", the **Saved for the demo** group with "★ label", then the demo preview, DemoPanel). Contents unchanged.
- **`iphone-07-3d-copy-tools`:** the `TwinBox` tool buttons restyled as one glass toolbar. It keeps every existing button and title, shown under the same conditions as today:
  - Show the SAM 3D model / Show the simple shapes
  - Make a 3D model / Remake the 3D model
  - Keep this model for the demo
  - Make it bigger / Make it smaller
  - Put it back
  - Close 3D view
- **`shared-states`:** the real messages in the new style:
  - **Call pill:** Reconnecting… and TURN relay.
  - **Video wait:** Waiting for video….
  - **Play friend's audio and video:** the `play-audio` button.
  - **Error banners:** camera permission, Room not found, two people, calling server.
  - **Status messages:** "Your friend ended the call." and "Call ended.".
  - **Loading:** "Loading hand tracking model…" with Cancel.
  - **Community notification toast:** with **Dismiss notification**.
  - **Request sent** status.
  - **Empty and loading states.**
  - **Community setup needed.**
  - **Tap again to delete.**

### Lessons (`src/replay/Tutorials.tsx`, `ReplayPlayer.tsx`)

- **`iphone-05-lesson` / `mac-04-lessons`:** the list `Saved tutorials` (newest first; each row shows name, date and duration, with a plain cube icon and no thumbnail) and the open player (`.replay-player canvas`).
  - **Player controls:** play/pause, the **Position** scrubber, **Speed**, and "Drag to look around".
  - **Rename and delete:** **Rename** opens the name field (`aria-label="Name"`) with **Save name**. **Delete** becomes **Tap again to delete**, as today.
  - **Captions:** shown only when the replay has captions.
  - **"From your friend":** copies keep their "(from your friend)" name suffix.
  - **No "who helped" line:** replays don't store a helper, so don't show one.

### Community (`src/community/*`)

- **`iphone-10-sign-in` / `mac-10-sign-in`:** `Login`.
  - **Header:** the word Handoff, then the heading **Welcome back** (or **Join Handoff** when signing up).
  - **Fields:** **Display name** (sign-up only), **Email**, **Password**.
  - **Buttons:** **Log in** / **Create account**, and the toggle **New here? Sign up** / **Already a member? Log in**.
  - **Link:** "Not now — start a call with a code" only switches to the Call screen (which exists today).
  - **Error:** the error copy is unchanged.
- **`iphone-11-requests` / `mac-11-requests`:** `Community view="requests"`.
  - **Heading:** **Help requests**.
  - **Available toggle:** the "Available to help" switch, which is today's available toggle, with the same busy/disabled rules.
  - **Feed:** one row per request (avatar, title, description, requester · category · age).
  - **New request:** the **Request Help** button opens the request form (the + button on the phone; on the Mac it's the + in the list header).
  - **Mac:** shows the list on the left and the selected request on the right.
  - **No search field or category filter.** Neither exists today.
- **`iphone-12-request-detail`:** a request with its full description and **Accept Help** (today's accept → open chat flow).
- **`iphone-13-request-assistance` / `mac-13-activity-and-request`:** the existing compose dialog (`aria-label="Request assistance"`).
  - **Title text:** the dialog title is **Request assistance**, or **Ask this helper** when opened from a helper.
  - **Fields:** **Title**, **Description**, **Category** (Assembly, Electronics, Everyday tasks, Home repair, Other), **Send request**, and close (`Close request form`).
  - **Recipient:** shown read-only. There is no recipient picker: a private request is only created from a helper's **Request help** button, as today.
- **`iphone-14-helpers`:** `Community view="helpers"`, heading **Available helpers**. Each row is an `article` showing name, expertise, rating ("Not rated yet" when unrated) and people helped, plus a **Request help** button. The avatar is a button named `View <name>'s profile`.
- **`iphone-15-member-profile`:** the `MemberDialog` sheet (`role="dialog"`, `aria-label="Member profile"`, close named **Close profile**).
  - **Header:** avatar, name, @username.
  - **Buttons:** **Message**, plus **Send request** / **Request sent** / **Request received** / **Friends**.
  - **Stats:** **Rating**, **People helped**, **Help sessions**.
  - **About:** bio and expertise.
- **`iphone-16-activity`:** `Community view="activity"`, heading **Your activity**, grouped into "Asked you", "Now" and "Earlier".
  - **Status words:** stay as the raw status text in the DOM ("pending", "in session", "completed", "cancelled"). Capitalize them with CSS only, because a test reads `completed`.
  - **Buttons:** **Accept**, **Decline**, **Cancel request**, **Join Session**, **Open messages**, **End session**.
  - **Rating:** the `<select>` labelled **Rate your helper** plus **Submit rating**, then "Rated 4/5". No stars: a test drives the `<select>`.
  - **Notifications:** the notifications block and **Mark notifications read** stay.
- **`iphone-17-messages` / `mac-12-messages`:** `Messages`, heading **Messages & Friends**.
  - **Find friends:** the **Search usernames** field and its results, with **Send request**.
  - **Friend requests:** the `Friend requests` region with **Accept friend** / **Decline friend**.
  - **Friends:** the Friends list. In the mockup it sits under the friend requests and is collapsed.
  - **Conversations:** keep the `.conversation-link` class on each conversation.
  - **No unread dots or read receipts.** Neither exists.
- **`iphone-18-chat`:** the conversation.
  - **Messages:** bubbles in the iMessage style.
  - **Invite button:** **Invite to call** is the video button in the header.
  - **Invite card:** a pending invite shows as a card with **Decline call** / **Accept call**. The sender sees "Waiting for your invitation to be accepted…" and **Cancel invitation**. An accepted invite shows **Join call**.
  - **Composer:** the field labelled **Message** and **Send message**.
- **`iphone-19-your-profile`:** `Profile`, heading **Your profile**.
  - **Fields:** **Display name**, **Username**, **Avatar URL (optional, HTTPS)**, **About you**, **Expertise (comma-separated, up to 8 tags)**, and the checkbox **Available to help when online**.
  - **Buttons:** **Save profile** ("Profile saved." status) and **Log out**.

## 7. Things in the mockups you must NOT build as new features

- A search field or category filter on Requests.
- Unread dots or read receipts.
- A picker for choosing the recipient of a request.
- Star ratings.
- Toasts for "Lesson saved".
- In-call message pills or a voice bar. Both were removed on purpose.
- A Throw button. There is one shared copy, and the first grab holds it.
- Any logo.
- Any splash screen or onboarding.

## 8. Copy

Keep all existing strings unless they are pure decoration. That means removing page eyebrows such as "YOUR NEXT CONNECTION", "Handoff LIVE" and "THE HUMAN BEHIND THE HAND", and the gradient hero line. Do not reword errors or the voice consent text.

## 9. How to build it, in order

Each step is its own commit. After each one, run `npm test`, `npm run build` and `npm run test:e2e`.

1. Add the tokens, type and motion to `design.css`. Swap the icon paths in `src/icons.tsx`. No markup changes yet.
2. Navigation shell in `main.tsx`: the phone bottom bar and the Mac sidebar (section 5).
3. Call home screen, then Calling, then In call, then the Hand tools sheet and the 3D copy toolbar.
4. Lessons.
5. Community: sign-in, requests (and the request form), helpers and member profile, activity, messages and chat, profile.
6. States and banners.
7. Optional: the full-screen call invite.

Then:

- Go through the manual checklists in `README.md` on a real iPhone and a real Mac. Camera, tracking and call quality can't be checked headlessly.
- Update `README.md` wherever it says "Tutorials".

## 10. Parity check (redo it before you start)

Run this, and compare every string and control it prints with section 6:

```sh
grep -rhoE "aria-label=[{\"'][^\"'}]*|>[A-Z][^<>{}]{3,80}<|'[A-Z][^']{4,90}'" src/App.tsx src/community src/replay src/render/TwinBox.tsx src/render/SceneUi.tsx src/remote/HandOverlayPanel.tsx | sort -u
```

Every control that prints must still be reachable in the new layout in no more taps than today. Anything new since commit `1a730d4` gets a place in the same visual language. Nothing may be dropped.

## 11. Test contract (from `tests/*.spec.ts` at `1a730d4`)

Regenerate this list before you start: `grep -rhoE "getBy(Role|Label|Text|TestId)\([^)]*\)|locator\('[^']*'" tests | sort -u`.

- **Test IDs:** `room-code`, `call-state` (`mm:ss`). The room code's text must be the bare code; tests read `innerText` and type it into another browser.
- **Button names:**
  - Navigation: `Messages`, `Activity`, `Helpers`, `Profile`
  - Starting and joining calls: `New call`, `Join`
  - Call controls: `End call`, `Cancel`, `Mute microphone`, `Unmute microphone` (with `aria-pressed`), `Turn camera off`, `Turn camera on`
  - Hand tools and the 3D copy: `Hand tools`, `Close`, `Close 3D view`
  - Requests and helpers: `Request Help`, `Request help`, `Send request`, `Request sent`, `Accept Help`, `Decline`, `Cancel request`, `Open messages`, `Submit rating`
  - Profiles: `Save profile`, `Close profile`, `Message`, `View <name>'s profile`
  - Friends: `Accept friend`, `Friends`
  - Chat and call invites: `Send message`, `Invite to call`, `Accept call`, `Decline call`
  - Account: `Log in`, `Log out`, `Create account`, `New here? Sign up`
  - Saved demo models: `★ lanyard` inside the group `Saved for the demo`
- **Field labels:** `Join with a code`, `Email`, `Password`, `Display name`, `Username`, `About you`, `Expertise (comma-separated, up to 8 tags)`, `Title`, `Description`, `Message`, `Search usernames`, `Rate your helper`.
- **Headings:** `Help requests` (none on the Helpers view), `Messages & Friends`, `Welcome back`, request titles inside `article`s.
- **Dialogs and regions:** dialog `Member profile`, region `Friend requests`, complementary `3D copy of <label>`, the badge `1 friend requests`.
- **Exact text:**
  - `Waiting for your friend…`
  - `Your friend ended the call.`
  - `TURN relay`
  - `completed`
  - `Not rated yet`
  - `Rated 4/5`
  - `Profile saved.`
  - `People helped`
  - `Call declined`
  - `Waiting for your invitation to be accepted…`
  - `No matching username found.`
  - The notification texts
  - `AI scan to 3D model` (visible after opening Hand tools)
- **Classes:** `.self-video`, `.friend-video`, `.camera-stage video`, `.twin-box`, `.twin-box.stage`, `.scene-box`, `.hand-overlay`, `.replay-player canvas`, `.conversation-link`.
- **Roles:** call and permission errors use `role="alert"`; statuses use `role="status"`.
- **Stale tests:** `tests/finder.spec.ts` and `tests/lesson.spec.ts` look for "Find the lanyard" and "…up to your camera", which the app no longer shows. Fix or remove those tests separately; they are not part of the redesign.
