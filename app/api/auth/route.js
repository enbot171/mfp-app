import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST(req) {
  const { password } = await req.json();

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  // Simple session cookie — httpOnly so JS can't read it
  res.cookies.set("mfp_session", process.env.ADMIN_PASSWORD, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // omit maxAge to make it a session cookie (expires on browser close)
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("mfp_session", "", { httpOnly: true, maxAge: 0, path: "/" });
  return res;
}
