export const runtime = "nodejs";

import { readQueueTab, writeQueueTab } from "@/lib/googleSheets";
import { NextResponse } from "next/server";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const sheetId = searchParams.get("sheetId");
  if (!sheetId) return NextResponse.json({ error: "Missing sheetId" }, { status: 400 });
  try {
    const rows = await readQueueTab(sheetId);
    return NextResponse.json({ rows: rows ?? null });
  } catch (err) {
    console.error("readQueueTab error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { sheetId, rows } = await req.json();
    if (!sheetId) return NextResponse.json({ error: "Missing sheetId" }, { status: 400 });
    await writeQueueTab(sheetId, rows ?? []);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("writeQueueTab error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
