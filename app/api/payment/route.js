export const runtime = "nodejs";

import { readPaymentLog, appendToPaymentLog, pushPaymentUpdates } from "@/lib/googleSheets";
import { NextResponse } from "next/server";

// GET /api/payment?sheetId=...
// Returns fingerprints from both _payment_ledger (legacy) and _payment_log_ (Status=pushed)
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const sheetId = searchParams.get("sheetId");
  if (!sheetId) return NextResponse.json({ error: "Missing sheetId" }, { status: 400 });
  try {
    const { fingerprints, logRows } = await readPaymentLog(sheetId);
    return NextResponse.json({ fingerprints, rows: logRows });
  } catch (err) {
    console.error("readPaymentLog error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/payment
// Body: { sheetId, tab, updates: [{masterRowIndex, monthColIndex, amount, pledgeAmount}], logRows: [{...}] }
// Pushes amounts+colours to master sheet and appends to _payment_log_ in parallel.
// Returns { pushed, snapshot } — snapshot.cells is used for revert.
export async function POST(req) {
  try {
    const { sheetId, tab, updates = [], logRows = [] } = await req.json();
    if (!sheetId || !tab) {
      return NextResponse.json({ error: "Missing sheetId or tab" }, { status: 400 });
    }

    // Fix 2: push and log in parallel
    const [snapshot] = await Promise.all([
      pushPaymentUpdates(sheetId, tab, updates),
      appendToPaymentLog(sheetId, logRows),
    ]);

    return NextResponse.json({ pushed: updates.length, snapshot });
  } catch (err) {
    console.error("pushPaymentUpdates error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
