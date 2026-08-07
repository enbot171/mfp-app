import { NextResponse } from "next/server";

// The service-account email is user-facing (admins must share their Master Sheet with it),
// but we serve it from env rather than hardcoding it so the address stays out of the source repo.
export async function GET() {
  return NextResponse.json({ email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "" });
}
