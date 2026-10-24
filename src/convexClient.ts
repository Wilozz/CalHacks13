import {ConvexReactClient} from 'convex/react';
const convexUrl=import.meta.env.VITE_CONVEX_URL;
/** The one Convex client, or null when no backend is configured (manual calls still work without it). */
export const convex=convexUrl?new ConvexReactClient(convexUrl):null;
