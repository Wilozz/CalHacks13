# GHOST UI

The supplied globe-hero reference is adapted to the existing Vite/React/TypeScript app. No shadcn or Tailwind migration is needed: existing camera, chat, call and tracking components keep their behavior and share the same native CSS design tokens.

- `src/components/ui/page-heading.tsx`: reusable heading and description used by Community, Profile, Messages, login and Call.
- `src/components/ui/globe-hero.tsx`: wireframe globe using the installed Three.js/React Three Fiber camera. Retained as an optional component; browsing now uses compact page headers without a globe. Includes a static fallback, reduced-motion handling, an offscreen pause and capped pixel ratio.
- `src/design.css`: shared Inter typography, monochrome buttons, subtle borders, sharp rectangular cards, navigation, fields, media controls and responsive spacing. Loaded after the existing layout CSS so tracking/media geometry stays intact.
- `@fontsource-variable/inter`: font files bundled locally; no Google Fonts request needed.

Continue putting reusable visual components under `src/components/ui/` (the app's existing `src` source root), and edit shared tokens in `design.css` rather than adding different fonts or colors per page. Monospace remains reserved for room codes and numerical debug data.

Run `npm install` then the usual `npm run dev:community`. Visual changes are local on the `forum` branch. No backend configuration or deployment changes are required.

`src/community/MemberProfile.tsx` shares the avatar trigger, profile dialog and three-column statistics across helper cards and messages. Browsing uses separate Requests, Helpers and Activity destinations to avoid stacking unrelated sections. Decorative badges and hero slogans are removed.
