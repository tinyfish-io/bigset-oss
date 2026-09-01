import { clerkMiddleware } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";

const isLocalMode = process.env.PROD !== "1";

/**
 * Public routes (Clerk middleware lets these through without auth):
 *   /                  — landing page with curated datasets
 *   /sign-in, /sign-up — Clerk auth widgets
 *   /dataset/<id>      — anyone can attempt to view a dataset. Server-side
 *                        authz in convex/lib/authz.ts decides what they see
 *                        (public datasets render; private ones return
 *                        "Dataset not found" via the error boundary).
 *
 * Explicitly NOT public:
 *   /dataset/new       — creating a dataset requires auth
 *   /dashboard         — personal home, requires auth
 *
 * Implementation note: this used to use `createRouteMatcher` but
 * path-to-regexp's `(.*)` capture-group semantics didn't match what Clerk
 * expects in dev mode — `/dataset/<id>` kept getting redirected to sign-in.
 * Plain string prefix checks are more obvious and behave identically in
 * dev and prod.
 */
function isPublicPath(req: NextRequest): boolean {
  const path = req.nextUrl.pathname;
  if (path === "/") return true;
  if (path === "/sign-in" || path.startsWith("/sign-in/")) return true;
  if (path === "/sign-up" || path.startsWith("/sign-up/")) return true;
  if (
    path.startsWith("/dataset/") &&
    path !== "/dataset/new" &&
    !path.startsWith("/dataset/new/")
  ) return true;
  if (path.startsWith("/share/")) return true;
  return false;
}

const clerkProxy = clerkMiddleware(async (auth, request) => {
  if (!isPublicPath(request)) {
    await auth.protect();
  }
});

export default isLocalMode ? function localProxy() {} : clerkProxy;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
