/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as apiKeys from "../apiKeys.js";
import type * as datasetRows from "../datasetRows.js";
import type * as datasets from "../datasets.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_quota from "../lib/quota.js";
import type * as lib_refreshScheduling from "../lib/refreshScheduling.js";
import type * as localCredentials from "../localCredentials.js";
import type * as modelConfig from "../modelConfig.js";
import type * as openRouterModels from "../openRouterModels.js";
import type * as publicSeed from "../publicSeed.js";
import type * as quota from "../quota.js";
import type * as runStats from "../runStats.js";
import type * as sheetsEnrichmentRuns from "../sheetsEnrichmentRuns.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  apiKeys: typeof apiKeys;
  datasetRows: typeof datasetRows;
  datasets: typeof datasets;
  "lib/authz": typeof lib_authz;
  "lib/quota": typeof lib_quota;
  "lib/refreshScheduling": typeof lib_refreshScheduling;
  localCredentials: typeof localCredentials;
  modelConfig: typeof modelConfig;
  openRouterModels: typeof openRouterModels;
  publicSeed: typeof publicSeed;
  quota: typeof quota;
  runStats: typeof runStats;
  sheetsEnrichmentRuns: typeof sheetsEnrichmentRuns;
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

export declare const components: {};
