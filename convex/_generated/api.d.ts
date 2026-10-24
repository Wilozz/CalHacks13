/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as community from "../community.js";
import type * as http from "../http.js";
import type * as presence from "../presence.js";
import type * as profiles from "../profiles.js";
import type * as replays from "../replays.js";
import type * as social from "../social.js";
import type * as socialHelpers from "../socialHelpers.js";
import type * as usernames from "../usernames.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  community: typeof community;
  http: typeof http;
  presence: typeof presence;
  profiles: typeof profiles;
  replays: typeof replays;
  social: typeof social;
  socialHelpers: typeof socialHelpers;
  usernames: typeof usernames;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  presence: import("@convex-dev/presence/_generated/component.js").ComponentApi<"presence">;
};
