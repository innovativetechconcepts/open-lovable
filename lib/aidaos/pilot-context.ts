import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SandboxProvider } from "@/lib/sandbox/types";

export const SESSION_COOKIE = "__Host-aidaos-builder";
export interface PilotSession {
  owner: string;
  sandboxId: string;
  expiresAt: number;
}
export interface PilotContext {
  owner: string;
  session: PilotSession | null;
  activeSandboxProvider: SandboxProvider | null;
  // Upstream editor state is request-local; never a cross-operator singleton.
  [key: string]: any;
}
export const pilotContext = new AsyncLocalStorage<PilotContext>();
export function pilotState(): PilotContext {
  const state = pilotContext.getStore();
  if (!state) throw new Error("Authenticated pilot context required");
  return state;
}
function key(): string {
  const value = process.env.AIDAOS_SESSION_SECRET;
  if (!value || value.length < 32)
    throw new Error("Pilot sessions are not configured");
  return value;
}
export function encodeSession(session: PilotSession): string {
  const body = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${body}.${createHmac("sha256", key()).update(body).digest("base64url")}`;
}
export function decodeSession(
  value: string | undefined,
  owner: string,
  now = Date.now(),
): PilotSession | null {
  if (!value || value.length > 1024) return null;
  const [body, signature, extra] = value.split(".");
  if (extra || !body || !signature) return null;
  const expected = createHmac("sha256", key()).update(body).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(expected, actual))
    return null;
  try {
    const session = JSON.parse(Buffer.from(body, "base64url").toString());
    if (
      session.owner !== owner ||
      !/^sbx_[A-Za-z0-9]+$/.test(session.sandboxId) ||
      !Number.isSafeInteger(session.expiresAt) ||
      session.expiresAt <= now ||
      session.expiresAt > now + 3600_000
    )
      return null;
    return session;
  } catch {
    return null;
  }
}
