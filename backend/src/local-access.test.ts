import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import {
  isLoopbackAddress,
  registerLocalAccessGuard,
  resolveBindHost,
  resolveLocalMode,
} from "./local-access.js";

test("local mode is opt-in and PROD=1 wins", () => {
  assert.equal(resolveLocalMode({}), false);
  assert.equal(resolveLocalMode({ PROD: "" }), false);
  assert.equal(resolveLocalMode({ BIGSET_LOCAL_MODE: "1" }), true);
  assert.equal(resolveLocalMode({ BIGSET_LOCAL_MODE: "true" }), false);
  assert.equal(resolveLocalMode({ BIGSET_LOCAL_MODE: "1", PROD: "1" }), false);
});

test("binds to loopback unless told otherwise", () => {
  assert.equal(resolveBindHost({}), "127.0.0.1");
  assert.equal(resolveBindHost({ BIGSET_BIND_HOST: "0.0.0.0" }), "0.0.0.0");
});

test("isLoopbackAddress", () => {
  for (const a of ["127.0.0.1", "127.1.2.3", "::1", "::ffff:127.0.0.1"]) {
    assert.equal(isLoopbackAddress(a), true, a);
  }
  for (const a of [undefined, "", "192.168.1.50", "10.0.0.5", "172.17.0.1", "::ffff:192.168.1.50", "fe80::1", "0.0.0.0", "127.0.0.1.evil"]) {
    assert.equal(isLoopbackAddress(a), false, String(a));
  }
});

async function app(opts: { localMode: boolean; allowNonLoopback: boolean }) {
  const fastify = Fastify();
  registerLocalAccessGuard(fastify, opts);
  fastify.get("/cli/datasets", async () => ({ ok: true }));
  fastify.post("/local-setup/tinyfish", async () => ({ ok: true }));
  return fastify;
}

test("local mode rejects non-loopback callers on every route", async () => {
  const fastify = await app({ localMode: true, allowNonLoopback: false });
  for (const [method, url] of [["GET", "/cli/datasets"], ["POST", "/local-setup/tinyfish"]] as const) {
    const lan = await fastify.inject({ method, url, remoteAddress: "192.168.1.50" });
    assert.equal(lan.statusCode, 403, `${method} ${url} from LAN`);
    const local = await fastify.inject({ method, url, remoteAddress: "127.0.0.1" });
    assert.equal(local.statusCode, 200, `${method} ${url} from loopback`);
  }
});

test("X-Forwarded-For cannot spoof loopback", async () => {
  const fastify = await app({ localMode: true, allowNonLoopback: false });
  const res = await fastify.inject({
    method: "GET",
    url: "/cli/datasets",
    remoteAddress: "192.168.1.50",
    headers: { "x-forwarded-for": "127.0.0.1" },
  });
  assert.equal(res.statusCode, 403);
});

test("guard is off outside local mode and with the Docker escape hatch", async () => {
  for (const opts of [
    { localMode: false, allowNonLoopback: false },
    { localMode: true, allowNonLoopback: true },
  ]) {
    const fastify = await app(opts);
    const res = await fastify.inject({ method: "GET", url: "/cli/datasets", remoteAddress: "192.168.1.50" });
    assert.equal(res.statusCode, 200, JSON.stringify(opts));
  }
});
