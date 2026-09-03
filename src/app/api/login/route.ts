import { NextResponse } from "next/server";

const SESSION_COOKIE = "session";

export async function POST(request: Request) {
  const appSecret = process.env.APP_SECRET;
  if (!appSecret) {
    return NextResponse.json({ error: "APP_SECRET not configured" }, { status: 500 });
  }

  const { secret } = await request.json().catch(() => ({ secret: "" }));

  if (secret !== appSecret) {
    return NextResponse.json({ error: "Incorrect secret" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, appSecret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
