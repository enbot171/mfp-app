export const runtime = "nodejs";

import { readPledgeLog, appendToPledgeLog, pushPledgeToMaster } from "@/lib/googleSheets";
import { NextResponse } from "next/server";

// GET /api/pledge?sheetId=...
// Returns { fingerprints, rows } from _pledge_log_ (Status=pushed)
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const sheetId = searchParams.get("sheetId");
  if (!sheetId) return NextResponse.json({ error: "Missing sheetId" }, { status: 400 });
  try {
    const { fingerprints, logRows } = await readPledgeLog(sheetId);
    return NextResponse.json({ fingerprints, rows: logRows });
  } catch (err) {
    console.error("readPledgeLog error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/pledge
// Body: { sheetId, tab, updates, appends, logRows }
// Pushes to master sheet + appends to _pledge_log_ in parallel.
// Returns { updated, appended, snapshot }
export async function POST(req) {
  try {
    const { sheetId, tab, updates = [], appends = [], logRows = [] } = await req.json();
    if (!sheetId || !tab) {
      return NextResponse.json({ error: "Missing sheetId or tab" }, { status: 400 });
    }
    const [result] = await Promise.all([
      pushPledgeToMaster(sheetId, tab, updates, appends),
      appendToPledgeLog(sheetId, logRows),
    ]);
    return NextResponse.json({ updated: result.updated, appended: result.appended, snapshot: result.snapshot });
  } catch (err) {
    console.error("pushPledgeToMaster error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
