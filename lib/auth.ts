// lib/auth.ts
// Server-owned session for StackGate.
//
// Identity is NEVER taken from the request body. The browser only holds an
// httpOnly, HMAC-signed cookie containing a user id; the signature means a
// client cannot forge the cookie to impersonate another user. Every API route
// derives the acting user from this session via getSessionUser().

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";

export const SESSION_COOKIE_NAME = "stackgate_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

const SECRET =
  process.env.STACKGATE_SESSION_SECRET ||
  "stackgate-dev-session-secret-change-in-production";

function sign(value: string): string {
  return createHmac("sha256", SECRET).update(value).digest("hex");
}

export function createSessionToken(userId: string): string {
  return `${userId}.${sign(userId)}`;
}

// Returns the userId only if the signature is valid; null otherwise.
export function verifySessionToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return null;
  const userId = token.slice(0, idx);
  const signature = token.slice(idx + 1);
  const expected = sign(userId);
  if (signature.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  return userId;
}

// Resolve the authenticated user from the session cookie. Returns null when
// there is no valid session or the user no longer exists.
export async function getSessionUser() {
  const store = await cookies();
  const userId = verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value);
  if (!userId) return null;
  return prisma.user.findUnique({ where: { id: userId } });
}
