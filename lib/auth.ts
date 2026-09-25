import { createHash, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const AUTH_COOKIE = "private-ai-auth";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function expectedToken() {
  const pin = process.env.PRIVATE_AI_PIN ?? "";
  return pin ? hash(`private-ai:${pin}`) : "";
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isAccessConfigured() {
  return Boolean(process.env.PRIVATE_AI_PIN);
}

export function verifyPin(pin: string) {
  const configured = process.env.PRIVATE_AI_PIN ?? "";
  return configured ? safeEqual(hash(pin), hash(configured)) : false;
}

export function authToken() {
  return expectedToken();
}

export async function isAuthorized() {
  if (!isAccessConfigured()) return false;
  const store = await cookies();
  const value = store.get(AUTH_COOKIE)?.value ?? "";
  const expected = expectedToken();
  return Boolean(value && expected && safeEqual(value, expected));
}
