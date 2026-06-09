export const runtime = "nodejs";

import { listQueueTabs, readQueueTab, writeQueueTab, deleteQueueTab } from "@/lib/googleSheets";
import { NextResponse } from "next/server";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const sheetId  = searchParams.get("sheetId");
  const queueTab = searchParams.get("queueTab");
  if (!sheetId)
    return NextResponse.json({ error: "Missing sheetId" }, { status: 400 });
  try {
    // No queueTab — return list of all queue tab names.
    if (!queueTab) {
      const tabs = await listQueueTabs(sheetId);
      return NextResponse.json({ tabs });
    }
    const rows = await readQueueTab(sheetId, queueTab);
    return NextResponse.json({ rows: rows ?? null });
  } catch (err) {
    console.error("readQueueTab error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { sheetId, queueTab, rows } = await req.json();
    if (!sheetId || !queueTab)
      return NextResponse.json({ error: "Missing sheetId or queueTab" }, { status: 400 });
    await writeQueueTab(sheetId, rows ?? [], queueTab);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("writeQueueTab error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const { sheetId, queueTab } = await req.json();
    if (!sheetId || !queueTab)
      return NextResponse.json({ error: "Missing sheetId or queueTab" }, { status: 400 });
    await deleteQueueTab(sheetId, queueTab);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("deleteQueueTab error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
