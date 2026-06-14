// app/api/auth/session/route.ts
// Demo identity provider. The ONLY endpoint that accepts a user id from the
// client — and it validates that id against the database before issuing a
// signed, httpOnly session cookie. Every other route reads identity from that
// cookie via getSessionUser(), never from the request body.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  getSessionUser,
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

function publicUser(u: { id: string; name: string; email: string; role: string }) {
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

// Current session user, or null.
export async function GET() {
  const user = await getSessionUser();
  return NextResponse.json({ user: user ? publicUser(user) : null });
}

// Establish a session for an existing user (demo "log in as").
export async function POST(req: NextRequest) {
  const { userId } = await req.json().catch(() => ({}));
  if (!userId || typeof userId !== "string") {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ error: "Unknown user" }, { status: 404 });
  }

  const res = NextResponse.json({ user: publicUser(user) });
  res.cookies.set(SESSION_COOKIE_NAME, createSessionToken(user.id), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}

// Log out.
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
