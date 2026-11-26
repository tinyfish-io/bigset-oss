import type { FastifyInstance } from "fastify";

/**
 * Local mode skips caller authentication: every request acts as the single
 * local user. That is only safe when nothing but this machine can reach the
 * backend, so local mode is opt-in and requests from other hosts are refused.
 */

type Env = Record<string, string | undefined>;

/** Local mode needs `BIGSET_LOCAL_MODE=1`; `PROD=1` always wins. */
export function resolveLocalMode(processEnv: Env): boolean {
  return processEnv.BIGSET_LOCAL_MODE === "1" && processEnv.PROD !== "1";
}

/** Interface to listen on. Loopback unless `BIGSET_BIND_HOST` says otherwise. */
export function resolveBindHost(processEnv: Env): string {
  return processEnv.BIGSET_BIND_HOST || "127.0.0.1";
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const addr = address.startsWith("::ffff:") ? address.slice(7) : address;
  return addr === "::1" || /^127(\.\d{1,3}){3}$/.test(addr);
}

/**
 * In local mode, reject any request whose TCP peer is not loopback.
 *
 * Uses the socket address, not `req.ip`, so `X-Forwarded-For` can never
 * spoof it. `allowNonLoopback` exists only for Docker, where traffic arrives
 * from the bridge gateway and the host port is published on 127.0.0.1.
 */
export function registerLocalAccessGuard(
  fastify: FastifyInstance,
  opts: { localMode: boolean; allowNonLoopback: boolean },
): void {
  if (!opts.localMode || opts.allowNonLoopback) return;
  fastify.addHook("onRequest", async (req, reply) => {
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      req.log.warn(
        { remoteAddress: req.socket.remoteAddress, url: req.url },
        "Rejected non-loopback request in local mode",
      );
      return reply.code(403).send({ error: "Local mode only accepts requests from this machine" });
    }
  });
}
