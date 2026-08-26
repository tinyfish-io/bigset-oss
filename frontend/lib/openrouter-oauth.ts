import { useSyncExternalStore } from "react";

export const OPENROUTER_VERIFIER_KEY = "bigset:openrouter-code-verifier";
export const OPENROUTER_RETURN_TO_KEY = "bigset:openrouter-return-to";

const LOCAL_HOST_SUFFIXES = [
  ".home",
  ".home.arpa",
  ".internal",
  ".lan",
  ".local",
  ".localhost",
  ".localdomain",
];

const LOCAL_HOSTNAMES = new Set(["localhost", "0.0.0.0"]);

function base64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256(value: string): Promise<ArrayBuffer> {
  return await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
}

function randomVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes.buffer);
}

function safeReturnTo(returnTo: string): string {
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) return "/setup";
  return returnTo;
}

function normalizedHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1")
    .replace(/\.$/, "");
}

function isLocalIpv4Hostname(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4) return false;

  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return Number.NaN;
    const value = Number(part);
    return value >= 0 && value <= 255 ? value : Number.NaN;
  });
  if (octets.some(Number.isNaN)) return false;

  const [first, second] = octets;
  if (first === 0 || first === 10 || first === 127) {
    return true;
  }
  if (first === 100 && second >= 64 && second <= 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 198 && (second === 18 || second === 19)) return true;

  return false;
}

function isLocalIpv6Hostname(hostname: string): boolean {
  if (!hostname.includes(":")) return false;
  if (
    hostname === "::" ||
    hostname === "::1" ||
    hostname === "0:0:0:0:0:0:0:0" ||
    hostname === "0:0:0:0:0:0:0:1"
  ) {
    return true;
  }

  const mappedIpv4 = hostname.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4 && isLocalIpv4Hostname(mappedIpv4)) return true;

  const firstSegment = Number.parseInt(hostname.split(":")[0] || "0", 16);
  if (Number.isNaN(firstSegment)) return false;

  return (firstSegment & 0xfe00) === 0xfc00 || (firstSegment & 0xffc0) === 0xfe80;
}

export function isLocalOpenRouterOAuthHostname(hostname: string): boolean {
  const normalized = normalizedHostname(hostname);
  if (!normalized) return true;
  if (LOCAL_HOSTNAMES.has(normalized)) return true;
  if (LOCAL_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    return true;
  }
  if (!normalized.includes(".") && !normalized.includes(":")) return true;

  return isLocalIpv4Hostname(normalized) || isLocalIpv6Hostname(normalized);
}

export function canUseOpenRouterOAuth(): boolean {
  if (typeof window === "undefined") return false;
  return !isLocalOpenRouterOAuthHostname(window.location.hostname);
}

function subscribeToOpenRouterOAuthAvailability() {
  return () => {};
}

function unavailableOnServer() {
  return false;
}

export function useCanUseOpenRouterOAuth(): boolean {
  return useSyncExternalStore(
    subscribeToOpenRouterOAuthAvailability,
    canUseOpenRouterOAuth,
    unavailableOnServer,
  );
}

export async function beginOpenRouterOAuth(returnTo = "/setup") {
  if (!canUseOpenRouterOAuth()) return;

  const verifier = randomVerifier();
  const challenge = base64Url(await sha256(verifier));
  sessionStorage.setItem(OPENROUTER_VERIFIER_KEY, verifier);
  sessionStorage.setItem(OPENROUTER_RETURN_TO_KEY, safeReturnTo(returnTo));

  const callbackUrl = `${window.location.origin}/setup/openrouter/callback`;
  const url = new URL("https://openrouter.ai/auth");
  url.searchParams.set("callback_url", callbackUrl);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  window.location.href = url.toString();
}

export function getOpenRouterOAuthReturnTo(): string {
  const returnTo = sessionStorage.getItem(OPENROUTER_RETURN_TO_KEY);
  return returnTo ? safeReturnTo(returnTo) : "/setup";
}

export function clearOpenRouterOAuthState() {
  sessionStorage.removeItem(OPENROUTER_VERIFIER_KEY);
  sessionStorage.removeItem(OPENROUTER_RETURN_TO_KEY);
}
